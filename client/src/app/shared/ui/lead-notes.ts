import { Component, booleanAttribute, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideMessageSquare, LucidePlus, LucideSend, LucideStickyNote } from '@lucide/angular';
import { apiErrorMessage } from '../../core/api';
import { formatDate, formatDateTime, getAvatarTone, getInitials } from '../../core/format-utils';
import { LeadNote } from '../../core/models/lead.model';
import { AuthService } from '../../core/services/auth.service';
import { LeadService } from '../../core/services/lead.service';
import { Modal } from './modal';

/**
 * Latest follow-up note on a lead, shown in place on the admin-style lists so Admin sees it at
 * a glance. Clicking opens the full note history; for a Retention Manager the same modal also
 * has the composer, and a lead with no notes yet shows an "Add note" link — so notes can be
 * added straight from the list without opening the lead.
 */
@Component({
  selector: 'app-note-peek',
  imports: [FormsModule, Modal, LucideMessageSquare, LucidePlus, LucideSend, LucideStickyNote],
  host: { '(click)': '$event.stopPropagation()', '[class.is-compact]': 'compact()' },
  template: `
    @if (compact()) {
      <!-- Notes column: just the count; hover shows the latest note, click opens them all. -->
      @if (latest(); as n) {
        <button type="button" class="count" (click)="open()" [title]="n.author.name + ': ' + n.body">
          <svg lucideMessageSquare></svg> {{ total() }}
        </button>
      } @else if (canAdd()) {
        <button type="button" class="count count--add" (click)="open()" title="Add note" aria-label="Add note">
          <svg lucidePlus></svg>
        </button>
      } @else {
        <span class="none">—</span>
      }
    } @else if (latest(); as n) {
      <button type="button" class="peek" (click)="open()" title="Open notes">
        <svg lucideStickyNote></svg>
        <span class="txt">
          <span class="body">{{ n.body }}</span>
          <span class="meta">
            {{ n.author.name }} · {{ formatDate(n.createdAt) }}@if (total() > 1) { · +{{ total() - 1 }} more }
          </span>
        </span>
      </button>
    } @else if (canAdd()) {
      <button type="button" class="peek peek--add" (click)="open()">
        <svg lucidePlus></svg> Add note
      </button>
    }

    @if (modalOpen()) {
      <app-modal title="Notes" [subtitle]="name()" (close)="modalOpen.set(false)">
        @if (error()) {
          <div class="error">{{ error() }}</div>
        }
        @if (canAdd()) {
          <form (ngSubmit)="add()" class="composer">
            <textarea
              rows="3"
              name="note"
              maxlength="2000"
              placeholder="Add a note…"
              [ngModel]="text()"
              (ngModelChange)="text.set($event)"
            ></textarea>
            <button type="submit" class="btn" [disabled]="saving() || !text().trim()">
              <svg lucideSend></svg> Add note
            </button>
          </form>
        }
        @for (note of history(); track note.id) {
          <div class="note">
            <div class="note-meta">
              <span class="avatar-sm" [class]="getAvatarTone(note.author.id)">{{ getInitials(note.author.name) }}</span>
              <strong>{{ note.author.name }}</strong>
              <span class="when">{{ formatDateTime(note.createdAt) }}</span>
            </div>
            <p class="note-body">{{ note.body }}</p>
          </div>
        } @empty {
          @if (!loading()) {
            <p class="when">No notes yet.</p>
          }
        }
      </app-modal>
    }
  `,
  styles: `
    :host { display: block; margin-top: 0.25rem; }
    :host(.is-compact) { display: inline-block; margin-top: 0; }
    .count {
      display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.3rem 0.55rem;
      border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface);
      color: var(--text); font: inherit; font-size: 0.8rem; font-weight: 600; cursor: pointer;
      font-variant-numeric: tabular-nums;
    }
    .count:hover { border-color: var(--gray-400); }
    .count svg { width: 14px; height: 14px; }
    .count--add { color: var(--gray-500); border-style: dashed; }
    .none { color: var(--gray-400); }
    .peek {
      display: inline-flex; align-items: flex-start; gap: 0.4rem; max-width: 22rem; padding: 0.25rem 0.5rem;
      border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--gray-50);
      color: var(--text); font: inherit; font-size: 0.75rem; text-align: left; cursor: pointer;
    }
    .peek:hover { border-color: var(--gray-500); }
    .peek svg { width: 13px; height: 13px; flex: none; margin-top: 0.15rem; }
    .peek--add { align-items: center; color: var(--gray-500); background: transparent; border-style: dashed; }
    .peek--add svg { margin-top: 0; }
    .txt { display: flex; flex-direction: column; min-width: 0; }
    .body { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; white-space: pre-wrap; }
    .meta, .when { color: var(--gray-500); font-size: 0.7rem; }
    .composer { display: flex; flex-direction: column; align-items: flex-start; gap: 0.5rem; margin-bottom: 1rem; }
    .composer textarea { width: 100%; }
    .note { border-top: 1px solid var(--border); padding: 0.75rem 0; }
    .note-meta { display: flex; align-items: center; gap: 0.5rem; }
    .note-body { margin: 0.375rem 0 0; white-space: pre-wrap; }
  `,
})
export class NotePeek {
  private readonly leadService = inject(LeadService);
  private readonly auth = inject(AuthService);

  readonly leadId = input.required<string>();
  readonly name = input('');
  /** The newest note as sent with the list row. */
  readonly notes = input<LeadNote[] | undefined>(undefined);
  /** Total notes on the lead as sent with the list row. */
  readonly count = input<number | undefined>(undefined);
  /** Table-cell variant: a count button instead of the latest note's text. */
  readonly compact = input(false, { transform: booleanAttribute });

  readonly canAdd = computed(() => this.auth.role() === 'RETENTION_MANAGER');

  /** Notes added from here since the row last loaded — shown immediately, dropped on the next reload. */
  private readonly added = signal<LeadNote[]>([]);
  readonly latest = computed(() => this.added()[0] ?? this.notes()?.[0] ?? null);
  readonly total = computed(() => (this.count() ?? this.notes()?.length ?? 0) + this.added().length);

  readonly modalOpen = signal(false);
  readonly history = signal<LeadNote[]>([]);
  readonly loading = signal(false);
  readonly text = signal('');
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly formatDate = formatDate;
  readonly formatDateTime = formatDateTime;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  constructor() {
    effect(() => {
      this.notes();
      untracked(() => this.added.set([]));
    });
  }

  async open(): Promise<void> {
    this.modalOpen.set(true);
    this.error.set(null);
    this.text.set('');
    this.loading.set(true);
    try {
      this.history.set(await this.leadService.leadNotes(this.leadId()));
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not load notes.'));
    } finally {
      this.loading.set(false);
    }
  }

  async add(): Promise<void> {
    const body = this.text().trim();
    if (!body || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const note = await this.leadService.addLeadNote(this.leadId(), body);
      this.history.update((h) => [note, ...h]);
      this.added.update((a) => [note, ...a]);
      this.text.set('');
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not save the note.'));
    } finally {
      this.saving.set(false);
    }
  }
}
