import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '../config';
import { NAV_BY_ROLE } from '../nav-config';
import {
  CHAT_ROOM_LABEL,
  ChatAttachment,
  ChatMessage,
  ChatRoomKey,
  ChatRoomSummary,
  GroupCandidate,
  TypingUser,
} from '../models/chat.model';
import { AuthService } from './auth.service';
import { NotificationService } from './notification.service';
import type { ApiSuccess } from '../api';

const BASE = `${API_BASE_URL}/chat`;
/** The socket connects to the server origin, not the /api path — also used to resolve an
 * attachment's server-relative `url` (which already starts with /api/chat/...). */
const SOCKET_URL = API_BASE_URL.replace(/\/api\/?$/, '');

/** How long a "typing" flag survives without a refresh, in case the stop event is lost. */
const TYPING_TTL_MS = 4000;

/**
 * Owns the chat websocket and all chat HTTP calls.
 *
 * The app is zoneless, so every socket callback writes into a signal — that is what
 * schedules change detection. Nothing here calls ApplicationRef.tick() manually.
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  private socket: Socket | null = null;
  private readonly typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastTypingSentAt = 0;

  private readonly _rooms = signal<ChatRoomSummary[]>([]);
  private readonly _messages = signal<ChatMessage[]>([]);
  private readonly _activeRoom = signal<ChatRoomKey | null>(null);
  private readonly _typing = signal<TypingUser[]>([]);
  private readonly _connected = signal(false);
  private readonly _loading = signal(false);
  private readonly _hasMore = signal(false);

  readonly rooms = this._rooms.asReadonly();
  readonly messages = this._messages.asReadonly();
  readonly activeRoom = this._activeRoom.asReadonly();
  readonly typing = this._typing.asReadonly();
  readonly connected = this._connected.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();
  /** True after a jump-to-message window that doesn't reach the newest messages. */
  private readonly _hasNewer = signal(false);
  readonly hasNewer = this._hasNewer.asReadonly();
  /** Message the view should scroll to once the window renders; cleared by the component. */
  private readonly _jumpTarget = signal<string | null>(null);
  readonly jumpTarget = this._jumpTarget.asReadonly();

  clearJumpTarget(): void {
    this._jumpTarget.set(null);
  }

  /** Rooms the signed-in role can open — drives the admin's channel switcher. */
  readonly availableRooms = computed<ChatRoomKey[]>(() => this._rooms().map((r) => r.room));

  labelFor(room: ChatRoomKey): string {
    return this._rooms().find((r) => r.room === room)?.label ?? CHAT_ROOM_LABEL[room] ?? 'Group';
  }

  /** Only admins can mute a channel's popups. Unread badges still count — mute is toast-only. */
  readonly canMute = computed(() => this.auth.role() === 'ADMIN');
  private readonly _muted = signal<ReadonlySet<ChatRoomKey>>(new Set());
  readonly muted = this._muted.asReadonly();

  isMuted(room: ChatRoomKey): boolean {
    return this.canMute() && this._muted().has(room);
  }

  toggleMute(room: ChatRoomKey): void {
    if (!this.canMute()) return;
    const next = new Set(this._muted());
    if (!next.delete(room)) next.add(room);
    this._muted.set(next);
    try {
      localStorage.setItem(this.muteKey(), JSON.stringify([...next]));
    } catch {
      // Storage blocked — the mute still holds for this session.
    }
  }

  private muteKey(): string {
    return `chat-muted:${this.auth.user()?.id ?? ''}`;
  }

  private loadMuted(): void {
    try {
      const raw = localStorage.getItem(this.muteKey());
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      this._muted.set(new Set(Array.isArray(parsed) ? (parsed as ChatRoomKey[]) : []));
    } catch {
      this._muted.set(new Set());
    }
  }

  readonly totalUnread = computed(() => this._rooms().reduce((sum, r) => sum + r.unread, 0));

  constructor() {
    // One place that ties the socket's lifetime to the session — covers login, logout,
    // and the interceptor's forced logout on 401 without each caller remembering to clean up.
    effect(() => {
      const user = this.auth.user();
      // Every role connects: even a Client (no built-in channel) can be added to a group.
      if (user) {
        this.connect();
        this.loadMuted();
        // Loaded here rather than in the chat page so the sidebar badge is populated
        // from the moment you sign in, not only after you first open the channel.
        void this.loadRooms().catch(() => undefined);
      } else {
        this.teardown();
      }
    });
  }

  // ─── Socket lifecycle ───

  private connect(): void {
    if (this.socket) return;
    const token = this.auth.getToken();
    if (!token) return;

    // The browser cannot set headers on a websocket handshake, so the JWT rides in
    // `auth` — the server verifies it in io.use() exactly like the REST middleware.
    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => this._connected.set(true));
    socket.on('disconnect', () => this._connected.set(false));
    socket.on('connect_error', () => this._connected.set(false));

    socket.on('chat:message', (message: ChatMessage) => this.onIncoming(message));
    socket.on('chat:message-updated', (message: ChatMessage) => this.onUpdated(message));
    // Added to a new group: refresh the channel list so it appears without a reload.
    socket.on('chat:rooms-changed', () => void this.loadRooms().catch(() => undefined));
    socket.on('chat:typing', (payload: { room: ChatRoomKey; userId: string; name: string; isTyping: boolean }) =>
      this.onTyping(payload)
    );

    this.socket = socket;
  }

  private teardown(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.typingTimers.forEach((t) => clearTimeout(t));
    this.typingTimers.clear();
    this._connected.set(false);
    this._rooms.set([]);
    this._messages.set([]);
    this._typing.set([]);
    this._activeRoom.set(null);
  }

  private onIncoming(message: ChatMessage): void {
    // While viewing an older search window, appending the newest message would leave a gap.
    if (message.room === this._activeRoom() && !this._hasNewer()) {
      this.upsert(message);
      // Reading it as it arrives keeps the badge from flashing for a room you're staring at.
      void this.markRead(message.room);
    } else {
      this._rooms.update((rooms) => {
        const known = rooms.some((r) => r.room === message.room);
        // The summary can be missing if a message lands before loadRooms() resolves.
        if (!known) return [...rooms, { room: message.room, label: this.labelFor(message.room), members: null, unread: 1, lastMessage: message }];
        return rooms.map((r) =>
          r.room === message.room ? { ...r, unread: r.unread + 1, lastMessage: message } : r
        );
      });
    }
    this.clearTyping(message.sender.id);
    this.toastIncoming(message);
  }

  /** Popup for a message that arrives while you're elsewhere in the app. Toast only — chat
   * already has its own unread badge, so it is deliberately kept out of the bell. */
  private toastIncoming(message: ChatMessage): void {
    const user = this.auth.user();
    if (!user || message.sender.id === user.id || message.deleted) return;
    if (this.isMuted(message.room)) return;
    // Anywhere inside the chat section the message list / room switcher is already on screen.
    if (/\/chat(\/|$|\?)/.test(this.router.url)) return;

    const link = NAV_BY_ROLE[user.role].find((item) => item.badge === 'chat')?.path ?? null;
    this.notifications.showToast({
      id: `chat:${message.id}`,
      kind: 'info',
      title: `${message.sender.name} · ${this.labelFor(message.room)}`,
      message: message.body || (message.attachment ? `Sent a file: ${message.attachment.name}` : 'New message'),
      link,
      createdAt: message.createdAt,
    });
  }

  private onUpdated(message: ChatMessage): void {
    if (message.room === this._activeRoom()) this.upsert(message);
    this._rooms.update((rooms) =>
      rooms.map((r) => (r.room === message.room && r.lastMessage?.id === message.id ? { ...r, lastMessage: message } : r))
    );
  }

  /**
   * Insert-or-replace by id, keeping the list sorted by time. The sender receives its own
   * message twice — once as the POST response, once over the socket — and this makes that
   * a no-op instead of a duplicate bubble.
   */
  private upsert(message: ChatMessage): void {
    this._messages.update((list) => {
      const index = list.findIndex((m) => m.id === message.id);
      if (index !== -1) {
        const copy = [...list];
        copy[index] = message;
        return copy;
      }
      const next = [...list, message];
      next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return next;
    });
  }

  // ─── Typing indicator ───

  private onTyping(payload: { room: ChatRoomKey; userId: string; name: string; isTyping: boolean }): void {
    if (payload.room !== this._activeRoom()) return;

    if (!payload.isTyping) {
      this.clearTyping(payload.userId);
      return;
    }

    this._typing.update((list) =>
      list.some((u) => u.userId === payload.userId) ? list : [...list, { userId: payload.userId, name: payload.name }]
    );

    // Self-expiring, so a dropped "stopped typing" can't strand the indicator on screen.
    clearTimeout(this.typingTimers.get(payload.userId));
    this.typingTimers.set(
      payload.userId,
      setTimeout(() => this.clearTyping(payload.userId), TYPING_TTL_MS)
    );
  }

  private clearTyping(userId: string): void {
    clearTimeout(this.typingTimers.get(userId));
    this.typingTimers.delete(userId);
    this._typing.update((list) => list.filter((u) => u.userId !== userId));
  }

  /** Throttled to one event per second while typing; sends the stop event immediately. */
  notifyTyping(isTyping: boolean): void {
    const room = this._activeRoom();
    if (!room || !this.socket) return;

    const now = Date.now();
    if (isTyping && now - this.lastTypingSentAt < 1000) return;
    this.lastTypingSentAt = isTyping ? now : 0;

    this.socket.emit('chat:typing', { room, isTyping });
  }

  // ─── HTTP ───

  async loadRooms(): Promise<void> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ rooms: ChatRoomSummary[] }>>(`${BASE}/rooms`));
    this._rooms.set(res.data.rooms);
    // The open room vanished (group deleted, or you were removed): drop back to a blank state.
    const active = this._activeRoom();
    if (active && !res.data.rooms.some((r) => r.room === active)) {
      this._activeRoom.set(null);
      this._messages.set([]);
      this._typing.set([]);
    }
  }

  /** Admin only: people who can be added to a custom group. */
  async groupCandidates(everyone = false): Promise<GroupCandidate[]> {
    const res = await firstValueFrom(
      this.http.get<ApiSuccess<{ users: GroupCandidate[] }>>(`${BASE}/group-candidates`, {
        params: everyone ? { all: '1' } : {},
      })
    );
    return res.data.users;
  }

  /** Current roster of a built-in channel (role rule plus admin overrides) — admin only. */
  async builtinRoster(room: ChatRoomKey): Promise<{ label: string; members: GroupCandidate[] }> {
    const res = await firstValueFrom(
      this.http.get<ApiSuccess<{ label: string; members: GroupCandidate[] }>>(`${BASE}/builtin/${room}/roster`)
    );
    return res.data;
  }

  /** Admin only: creates a group; the chosen members are added immediately. */
  async createGroup(name: string, memberIds: string[]): Promise<ChatRoomKey> {
    const res = await firstValueFrom(
      this.http.post<ApiSuccess<{ room: ChatRoomKey }>>(`${BASE}/groups`, { name, memberIds })
    );
    await this.loadRooms();
    return res.data.room;
  }

  /** Admin only: rename and/or set the full member list (the server diffs it). */
  async updateGroup(room: ChatRoomKey, name: string, memberIds: string[]): Promise<void> {
    // Custom groups are `g_<id>`; anything else is a built-in channel with its own endpoint.
    const url = room.startsWith('g_') ? `${BASE}/groups/${room.slice(2)}` : `${BASE}/builtin/${room}`;
    await firstValueFrom(this.http.patch<ApiSuccess<unknown>>(url, { name, memberIds }));
    await this.loadRooms();
  }

  /** Admin only: deletes the group and its whole history for everyone. */
  async deleteGroup(room: ChatRoomKey): Promise<void> {
    await firstValueFrom(this.http.delete<ApiSuccess<unknown>>(`${BASE}/groups/${room.slice(2)}`));
    await this.loadRooms();
  }

  /** Searches one channel's messages (the server re-checks the caller may read it). */
  async search(room: ChatRoomKey, query: string): Promise<ChatMessage[]> {
    const res = await firstValueFrom(
      this.http.get<ApiSuccess<{ results: ChatMessage[] }>>(`${BASE}/search`, { params: { q: query, room } })
    );
    return res.data.results;
  }

  /** Asks the open conversation to scroll to a message it already holds. */
  requestJump(id: string): void {
    this._jumpTarget.set(id);
  }

  /** Opens a room on its newest page, or — with `aroundId` — on a window centred on that message. */
  async openRoom(room: ChatRoomKey, aroundId?: string): Promise<void> {
    this._activeRoom.set(room);
    this._typing.set([]);
    this._loading.set(true);
    this._messages.set([]);
    this._hasNewer.set(false);
    this._jumpTarget.set(null);

    try {
      const res = await firstValueFrom(
        this.http.get<ApiSuccess<{ messages: ChatMessage[]; hasMore: boolean; hasNewer: boolean }>>(
          `${BASE}/${room}/messages`,
          { params: aroundId ? { around: aroundId } : {} }
        )
      );
      // Guard against a fast room switch landing an older response on the newer room.
      if (this._activeRoom() !== room) return;
      this._messages.set(res.data.messages);
      this._hasMore.set(res.data.hasMore);
      this._hasNewer.set(res.data.hasNewer);
      if (aroundId) this._jumpTarget.set(aroundId);
      // A window that stops short of the newest messages must not clear the unread badge.
      if (!res.data.hasNewer) await this.markRead(room);
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Called when the chat page is destroyed. The service is root-scoped, so without this the
   * room stays "active" after you navigate away and incoming messages would be silently
   * marked read instead of raising the sidebar badge.
   */
  closeRoom(): void {
    this._hasNewer.set(false);
    this._jumpTarget.set(null);
    this._activeRoom.set(null);
    this._messages.set([]);
    this._typing.set([]);
  }

  /** Pages further back from the oldest message currently held. */
  async loadOlder(): Promise<void> {
    const room = this._activeRoom();
    const oldest = this._messages()[0];
    if (!room || !oldest || !this._hasMore()) return;

    const res = await firstValueFrom(
      this.http.get<ApiSuccess<{ messages: ChatMessage[]; hasMore: boolean }>>(`${BASE}/${room}/messages`, {
        params: { before: oldest.id },
      })
    );
    if (this._activeRoom() !== room) return;
    this._messages.update((list) => [...res.data.messages, ...list]);
    this._hasMore.set(res.data.hasMore);
  }

  async send(body: string): Promise<void> {
    const room = this._activeRoom();
    if (!room) return;

    const res = await firstValueFrom(
      this.http.post<ApiSuccess<{ message: ChatMessage }>>(`${BASE}/${room}/messages`, { body })
    );
    // The socket broadcast usually beats this; upsert-by-id makes whichever arrives second a no-op.
    this.upsert(res.data.message);
    this.notifyTyping(false);
  }

  /** Uploads a file (any type — no restriction) as its own message, with an optional caption.
   * Angular sets the multipart boundary itself as long as nothing here sets Content-Type. */
  async sendFile(file: File, caption?: string): Promise<void> {
    const room = this._activeRoom();
    if (!room) return;

    const formData = new FormData();
    formData.append('file', file);
    if (caption?.trim()) formData.append('body', caption.trim());

    const res = await firstValueFrom(
      this.http.post<ApiSuccess<{ message: ChatMessage }>>(`${BASE}/${room}/messages/file`, formData)
    );
    this.upsert(res.data.message);
    this.notifyTyping(false);
  }

  /** Fetches an attachment's bytes through the authenticated download route (never a bare
   * <img>/<a> src, which couldn't carry the Bearer token) — used for both "Save" and the
   * inline image preview. Caller owns the resulting object URL and must revoke it. */
  async fetchAttachmentBlob(attachment: ChatAttachment): Promise<Blob> {
    return firstValueFrom(this.http.get(`${SOCKET_URL}${attachment.url}`, { responseType: 'blob' }));
  }

  async edit(id: string, body: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ message: ChatMessage }>>(`${BASE}/messages/${id}`, { body })
    );
    this.upsert(res.data.message);
  }

  async remove(id: string): Promise<void> {
    const res = await firstValueFrom(this.http.delete<ApiSuccess<{ message: ChatMessage }>>(`${BASE}/messages/${id}`));
    this.upsert(res.data.message);
  }

  async markRead(room: ChatRoomKey): Promise<void> {
    await firstValueFrom(this.http.post<ApiSuccess<unknown>>(`${BASE}/${room}/read`, {}));
    this._rooms.update((rooms) => rooms.map((r) => (r.room === room ? { ...r, unread: 0 } : r)));
  }
}
