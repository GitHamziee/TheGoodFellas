import {
  Component,
  ElementRef,
  OnDestroy,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideArrowLeft,
  LucideCheck,
  LucideChevronDown,
  LucideCircleAlert,
  LucideMessageSquare,
  LucidePencil,
  LucideSendHorizontal,
  LucideTrash2,
  LucideUsers,
} from '@lucide/angular';
import { ChatService } from '../../core/services/chat.service';
import { AuthService } from '../../core/services/auth.service';
import { CHAT_ROOM_LABEL, ChatMessage, ChatRoomKey } from '../../core/models/chat.model';
import { ROLE_LABEL } from '../../core/nav-config';
import { getInitials } from '../../core/format-utils';

/** A message plus the presentation decisions made once, in the component, not in the template. */
interface TimelineItem {
  message: ChatMessage;
  own: boolean;
  /** First message of a new sender block — only these show the sender name and a bubble tail. */
  startsBlock: boolean;
  /** Set on the first message of each calendar day. */
  daySeparator: string | null;
}

/** Consecutive messages from one person within this window collapse into a single block. */
const BLOCK_GAP_MS = 5 * 60 * 1000;

/** Distinct name colours for participants, the way group chats tell speakers apart at a glance.
 *  Matches the tone-a..f palette in shared-page.css (gold, bronze, stone, moss, clay, teal-stone). */
const NAME_COLORS = ['#b8952c', '#92592c', '#46586a', '#5c6a38', '#9c4f34', '#3d6b60'];

const ROOM_MEMBERS: Record<ChatRoomKey, string> = {
  CLOSERS: 'All closers + team lead + admin',
  JUNIOR_CLOSERS: 'All junior closers + team lead + admin',
  TEAM_LEADS: 'All team leads + admin',
  RETENTION: 'All retention + admin',
};

@Component({
  selector: 'app-chat',
  imports: [
    FormsModule,
    LucideSendHorizontal,
    LucideUsers,
    LucideMessageSquare,
    LucidePencil,
    LucideTrash2,
    LucideCircleAlert,
    LucideChevronDown,
    LucideCheck,
    LucideArrowLeft,
  ],
  templateUrl: './chat.html',
  styleUrl: './chat.css',
})
export class Chat implements OnDestroy {
  private readonly chat = inject(ChatService);
  private readonly auth = inject(AuthService);

  private readonly scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');

  readonly user = this.auth.user;
  readonly rooms = this.chat.availableRooms;
  readonly activeRoom = this.chat.activeRoom;
  readonly connected = this.chat.connected;
  readonly loading = this.chat.loading;
  readonly hasMore = this.chat.hasMore;
  readonly typing = this.chat.typing;
  readonly roomSummaries = this.chat.rooms;

  readonly draft = signal('');
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly editDraft = signal('');
  /** Which message's action menu is open — only one at a time. */
  readonly openMenuId = signal<string | null>(null);
  /** Mobile: the list and the conversation share the screen, one at a time. */
  readonly mobileShowList = signal(false);

  readonly roomLabel = CHAT_ROOM_LABEL;
  readonly roomMembers = ROOM_MEMBERS;
  readonly roleLabel = ROLE_LABEL;
  readonly getInitials = getInitials;

  readonly canSend = computed(() => this.draft().trim() !== '' && !this.sending() && this.activeRoom() !== null);

  readonly typingLabel = computed(() => {
    const names = this.typing().map((u) => u.name.split(' ')[0]);
    if (names.length === 0) return '';
    if (names.length === 1) return `${names[0]} is typing…`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
    return `${names[0]} and ${names.length - 1} others are typing…`;
  });

  readonly timeline = computed<TimelineItem[]>(() => {
    const me = this.user()?.id;
    const messages = this.chat.messages();

    return messages.map((message, i) => {
      const prev = i > 0 ? messages[i - 1] : null;
      const sameSender = prev?.sender.id === message.sender.id;
      const withinGap =
        prev !== null &&
        new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() < BLOCK_GAP_MS;
      const dayChanged = prev === null || !isSameDay(prev.createdAt, message.createdAt);

      return {
        message,
        own: message.sender.id === me,
        startsBlock: dayChanged || !sameSender || !withinGap,
        daySeparator: dayChanged ? dayLabel(message.createdAt) : null,
      };
    });
  });

  /** True while the view is scrolled to (or near) the newest message. */
  private pinnedToBottom = true;
  /** Scroll height captured just before older messages prepend, so the view can hold its place. */
  private restoreAnchorHeight: number | null = null;

  constructor() {
    void this.init();

    // Scrolling has to happen after the DOM holds the new messages, otherwise scrollHeight
    // is a frame behind — hence afterRenderEffect rather than a plain effect.
    afterRenderEffect(() => {
      this.chat.messages();
      const el = this.scroller()?.nativeElement;
      if (!el) return;

      if (this.restoreAnchorHeight !== null) {
        el.scrollTop = el.scrollHeight - this.restoreAnchorHeight;
        this.restoreAnchorHeight = null;
        return;
      }

      if (this.pinnedToBottom) el.scrollTop = el.scrollHeight;
    });
  }

  private async init(): Promise<void> {
    try {
      // Room summaries are already loaded by ChatService at sign-in (for the sidebar badge).
      const first = this.rooms()[0];
      if (first) await this.chat.openRoom(first);
    } catch {
      this.error.set('Could not load the chat. Try refreshing the page.');
    }
  }

  ngOnDestroy(): void {
    this.chat.closeRoom();
  }

  // ─── Conversation list ───

  summaryFor(room: ChatRoomKey) {
    return this.roomSummaries().find((r) => r.room === room) ?? null;
  }

  unreadFor(room: ChatRoomKey): number {
    return this.summaryFor(room)?.unread ?? 0;
  }

  /** "You: message" / "Casey: message" — the one-line preview under each conversation name. */
  previewFor(room: ChatRoomKey): string {
    const last = this.summaryFor(room)?.lastMessage;
    if (!last) return 'No messages yet';
    if (last.deleted) return 'This message was deleted';

    const who = last.sender.id === this.user()?.id ? 'You' : last.sender.name.split(' ')[0];
    return `${who}: ${last.body}`;
  }

  previewTimeFor(room: ChatRoomKey): string {
    const last = this.summaryFor(room)?.lastMessage;
    return last ? listTime(last.createdAt) : '';
  }

  async switchRoom(room: ChatRoomKey): Promise<void> {
    this.mobileShowList.set(false);
    if (room === this.activeRoom()) return;

    this.error.set(null);
    this.cancelEdit();
    this.openMenuId.set(null);
    this.pinnedToBottom = true;
    await this.chat.openRoom(room);
  }

  // ─── Scrolling ───

  onScroll(): void {
    const el = this.scroller()?.nativeElement;
    if (!el) return;
    // 60px of slack so a near-bottom read still counts as pinned.
    this.pinnedToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }

  async loadOlder(): Promise<void> {
    const el = this.scroller()?.nativeElement;
    if (!el) return;

    // Anchor on the current scroll height so the view doesn't jump when older messages prepend.
    this.pinnedToBottom = false;
    this.restoreAnchorHeight = el.scrollHeight;

    const countBefore = this.chat.messages().length;
    await this.chat.loadOlder();

    // Nothing arrived — clear the anchor so it can't misfire on the next incoming message.
    if (this.chat.messages().length === countBefore) this.restoreAnchorHeight = null;
  }

  // ─── Composer ───

  onDraftInput(value: string): void {
    this.draft.set(value);
    this.chat.notifyTyping(value.trim() !== '');
  }

  /** Enter sends; Shift+Enter drops a newline. */
  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void this.send();
  }

  async send(): Promise<void> {
    if (!this.canSend()) return;

    const body = this.draft().trim();
    this.sending.set(true);
    this.error.set(null);
    this.pinnedToBottom = true;

    try {
      await this.chat.send(body);
      this.draft.set('');
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Message could not be sent.');
    } finally {
      this.sending.set(false);
    }
  }

  // ─── Per-message menu ───

  toggleMenu(id: string): void {
    this.openMenuId.update((open) => (open === id ? null : id));
  }

  closeMenu(): void {
    this.openMenuId.set(null);
  }

  startEdit(message: ChatMessage): void {
    this.closeMenu();
    this.editingId.set(message.id);
    this.editDraft.set(message.body);
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.editDraft.set('');
  }

  onEditKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancelEdit();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.saveEdit();
    }
  }

  async saveEdit(): Promise<void> {
    const id = this.editingId();
    const body = this.editDraft().trim();
    if (!id || body === '') return;

    try {
      await this.chat.edit(id, body);
      this.cancelEdit();
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Message could not be edited.');
    }
  }

  /** Admin can remove anyone's message; everyone else only their own. */
  canDelete(message: ChatMessage): boolean {
    if (message.deleted) return false;
    return message.sender.id === this.user()?.id || this.user()?.role === 'ADMIN';
  }

  canEdit(message: ChatMessage): boolean {
    return !message.deleted && message.sender.id === this.user()?.id;
  }

  hasMenu(message: ChatMessage): boolean {
    return this.canEdit(message) || this.canDelete(message);
  }

  async remove(message: ChatMessage): Promise<void> {
    this.closeMenu();
    if (!confirm('Delete this message? Everyone in the channel will see it removed.')) return;

    try {
      await this.chat.remove(message.id);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Message could not be deleted.');
    }
  }

  // ─── Display helpers ───

  time(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  /** Stable per-person colour so you can tell speakers apart without reading the name. */
  nameColor(id: string): string {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return NAME_COLORS[Math.abs(hash) % NAME_COLORS.length];
  }
}

function isSameDay(a: string, b: string): boolean {
  const d1 = new Date(a);
  const d2 = new Date(b);
  return (
    d1.getDate() === d2.getDate() && d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear()
  );
}

function dayLabel(iso: string): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(iso, today.toISOString())) return 'Today';
  if (isSameDay(iso, yesterday.toISOString())) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Conversation-list timestamp: time today, "Yesterday", otherwise a short date. */
function listTime(iso: string): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(iso, today.toISOString())) {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  if (isSameDay(iso, yesterday.toISOString())) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}
