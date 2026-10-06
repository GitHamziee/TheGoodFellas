import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { LucideCircleCheck, LucideCircleX, LucideClipboardCheck } from '@lucide/angular';
import { AuthService } from '../../../core/services/auth.service';
import { LeadService } from '../../../core/services/lead.service';
import { QaCloserLeadRow, QaJuniorLeadRow, ReviewOutcome } from '../../../core/models/review.model';
import { createListView } from '../../../core/list-view';
import { formatPhone, timeAgo } from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import { LeadDetail } from '../../../shared/lead-detail';
import { EmptyState, Pagination, SearchBox, SkeletonRows, StatTile, StatusBadge } from '../../../shared/ui/ui';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';

type QaRow = QaJuniorLeadRow | QaCloserLeadRow;

/**
 * Review Queue — mounted at both /qa-junior and /qa-closer (see the "ONE shared component"
 * convention used by chat/settings). Which lane's leads/fields show up is entirely
 * determined by the logged-in user's role, read from AuthService.
 */
@Component({
  selector: 'app-qa-review-queue',
  imports: [
    Modal,
    LeadDetail,
    StatTile,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    StatusBadge,
    LucideClipboardCheck,
    LucideCircleCheck,
    LucideCircleX,
  ],
  templateUrl: './review-queue.html',
  styleUrl: './review-queue.css',
})
export class QaReviewQueue implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.reload());
  private readonly auth = inject(AuthService);
  private readonly leadService = inject(LeadService);

  readonly lane = computed(() => (this.auth.role() === 'QA_JUNIOR_CLOSER' ? 'JUNIOR_CLOSER' : 'CLOSER'));
  readonly subtitle = computed(() =>
    this.lane() === 'JUNIOR_CLOSER'
      ? "Leads a junior closer submitted — review the intake information they entered."
      : "Leads a closer enriched — review the policy, billing and identity detail they entered.",
  );

  readonly leads = signal<QaRow[]>([]);
  readonly loading = signal(true);
  readonly selected = signal<QaRow | null>(null);
  readonly outcome = signal<ReviewOutcome>('PASS');
  readonly comment = signal('');
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly formatPhone = formatPhone;
  readonly timeAgo = timeAgo;

  readonly view = createListView<QaRow>({
    source: this.leads,
    searchFields: (l) => [l.customerName, l.phone, l.state],
    sorters: {
      customerName: (l) => l.customerName,
      createdAt: (l) => new Date(l.createdAt).getTime(),
    },
    initialSort: { key: 'createdAt', dir: 'desc' },
    pageSize: 10,
  });

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      this.leads.set(
        this.lane() === 'JUNIOR_CLOSER' ? await this.leadService.qaJuniorQueue() : await this.leadService.qaCloserQueue(),
      );
    } finally {
      this.loading.set(false);
    }
  }

  openReview(row: QaRow): void {
    this.selected.set(row);
    this.outcome.set('PASS');
    this.comment.set('');
    this.error.set(null);
  }

  async submit(): Promise<void> {
    const row = this.selected();
    if (!row) return;

    this.submitting.set(true);
    this.error.set(null);
    try {
      await this.leadService.submitQaReview(row.id, this.outcome(), this.comment());
      this.leads.update((rows) => rows.filter((r) => r.id !== row.id));
      this.selected.set(null);
    } catch {
      this.error.set('Could not save the review. It may have already been reviewed — refresh and try again.');
    } finally {
      this.submitting.set(false);
    }
  }
}
