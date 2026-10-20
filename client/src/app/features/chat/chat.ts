import {
  Component,
  ElementRef,
  OnDestroy,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideArrowLeft,
  LucideBell,
  LucideBellOff,
  LucideCheck,
  LucideChevronDown,
  LucideCircleAlert,
  LucideDownload,
  LucideFile,
  LucideLoaderCircle,
  LucideMessageSquare,
  LucidePaperclip,
  LucidePencil,
  LucideSearch,
  LucideSendHorizontal,
  LucideTrash2,
  LucidePlus,
  LucideSettings,
  LucideUsers,
  LucideX,
} from '@lucide/angular';
import { ChatService } from '../../core/services/chat.service';
import { AuthService } from '../../core/services/auth.service';
import { ChatAttachment, ChatMessage, ChatRoomKey, GroupCandidate } from '../../core/models/chat.model';
import { Modal } from '../../shared/ui/modal';
import { ROLE_LABEL } from '../../core/nav-config';
import {
  formatDate,
  formatFileSize,
  formatTime,
  getAvatarTone,
  getInitials,
  pacificIsoDate,
  pacificParts,
  pacificStartOfDay,
} from '../../core/format-utils';
import { apiErrorMessage } from '../../core/api';

/** Generous — matches the server's MAX_ATTACHMENT_BYTES (see chat.service.ts on the server). */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

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

const GROUP_SECTIONS: { role: GroupCandidate['role']; title: string }[] = [
  { role: 'CLIENT', title: 'Clients' },
  { role: 'MANAGER', title: 'Managers' },
  { role: 'TEAM_LEAD', title: 'Team Leads' },
  { role: 'ADMIN', title: 'Admins' },
  // Only ever populated when editing a built-in channel (custom groups exclude these roles).
  { role: 'CLOSER', title: 'Closers' },
  { role: 'JUNIOR_CLOSER', title: 'Junior Closers' },
  { role: 'RETENTION', title: 'Retention' },
  { role: 'QA_CLOSER', title: 'QA — Closer' },
  { role: 'QA_JUNIOR_CLOSER', title: 'QA — Junior Closer' },
];

const ROOM_MEMBERS: Record<string, string> = {
  CLOSERS: 'All closers + team lead + managers + admin',
  JUNIOR_CLOSERS: 'All junior closers + team lead + managers + admin',
  TEAM_LEADS: 'All team leads + managers + admin',
  RETENTION: 'All retention + managers + admin',
};

@Component({
  selector: 'app-chat',
  imports: [
    FormsModule,
    Modal,
    LucidePlus,
    LucideSettings,
    LucideSendHorizontal,
    LucideUsers,
    LucideMessageSquare,
    LucidePencil,
    LucideTrash2,
    LucideCircleAlert,
    LucideChevronDown,
    LucideCheck,
    LucideArrowLeft,
    LucideBell,
    LucideBellOff,
    LucidePaperclip,
    LucideFile,
    LucideDownload,
    LucideLoaderCircle,
    LucideSearch,
    LucideX,
  ],
  templateUrl: './chat.html',
  styleUrl: './chat.css',
})
export class Chat implements OnDestroy {
  private readonly chat = inject(ChatService);
  private readonly auth = inject(AuthService);

  private readonly scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  readonly user = this.auth.user;
  readonly canMute = this.chat.canMute;
  readonly isMuted = (room: ChatRoomKey) => this.chat.isMuted(room);
  readonly toggleMute = (room: ChatRoomKey) => this.chat.toggleMute(room);
  readonly rooms = this.chat.availableRooms;
  readonly activeRoom = this.chat.activeRoom;
  readonly connected = this.chat.connected;
  readonly loading = this.chat.loading;
  readonly hasMore = this.chat.hasMore;
  readonly typing = this.chat.typing;
  readonly roomSummaries = this.chat.rooms;

  readonly hasNewer = this.chat.hasNewer;
  readonly listTimeOf = (message: ChatMessage) => listTime(message.createdAt);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  readonly searchOpen = signal(false);
  readonly searchQuery = signal('');
  /** The results list stands in for the messages while a query is active. */
  readonly searchResultsShown = computed(() => this.searchOpen() && this.searchQuery().trim().length >= 2);
  readonly searchResults = signal<ChatMessage[]>([]);
  readonly searching = signal(false);
  readonly highlightId = signal<string | null>(null);
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private highlightTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly ready = signal(false);
  readonly draft = signal('');
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly editDraft = signal('');
  /** Which message's action menu is open — only one at a time. */
  readonly openMenuId = signal<string | null>(null);
  /** Mobile: the list and the conversation share the screen, one at a time. */
  readonly mobileShowList = signal(false);
  readonly uploading = signal(false);
  readonly maxAttachmentBytes = MAX_ATTACHMENT_BYTES;

  /** Object URLs for image attachments, fetched lazily (see the effect in the constructor)
   * since <img> can't carry the Bearer token an attachment download needs. Revoked in
   * ngOnDestroy — nothing else ever clears one once a room has been opened this session. */
  private readonly imagePreviews = signal<Map<string, string>>(new Map());

  readonly roomLabel = (room: ChatRoomKey) => this.chat.labelFor(room);

  /** Header subtitle: the explicit roster for a custom group, the role description otherwise. */
  membersFor(room: ChatRoomKey): string {
    const members = this.summaryFor(room)?.members;
    if (members) return members.map((m) => (m.id === this.user()?.id ? 'You' : m.name)).join(', ');
    return ROOM_MEMBERS[room] ?? '';
  }
  readonly roleLabel = ROLE_LABEL;
  readonly getInitials = getInitials;
  readonly avatarTone = getAvatarTone;
  readonly formatFileSize = formatFileSize;

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

  readonly loadingOlder = signal(false);

  /** True while the view is scrolled to (or near) the newest message. */
  private pinnedToBottom = true;
  /** Scroll height captured just before older messages prepend, so the view can hold its place. */
  private restoreAnchorHeight: number | null = null;

  constructor() {
    void this.init();

    // The open group was deleted (or you were removed from it): land on the first chat left.
    effect(() => {
      if (this.ready() && !this.activeRoom() && !this.chat.loading()) {
        const first = this.rooms()[0];
        if (first) void this.chat.openRoom(first);
      }
    });

    // Scrolling has to happen after the DOM holds the new messages, otherwise scrollHeight
    // is a frame behind — hence afterRenderEffect rather than a plain effect.
    afterRenderEffect(() => {
      this.chat.messages();
      // The message list only exists in the DOM once loading flips off, which happens after
      // messages are set — without this dependency the scroll ran against the "Loading…" stub.
      const loading = this.chat.loading();
      const jumpTarget = this.chat.jumpTarget();
      const el = this.scroller()?.nativeElement;
      if (!el) return;

      // Arrived here from a search result: centre the match instead of pinning to the bottom.
      if (jumpTarget && !loading && this.revealMessage(jumpTarget)) {
        this.chat.clearJumpTarget();
        return;
      }

      if (this.restoreAnchorHeight !== null) {
        el.scrollTop = el.scrollHeight - this.restoreAnchorHeight;
        this.restoreAnchorHeight = null;
        return;
      }

      if (this.pinnedToBottom) el.scrollTop = el.scrollHeight;
    });

    // Lazily fetches a preview for any image attachment that just came into view (new
    // message, page of history, room switch) and doesn't have one cached yet.
    effect(() => {
      for (const message of this.chat.messages()) {
        const attachment = message.attachment;
        if (attachment && isImageAttachment(attachment) && !this.imagePreviews().has(message.id)) {
          void this.loadPreview(message.id, attachment);
        }
      }
    });
  }

  private async loadPreview(messageId: string, attachment: ChatAttachment): Promise<void> {
    try {
      const blob = await this.chat.fetchAttachmentBlob(attachment);
      const url = URL.createObjectURL(blob);
      this.imagePreviews.update((map) => new Map(map).set(messageId, url));
    } catch {
      // Leave it uncached — the file chip + "Save" button below still works as a fallback.
    }
  }

  previewUrlFor(message: ChatMessage): string | null {
    return this.imagePreviews().get(message.id) ?? null;
  }

  isImage(attachment: ChatAttachment): boolean {
    return isImageAttachment(attachment);
  }

  private async init(): Promise<void> {
    try {
      // Refreshed here too: a direct page load can land before the sign-in fetch resolves.
      await this.chat.loadRooms();
      const first = this.rooms()[0];
      if (first) await this.chat.openRoom(first);
      this.ready.set(true);
    } catch {
      this.error.set('Could not load the chat. Try refreshing the page.');
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchTimer);
    clearTimeout(this.highlightTimer);
    this.chat.closeRoom();
    for (const url of this.imagePreviews().values()) URL.revokeObjectURL(url);
  }

  // ─── New group (admin) ───

  readonly isAdmin = computed(() => this.user()?.role === 'ADMIN');
  readonly groupOpen = signal(false);
  readonly groupName = signal('');
  readonly groupFilter = signal('');
  readonly candidates = signal<GroupCandidate[]>([]);
  readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  readonly creatingGroup = signal(false);
  readonly groupError = signal<string | null>(null);

  readonly visibleCandidates = computed(() => {
    const q = this.groupFilter().trim().toLowerCase();
    return q ? this.candidates().filter((c) => c.name.toLowerCase().includes(q)) : this.candidates();
  });
  /** Picker sections, one per role, in a fixed order. Empty sections are dropped. */
  readonly candidateSections = computed(() =>
    GROUP_SECTIONS.map((section) => ({
      ...section,
      people: this.visibleCandidates().filter((c) => c.role === section.role),
    })).filter((section) => section.people.length > 0)
  );
  readonly selectedPeople = computed(() => this.candidates().filter((c) => this.selectedIds().has(c.id)));

  /** Section-level select-all: ticks everyone in the section, or clears them if all were ticked. */
  toggleSection(people: GroupCandidate[]): void {
    const next = new Set(this.selectedIds());
    const allOn = people.every((p) => next.has(p.id));
    for (const p of people) {
      if (allOn) next.delete(p.id);
      else next.add(p.id);
    }
    this.selectedIds.set(next);
  }

  sectionAllOn(people: GroupCandidate[]): boolean {
    return people.every((p) => this.selectedIds().has(p.id));
  }

  readonly canCreateGroup = computed(
    () => this.groupName().trim() !== '' && this.selectedIds().size > 0 && !this.creatingGroup()
  );

  /** Set while editing an existing group; null means the modal is creating a new one. */
  readonly editingRoom = signal<ChatRoomKey | null>(null);
  /** Custom groups can be deleted; built-in channels can be edited but not removed. */
  readonly editingCustomGroup = computed(() => !!this.editingRoom()?.startsWith('g_'));

  async openGroupModal(editRoom: ChatRoomKey | null = null): Promise<void> {
    const summary = editRoom ? this.summaryFor(editRoom) : null;
    const builtin = !!editRoom && !editRoom.startsWith('g_');
    this.editingRoom.set(editRoom);
    this.groupName.set(summary?.label ?? '');
    this.groupFilter.set('');
    this.candidates.set([]);
    this.selectedIds.set(new Set());
    this.groupError.set(null);
    this.groupOpen.set(true);
    try {
      // Editing starts from the current roster (minus you — you always stay in). A built-in
      // channel's roster is role-derived, so it comes from the server rather than the summary.
      const me = this.user()?.id;
      const members = builtin ? (await this.chat.builtinRoster(editRoom!)).members : (summary?.members ?? []);
      this.selectedIds.set(new Set(members.map((m) => m.id).filter((id) => id !== me)));
      this.candidates.set(await this.chat.groupCandidates(builtin));
    } catch {
      this.groupError.set('Could not load people to add.');
    }
  }

  toggleCandidate(id: string): void {
    const next = new Set(this.selectedIds());
    if (!next.delete(id)) next.add(id);
    this.selectedIds.set(next);
  }

  async saveGroup(): Promise<void> {
    if (!this.canCreateGroup()) return;
    this.creatingGroup.set(true);
    this.groupError.set(null);
    try {
      const editing = this.editingRoom();
      const name = this.groupName().trim();
      const ids = [...this.selectedIds()];
      if (editing) {
        await this.chat.updateGroup(editing, name, ids);
        this.groupOpen.set(false);
      } else {
        const room = await this.chat.createGroup(name, ids);
        this.groupOpen.set(false);
        await this.switchRoom(room);
      }
    } catch (err) {
      this.groupError.set(apiErrorMessage(err, 'Could not save the group.'));
    } finally {
      this.creatingGroup.set(false);
    }
  }

  async deleteGroup(): Promise<void> {
    const room = this.editingRoom();
    if (!room || !confirm(`Delete "${this.roomLabel(room)}" for everyone? All its messages and files are removed.`)) return;
    this.creatingGroup.set(true);
    try {
      await this.chat.deleteGroup(room);
      this.groupOpen.set(false);
    } catch (err) {
      this.groupError.set(apiErrorMessage(err, 'Could not delete the group.'));
    } finally {
      this.creatingGroup.set(false);
    }
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
    const what = last.body || (last.attachment ? `📎 ${last.attachment.name}` : '');
    return `${who}: ${what}`;
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
    this.closeSearch();
    await this.chat.openRoom(room);
  }

  // ─── Scrolling ───

  onScroll(): void {
    const el = this.scroller()?.nativeElement;
    if (!el) return;
    // 60px of slack so a near-bottom read still counts as pinned.
    this.pinnedToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;

    // WhatsApp-style: reaching the top pulls in the previous page, no button needed.
    if (el.scrollTop < 120 && this.hasMore() && !this.loadingOlder() && !this.chat.loading() && this.chat.messages().length > 0) {
      void this.loadOlder();
    }
  }

  // ─── Search ───

  /** Debounced so typing doesn't fire a request per keystroke. */
  onSearchInput(value: string): void {
    this.searchQuery.set(value);
    clearTimeout(this.searchTimer);

    const term = value.trim();
    const room = this.activeRoom();
    if (term.length < 2 || !room) {
      this.searchResults.set([]);
      this.searching.set(false);
      return;
    }

    this.searching.set(true);
    this.searchTimer = setTimeout(async () => {
      try {
        const results = await this.chat.search(room, term);
        // Drop a stale response if the user kept typing.
        if (this.searchQuery().trim() === term) this.searchResults.set(results);
      } catch {
        if (this.searchQuery().trim() === term) this.searchResults.set([]);
      } finally {
        if (this.searchQuery().trim() === term) this.searching.set(false);
      }
    }, 300);
  }

  toggleSearch(): void {
    if (this.searchOpen()) {
      this.closeSearch();
      return;
    }
    this.searchOpen.set(true);
    // The input only exists once the bar renders.
    setTimeout(() => this.searchInput()?.nativeElement.focus());
  }

  /** Closes the bar and forgets the query — also called when switching to another group. */
  closeSearch(): void {
    clearTimeout(this.searchTimer);
    this.searchOpen.set(false);
    this.searchQuery.set('');
    this.searchResults.set([]);
    this.searching.set(false);
  }

  /** The matched text split around the first hit, so the template can bold it. */
  snippet(message: ChatMessage): { pre: string; hit: string; post: string } {
    const text = message.body || message.attachment?.name || '';
    const term = this.searchQuery().trim();
    const at = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1;
    if (at === -1) return { pre: text.slice(0, 80), hit: '', post: '' };

    const start = Math.max(0, at - 24);
    return {
      pre: (start > 0 ? '…' : '') + text.slice(start, at),
      hit: text.slice(at, at + term.length),
      post: text.slice(at + term.length, at + term.length + 60),
    };
  }

  async openResult(message: ChatMessage): Promise<void> {
    this.error.set(null);
    this.cancelEdit();
    this.openMenuId.set(null);
    // The results panel covers the conversation, so picking a hit closes it.
    this.closeSearch();

    // Already loaded: ask the view to scroll to it once it's visible again.
    // Otherwise load a window around it (the view scrolls itself when that lands).
    if (this.chat.messages().some((m) => m.id === message.id)) {
      this.chat.requestJump(message.id);
      return;
    }
    try {
      await this.chat.openRoom(message.room, message.id);
    } catch {
      this.error.set('Could not open that message. Try again.');
    }
  }

  async jumpToLatest(): Promise<void> {
    const room = this.activeRoom();
    if (!room) return;
    this.pinnedToBottom = true;
    await this.chat.openRoom(room);
  }

  /** Centres a loaded message and flashes it; false when it isn't in the DOM yet. */
  private revealMessage(id: string): boolean {
    const node = this.scroller()?.nativeElement.querySelector(`[data-mid="${id}"]`);
    if (!node) return false;

    this.pinnedToBottom = false;
    node.scrollIntoView({ block: 'center' });
    this.highlightId.set(id);
    clearTimeout(this.highlightTimer);
    this.highlightTimer = setTimeout(() => this.highlightId.set(null), 2200);
    return true;
  }

  /** Images grow the list after the initial scroll — keep following the bottom if we were there. */
  onMediaLoad(): void {
    const el = this.scroller()?.nativeElement;
    if (el && this.pinnedToBottom) el.scrollTop = el.scrollHeight;
  }

  async loadOlder(): Promise<void> {
    const el = this.scroller()?.nativeElement;
    if (!el || this.loadingOlder()) return;

    // Anchor on the current scroll height so the view doesn't jump when older messages prepend.
    this.pinnedToBottom = false;
    this.restoreAnchorHeight = el.scrollHeight;
    this.loadingOlder.set(true);

    const countBefore = this.chat.messages().length;
    try {
      await this.chat.loadOlder();
    } catch {
      // Network blip — the next scroll near the top retries.
    } finally {
      this.loadingOlder.set(false);
    }

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
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Message could not be sent.'));
    } finally {
      this.sending.set(false);
    }
  }

  // ─── Attachments ───

  triggerFilePick(): void {
    if (!this.activeRoom() || this.uploading()) return;
    this.fileInput()?.nativeElement.click();
  }

  /** Whatever's already typed in the composer goes along as the file's caption, the same
   * way an email client sends the file with the draft body. */
  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = ''; // clears the picker so choosing the same file twice fires change again

    const room = this.activeRoom();
    if (!file || !room) return;

    if (file.size > MAX_ATTACHMENT_BYTES) {
      this.error.set(`"${file.name}" is too large — ${formatFileSize(MAX_ATTACHMENT_BYTES)} max.`);
      return;
    }

    this.uploading.set(true);
    this.error.set(null);
    this.pinnedToBottom = true;

    try {
      await this.chat.sendFile(file, this.draft());
      this.draft.set('');
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'File could not be sent.'));
    } finally {
      this.uploading.set(false);
    }
  }

  /** Fetches the attachment (carrying the auth header, unlike a plain link) and saves it
   * under its original filename. */
  async downloadAttachment(attachment: ChatAttachment): Promise<void> {
    try {
      const blob = await this.chat.fetchAttachmentBlob(attachment);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.name;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      this.error.set('Could not download this file.');
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
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Message could not be edited.'));
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
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Message could not be deleted.'));
    }
  }

  // ─── Display helpers ───

  time(iso: string): string {
    return formatTime(iso);
  }

  /** Stable per-person colour so you can tell speakers apart without reading the name. */
  nameColor(id: string): string {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return NAME_COLORS[Math.abs(hash) % NAME_COLORS.length];
  }
}

function isImageAttachment(attachment: ChatAttachment): boolean {
  return !!attachment.type?.startsWith('image/');
}

function isSameDay(a: string, b: string): boolean {
  return pacificIsoDate(a) === pacificIsoDate(b);
}

/** Pacific-time ISO date for "yesterday". */
function yesterdayIso(): string {
  const p = pacificParts();
  return pacificIsoDate(pacificStartOfDay(p.year, p.month, p.day - 1));
}

function dayLabel(iso: string): string {
  const day = pacificIsoDate(iso);
  if (day === pacificIsoDate()) return 'Today';
  if (day === yesterdayIso()) return 'Yesterday';
  return formatDate(iso);
}

/** Conversation-list timestamp: time today, "Yesterday", otherwise a short date. */
function listTime(iso: string): string {
  const day = pacificIsoDate(iso);
  if (day === pacificIsoDate()) return formatTime(iso);
  if (day === yesterdayIso()) return 'Yesterday';
  return formatDate(iso);
}
