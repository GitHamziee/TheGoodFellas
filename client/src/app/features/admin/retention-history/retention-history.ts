import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { LucideClock, LucideFileText, LucideShieldCheck, LucideTriangleAlert } from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { apiErrorMessage } from '../../../core/api';
import { createListView } from '../../../core/list-view';
import { formatDate, formatDateTime, getAvatarTone, getInitials, pluralize } from '../../../core/format-utils';
import {
  RetentionHistoryRow,
  RetentionHistoryState,
  RetentionTimelineEntry,
  RetentionTimelineKind,
} from '../../../core/models/retention-history.model';
import { Modal } from '../../../shared/ui/modal';
import { EmptyState, Pagination, SearchBox, SkeletonRows, StatTile } from '../../../shared/ui/ui';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';

/** The window the page tracks a lead over. */
const BOOK_MONTHS = 12;

const STATE_LABEL: Record<RetentionHistoryState, string> = {
  PENDING: 'Pending',
  ACTIVE: 'Active',
  CHARGED_BACK: 'Charged back',
  RETAINED: 'Retained',
};

const STATE_BADGE: Record<RetentionHistoryState, string> = {
  PENDING: 'badge--submitted',
  ACTIVE: 'badge--accepted',
  CHARGED_BACK: 'badge--rejected',
  RETAINED: 'badge--assigned',
};

const KIND_LABEL: Record<RetentionTimelineKind, string> = {
  CREATED: 'Lead created',
  ASSIGNED_TO_RETENTION: 'Assigned to retention',
  SUBMITTED: 'Worked and submitted',
  RETURNED_TO_RETENTION: 'Sent back to retention',
  ASSIGNED_TO_CLIENT: 'Assigned to client',
  ASSIGNED_EXTERNAL: 'Handed to external client',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  PAID: 'Marked paid',
  CHARGED_BACK: 'Charged back',
};

const KIND_TONE: Partial<Record<RetentionTimelineKind, string>> = {
  ACCEPTED: 'dot--good',
  PAID: 'dot--good',
  REJECTED: 'dot--bad',
  CHARGED_BACK: 'dot--bad',
  RETURNED_TO_RETENTION: 'dot--warn',
};

@Component({
  selector: 'app-retention-history',
  imports: [
    Modal,
    StatTile,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideFileText,
    LucideClock,
    LucideTriangleAlert,
    LucideShieldCheck,
  ],
  templateUrl: './retention-history.html',
  styles: `
    .pills { margin-bottom: 1rem; }
    .book { display: flex; align-items: center; gap: 0.6rem; min-width: 150px; }
    .book-track { flex: 1; height: 6px; border-radius: 999px; background: var(--gray-100); overflow: hidden; }
    .book-bar { display: block; height: 100%; border-radius: 999px; background: var(--gold-500); }
    .book-bar--over { background: var(--success-600, #16a34a); }
    .book-val { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.9rem 1.2rem; margin-bottom: 1.4rem; }
    .summary dt { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--gray-500); }
    .summary dd { margin: 0.15rem 0 0; font-weight: 600; }
    .timeline { list-style: none; margin: 0; padding: 0 0 0 1.4rem; position: relative; }
    .timeline::before { content: ''; position: absolute; left: 0.42rem; top: 0.4rem; bottom: 0.4rem; width: 2px; background: var(--gray-200, #e5e7eb); }
    .timeline li { position: relative; padding: 0 0 1.1rem; }
    .timeline li:last-child { padding-bottom: 0; }
    .dot { position: absolute; left: -1.4rem; top: 0.3rem; width: 0.9rem; height: 0.9rem; border-radius: 50%; background: var(--gold-500); border: 2px solid var(--surface, #fff); box-sizing: border-box; box-shadow: 0 0 0 1px var(--gold-500); }
    .dot--good { background: var(--success-600, #16a34a); box-shadow: 0 0 0 1px var(--success-600, #16a34a); }
    .dot--bad { background: var(--danger-600, #dc2626); box-shadow: 0 0 0 1px var(--danger-600, #dc2626); }
    .dot--warn { background: var(--warning-600, #d97706); box-shadow: 0 0 0 1px var(--warning-600, #d97706); }
    .tl-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.2rem 1rem; }
    .tl-title { font-weight: 700; }
    .tl-when { color: var(--gray-500); font-size: 0.78rem; }
    .tl-detail { color: var(--gray-600); font-size: 0.85rem; margin-top: 0.1rem; }
  `,
})
export class RetentionHistory implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly leadService = inject(LeadService);

  readonly leads = signal<RetentionHistoryRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly selected = signal<RetentionHistoryRow | null>(null);
  readonly timeline = signal<RetentionTimelineEntry[]>([]);
  readonly detailLoading = signal(false);
  readonly detailError = signal<string | null>(null);

  readonly bookMonths = BOOK_MONTHS;
  readonly formatDate = formatDate;
  readonly formatDateTime = formatDateTime;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly pluralize = pluralize;
  readonly stateLabel = (s: RetentionHistoryState) => STATE_LABEL[s];
  readonly stateBadge = (s: RetentionHistoryState) => STATE_BADGE[s];
  readonly kindLabel = (k: RetentionTimelineKind) => KIND_LABEL[k];
  readonly kindTone = (k: RetentionTimelineKind) => KIND_TONE[k] ?? '';

  readonly stateOptions = computed(() =>
    (Object.keys(STATE_LABEL) as RetentionHistoryState[]).map((value) => ({
      value,
      label: STATE_LABEL[value],
      count: this.leads().filter((l) => l.state === value).length,
    })),
  );

  readonly stats = computed(() => {
    const rows = this.leads();
    const booked = rows.filter((l) => l.monthsOnBook !== null);
    const charged = rows.filter((l) => l.chargeBackCount > 0);
    return {
      total: rows.length,
      chargedBack: charged.length,
      retained: rows.filter((l) => l.state === 'RETAINED').length,
      avgMonths: booked.length
        ? Math.round((booked.reduce((s, l) => s + (l.monthsOnBook ?? 0), 0) / booked.length) * 10) / 10
        : 0,
    };
  });

  readonly view = createListView<RetentionHistoryRow>({
    source: this.leads,
    searchFields: (l) => [l.customerName, l.closer, l.reassignedTo, l.retainedBy, ...l.workedBy],
    statusOf: (l) => l.state,
    sorters: {
      customerName: (l) => l.customerName,
      createdAt: (l) => new Date(l.createdAt).getTime(),
      monthsOnBook: (l) => l.monthsOnBook ?? -1,
      chargedBackAt: (l) => (l.chargedBackAt ? new Date(l.chargedBackAt).getTime() : 0),
    },
    initialSort: { key: 'createdAt', dir: 'desc' },
    pageSize: 10,
  });

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }

  barPct(months: number | null): number {
    return Math.min(100, Math.round(((months ?? 0) / BOOK_MONTHS) * 100));
  }

  async open(row: RetentionHistoryRow): Promise<void> {
    this.selected.set(row);
    this.timeline.set([]);
    this.detailError.set(null);
    this.detailLoading.set(true);
    try {
      const detail = await this.leadService.retentionLifecycleDetail(row.id);
      this.selected.set(detail.lead);
      this.timeline.set(detail.timeline);
    } catch (err) {
      this.detailError.set(apiErrorMessage(err, 'Could not load this lead’s timeline.'));
    } finally {
      this.detailLoading.set(false);
    }
  }

  async ngOnInit(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      this.leads.set(await this.leadService.retentionLifecycle());
      this.error.set(null);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not load retention history. Refresh to try again.'));
    } finally {
      this.loading.set(false);
    }
  }
}
