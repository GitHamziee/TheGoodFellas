import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '../config';
import {
  CHAT_ROOMS_BY_ROLE,
  ChatMessage,
  ChatRoomKey,
  ChatRoomSummary,
  TypingUser,
} from '../models/chat.model';
import { AuthService } from './auth.service';

interface ApiSuccess<T> {
  data: T;
  message?: string;
}

const BASE = `${API_BASE_URL}/chat`;
/** Socket connects to the server origin, not the /api path. */
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

  /** Rooms the signed-in role can open — drives the admin's channel switcher. */
  readonly availableRooms = computed<ChatRoomKey[]>(() => {
    const role = this.auth.role();
    return role ? CHAT_ROOMS_BY_ROLE[role] : [];
  });

  readonly totalUnread = computed(() => this._rooms().reduce((sum, r) => sum + r.unread, 0));

  constructor() {
    // One place that ties the socket's lifetime to the session — covers login, logout,
    // and the interceptor's forced logout on 401 without each caller remembering to clean up.
    effect(() => {
      const user = this.auth.user();
      if (user && CHAT_ROOMS_BY_ROLE[user.role].length > 0) {
        this.connect();
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
    if (message.room === this._activeRoom()) {
      this.upsert(message);
      // Reading it as it arrives keeps the badge from flashing for a room you're staring at.
      void this.markRead(message.room);
    } else {
      this._rooms.update((rooms) => {
        const known = rooms.some((r) => r.room === message.room);
        // The summary can be missing if a message lands before loadRooms() resolves.
        if (!known) return [...rooms, { room: message.room, unread: 1, lastMessage: message }];
        return rooms.map((r) =>
          r.room === message.room ? { ...r, unread: r.unread + 1, lastMessage: message } : r
        );
      });
    }
    this.clearTyping(message.sender.id);
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
  }

  async openRoom(room: ChatRoomKey): Promise<void> {
    this._activeRoom.set(room);
    this._typing.set([]);
    this._loading.set(true);
    this._messages.set([]);

    try {
      const res = await firstValueFrom(
        this.http.get<ApiSuccess<{ messages: ChatMessage[]; hasMore: boolean }>>(`${BASE}/${room}/messages`)
      );
      // Guard against a fast room switch landing an older response on the newer room.
      if (this._activeRoom() !== room) return;
      this._messages.set(res.data.messages);
      this._hasMore.set(res.data.hasMore);
      await this.markRead(room);
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
