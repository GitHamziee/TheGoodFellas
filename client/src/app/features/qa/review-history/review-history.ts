import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { LucideCircleCheck, LucideClock } from '@lucide/angular';
import { AuthService } from '../../../core/services/auth.service';
import { LeadService } from '../../../core/services/lead.service';
import { LeadReviewRow, QaCloserLeadRow, QaJuniorLeadRow, ReviewOutcome } from '../../../core/models/review.model';
import { createListView } from '../../../core/list-view';
import { formatDateTime, formatPhone, timeAgo } from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import { LeadDetail } from '../../../shared/lead-detail';
import { Detail, EmptyState, Pagination, SearchBox, SkeletonRows, StatTile } from '../../../shared/ui/ui';

type QaRow = QaJuniorLeadRow | QaCloserLeadRow;

/** Review History — mounted at both /qa-junior and /qa-closer, same lane-by-role pattern as ReviewQueue. */
@Component({
  selector: 'app-qa-review-history',
  imports: [Modal, LeadDetail, Detail, StatTile, SearchBox, Pagination, EmptyState, SkeletonRows, LucideClock, LucideCircleCheck],
  templateUrl: './review-history.html',
  styleUrl: '../review-queue/review-queue.css',
})
export class QaReviewHistory implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly leadService = inject(LeadService);

  readonly lane = computed(() => (this.auth.role() === 'QA_JUNIOR_CLOSER' ? 'JUNIOR_CLOSER' : 'CLOSER'));

  readonly reviews = signal<LeadReviewRow<QaRow>[]>([]);
  readonly loading = signal(true);
  readonly selected = signal<LeadReviewRow<QaRow> | null>(null);

  readonly formatPhone = formatPhone;
  readonly formatDateTime = formatDateTime;
  readonly timeAgo = timeAgo;

  readonly passCount = computed(() => this.reviews().filter((r) => r.outcome === 'PASS').length);
  readonly failCount = computed(() => this.reviews().filter((r) => r.outcome === 'FAIL').length);

  readonly view = createListView<LeadReviewRow<QaRow>>({
    source: this.reviews,
    searchFields: (r) => [r.lead.customerName, r.lead.phone],
    statusOf: (r) => r.outcome,
    sorters: {
      customerName: (r) => r.lead.customerName,
      createdAt: (r) => new Date(r.createdAt).getTime(),
    },
    initialSort: { key: 'createdAt', dir: 'desc' },
    pageSize: 10,
  });

  readonly outcomeFilters: { label: string; value: '' | ReviewOutcome }[] = [
    { label: 'All', value: '' },
    { label: 'Pass', value: 'PASS' },
    { label: 'Fail', value: 'FAIL' },
  ];

  readonly juniorDetailRows = computed(() => {
    const sel = this.selected();
    if (!sel || this.lane() !== 'JUNIOR_CLOSER') return [];
    const j = sel.lead as QaJuniorLeadRow;
    const row = (k: string, v: unknown, formatted?: string) =>
      v === null || v === undefined || v === '' ? null : { k, v: formatted ?? String(v) };
    return [
      row('Phone', j.phone, formatPhone(j.phone)),
      row('State', j.state),
      row('Zipcode', j.zipcode),
      row('Marital status', j.maritalStatus),
      row('Gender', j.gender),
      row('Date of birth', j.dob),
      row('Age', j.age),
      row('Smoker', j.smoker, j.smoker === null || j.smoker === undefined ? undefined : j.smoker ? 'Yes' : 'No'),
      row('Health conditions', j.healthConditions),
      row('Need', j.need),
      row('Income source', j.incomeSource),
      row('Annual income', j.annualIncome),
      row('Junior closer notes', j.juniorNotes),
      row('D-code', j.dCode),
    ].filter((r): r is { k: string; v: string } => r !== null);
  });

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    try {
      this.reviews.set(
        this.lane() === 'JUNIOR_CLOSER' ? await this.leadService.qaJuniorHistory() : await this.leadService.qaCloserHistory(),
      );
    } finally {
      this.loading.set(false);
    }
  }

  outcomeClass(outcome: ReviewOutcome): string {
    return outcome === 'PASS' ? 'badge badge--accepted' : 'badge badge--rejected';
  }

  outcomeText(outcome: ReviewOutcome): string {
    return outcome === 'PASS' ? 'Pass' : 'Fail';
  }
}
