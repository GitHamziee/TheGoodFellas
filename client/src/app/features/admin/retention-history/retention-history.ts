import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { LucideFileText } from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { apiErrorMessage } from '../../../core/api';
import { createListView } from '../../../core/list-view';
import { formatDate, formatDateTime, getAvatarTone, getInitials, humanizeEnum, pluralize } from '../../../core/format-utils';
import {
  RetentionHistoryRow,
  RetentionHistoryState,
  RetentionTimelineEntry,
  RetentionTimelineKind,
} from '../../../core/models/retention-history.model';
import { chargeBackMonthLabel } from '../../../core/lead-options';
import { Modal } from '../../../shared/ui/modal';
import { EmptyState, Pagination, SearchBox, SkeletonRows } from '../../../shared/ui/ui';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';

/** The window the page tracks a lead over. */
const BOOK_MONTHS = 12;
const MONTHS_SHOWN = 6;

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

/** Where the lead sits in the pipeline right now. */
function stageOf(l: RetentionHistoryRow): string {
  switch (l.status) {
    case 'NEW':
      return 'With retention';
    case 'SUBMITTED':
      return 'In admin queue';
    case 'ASSIGNED':
      return 'With client, awaiting decision';
    case 'ACCEPTED':
      return l.state === 'ACTIVE' ? 'Approved, paid' : 'Approved, awaiting payment';
    case 'REJECTED':
      return 'Rejected by client';
    case 'RETURNED_TO_RETENTION':
      return 'Sent back to retention';
    case 'ASSIGNED_EXTERNAL':
      return 'With external client';
    case 'CHARGED_BACK':
      return 'Charged back, awaiting reassignment';
    default:
      return humanizeEnum(l.status);
  }
}

const KIND_LABEL: Record<RetentionTimelineKind, string> = {
  CREATED: 'Lead created',
  ASSIGNED_TO_RETENTION: 'Assigned to retention',
  SUBMITTED: 'Worked and submitted',
  RETURNED_TO_RETENTION: 'Sent back to retention',
  ASSIGNED_TO_CLIENT: 'Assigned to client',
  ASSIGNED_EXTERNAL: 'Handed to external client',
  ACCEPTED: 'Approved by Admin',
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
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideFileText,
  ],
  templateUrl: './retention-history.html',
  styles: `
    .glance { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); background: var(--surface, #fff); border: 1px solid var(--gray-200, #e5e7eb); border-radius: 12px; margin-bottom: 1rem; overflow: hidden; }
    .g { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.7rem 1rem; border-left: 3px solid transparent; box-shadow: -1px 0 0 var(--gray-100, #f3f4f6); }
    .g-num { font-size: 1.45rem; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .g-label { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--gray-500); }
    .g--bad { border-left-color: var(--danger-600, #dc2626); }
    .g--bad .g-num { color: var(--danger-600, #dc2626); }
    .g--warn { border-left-color: #d99a1d; }
    .g--good { border-left-color: var(--success-600, #16a34a); }
    .monthly { --paid: #2a78d6; --charged: #eb6834; padding: 0.8rem 1rem 0.6rem; margin-bottom: 1rem; }
    @media (prefers-color-scheme: dark) { :root:where(:not([data-theme='light'])) .monthly { --paid: #3987e5; --charged: #d95926; } }
    :root[data-theme='dark'] .monthly { --paid: #3987e5; --charged: #d95926; }
    .m-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.3rem 1rem; margin-bottom: 0.5rem; }
    .m-title { font-weight: 700; font-size: 0.9rem; }
    .m-legend { display: flex; gap: 1rem; font-size: 0.78rem; color: var(--gray-600); }
    .m-legend i { display: inline-block; width: 0.6rem; height: 0.6rem; border-radius: 2px; margin-right: 0.35rem; }
    .m-plot { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.5rem; height: 120px; border-bottom: 1px solid var(--gray-200, #e5e7eb); }
    .m-grp { position: relative; display: flex; align-items: flex-end; justify-content: center; gap: 2px; outline: none; border-radius: 6px; }
    .m-grp:hover, .m-grp:focus-visible { background: var(--gray-50, #f9fafb); }
    .m-col { width: 100%; max-width: 24px; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; height: 100%; }
    .m-bar { width: 100%; border-radius: 4px 4px 0 0; min-height: 2px; }
    .m-bar--paid { background: var(--paid); }
    .m-bar--charged { background: var(--charged); }
    .m-val { font-size: 0.7rem; font-weight: 600; color: var(--gray-700, #374151); font-variant-numeric: tabular-nums; margin-bottom: 2px; }
    .m-tip { display: none; position: absolute; bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%); z-index: 5; white-space: nowrap; background: var(--surface, #fff); border: 1px solid var(--gray-200, #e5e7eb); border-radius: 8px; padding: 0.4rem 0.6rem; font-size: 0.75rem; box-shadow: 0 4px 14px rgba(0,0,0,0.12); }
    .m-grp:hover .m-tip, .m-grp:focus-visible .m-tip { display: block; }
    .m-tip b { font-variant-numeric: tabular-nums; }
    .m-axis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.5rem; margin-top: 0.3rem; text-align: center; font-size: 0.72rem; color: var(--gray-500); }
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
  private readonly liveReload = reloadOnChange(() => this.refresh());
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
  readonly stage = stageOf;
  readonly kindLabel = (k: RetentionTimelineKind) => KIND_LABEL[k];
  readonly monthLabel = chargeBackMonthLabel;
  readonly kindTone = (k: RetentionTimelineKind) => KIND_TONE[k] ?? '';

  readonly stateOptions = computed(() =>
    (Object.keys(STATE_LABEL) as RetentionHistoryState[]).filter((value) => value !== 'PENDING').map((value) => ({
      value,
      label: STATE_LABEL[value],
      count: this.leads().filter((l) => l.state === value).length,
    })),
  );

  readonly stats = computed(() => {
    const rows = this.leads();
    const booked = rows.filter((l) => l.monthsOnBook !== null);
    const charged = rows.filter((l) => l.chargeBackCount > 0);
    // A charge-back only happens to a paid lead, so "ever paid" is the base for the rate.
    const everPaid = rows.filter((l) => l.paidAt !== null || l.chargeBackCount > 0).length;
    return {
      needsReassignment: rows.filter((l) => l.status === 'CHARGED_BACK').length,
      awaitingDecision: rows.filter((l) => l.status === 'ASSIGNED').length,
      active: rows.filter((l) => l.state === 'ACTIVE').length,
      chargeBackRate: everPaid ? Math.round((charged.length / everPaid) * 100) : 0,
      chargedBack: charged.length,
      everPaid,
      avgMonths: booked.length
        ? Math.round((booked.reduce((s, l) => s + (l.monthsOnBook ?? 0), 0) / booked.length) * 10) / 10
        : 0,
    };
  });

  /** Last six calendar months: leads first marked paid vs charge-backs recorded. */
  readonly monthly = computed(() => {
    const now = new Date();
    const key = (d: Date) => d.getFullYear() * 12 + d.getMonth();
    const months = Array.from({ length: MONTHS_SHOWN }, (_, i) => new Date(now.getFullYear(), now.getMonth() - (MONTHS_SHOWN - 1) + i, 1));
    const paid = new Map<number, number>();
    const charged = new Map<number, number>();
    for (const l of this.leads()) {
      if (l.paidAt) paid.set(key(new Date(l.paidAt)), (paid.get(key(new Date(l.paidAt))) ?? 0) + 1);
      for (const at of l.chargeBackDates) charged.set(key(new Date(at)), (charged.get(key(new Date(at))) ?? 0) + 1);
    }
    const rows = months.map((m) => ({
      label: m.toLocaleString('en-US', { month: 'short' }),
      full: m.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
      paid: paid.get(key(m)) ?? 0,
      charged: charged.get(key(m)) ?? 0,
    }));
    const max = Math.max(1, ...rows.map((r) => Math.max(r.paid, r.charged)));
    return rows.map((r) => ({ ...r, paidPct: (r.paid / max) * 80, chargedPct: (r.charged / max) * 80 }));
  });

  readonly view = createListView<RetentionHistoryRow>({
    source: this.leads,
    searchFields: (l) => [l.customerName, stageOf(l), l.closer, l.reassignedTo, l.retainedBy, ...l.workedBy],
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
    await this.loadDetail(row.id);
  }

  /** Live refresh: reload the list, and the timeline too if a lead's popup is open. */
  private async refresh(): Promise<void> {
    const open = this.selected();
    await Promise.all([this.ngOnInit(), open ? this.loadDetail(open.id) : Promise.resolve()]);
  }

  private async loadDetail(id: string): Promise<void> {
    if (!isSilentReload()) this.detailLoading.set(true);
    try {
      const detail = await this.leadService.retentionLifecycleDetail(id);
      if (this.selected()?.id !== id) return;
      this.selected.set(detail.lead);
      this.timeline.set(detail.timeline);
      this.detailError.set(null);
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
