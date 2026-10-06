import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideCircleCheck,
  LucideCircleX,
  LucideClock,
  LucideLayers,
  LucideTarget,
  LucideUsers,
} from '@lucide/angular';
import { AnalyticsService } from '../../core/services/analytics.service';
import { QaLane, QaLeadSummary, QaPerson, QaReviewRow, QaTransferDetail } from '../../core/models/review.model';
import { createListView } from '../../core/list-view';
import { formatDate, formatDateTime, getAvatarTone, getInitials, humanizeEnum, timeAgo } from '../../core/format-utils';
import { Modal } from '../../shared/ui/modal';
import { Select, SelectOption } from '../../shared/ui/select';
import { EmptyState, Pagination, SearchBox, SkeletonRows, StatTile } from '../../shared/ui/ui';
import { QaLeadPeek, QaVerdict } from './qa-lead-peek';
import {
  RANGE_PILLS,
  RangeKey,
  bucketIndex,
  daysBetween,
  daysSince,
  inRange,
  lastWeeks,
  median,
  passRate,
  topReasons,
} from './qa-stats';
import { reloadOnChange } from '../../core/live-reload';

type Tab = 'overview' | 'failures' | 'pending' | 'reviewers';

interface PersonRow {
  id: string;
  name: string;
  email: string;
  reviewed: number;
  pass: number;
  fail: number;
  rate: number | null;
  /** Pass-rate change in points, last 30 days vs the 30 before; null when either side is empty. */
  delta: number | null;
  lastFail: string | null;
  pending: number;
}

interface ReviewerRow {
  id: string;
  name: string;
  reviewed: number;
  pass: number;
  fail: number;
  commentPct: number;
}

interface PendingRow extends QaLeadSummary {
  ageDays: number;
}

const DAY = 86400000;
const WEEKS = 8;

/**
 * Transfer Report — how QA scored the leads a lane's people submitted (Junior Closer intake or
 * Closer enrichment). Built from raw review rows so every number can be traced to a lead:
 * scoreboard, weekly trend, failure log with QA's comments, the unreviewed backlog, and a
 * per-QA-reviewer consistency view. Aggregation is in memory (see analytics.service.ts).
 */
@Component({
  selector: 'app-qa-transfer-report',
  imports: [
    FormsModule,
    Modal,
    Select,
    StatTile,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    QaLeadPeek,
    LucideCircleCheck,
    LucideCircleX,
    LucideClock,
    LucideLayers,
    LucideTarget,
    LucideUsers,
  ],
  templateUrl: './qa-transfer-report.html',
})
export class QaTransferReport implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly analytics = inject(AnalyticsService);

  readonly lane = input.required<QaLane>();
  readonly subtitle = input('');
  readonly peopleLabel = input('People');

  readonly detail = signal<QaTransferDetail>({ people: [], reviews: [], pending: [] });
  readonly loading = signal(true);
  readonly error = signal('');

  readonly tab = signal<Tab>('overview');
  readonly range = signal<RangeKey>('');
  readonly from = signal('');
  readonly to = signal('');
  readonly personId = signal('');

  readonly selectedPerson = signal<PersonRow | null>(null);
  readonly peek = signal<{ lead: QaLeadSummary; verdict: QaVerdict | null } | null>(null);

  readonly rangePills = RANGE_PILLS;
  readonly timeAgo = timeAgo;
  readonly formatDate = formatDate;
  readonly formatDateTime = formatDateTime;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly humanizeEnum = humanizeEnum;

  async ngOnInit(): Promise<void> {
    try {
      this.detail.set(await this.analytics.qaTransfer(this.lane()));
    } catch {
      this.error.set('Could not load the report. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  /** The person a review/lead is attributed to in this lane. */
  personOf(lead: QaLeadSummary): QaPerson | null {
    return this.lane() === 'junior' ? lead.juniorCloser : lead.closer;
  }

  readonly personOptions = computed<SelectOption[]>(() => [
    { value: '', label: 'Everyone' },
    ...this.detail().people.map((p) => ({ value: p.id, label: p.name })),
  ]);

  // Reviews for the chosen person only (any date) — feeds trend, coverage and deltas.
  private readonly personReviews = computed(() => {
    const id = this.personId();
    return this.detail().reviews.filter((r) => !id || this.personOf(r.lead)?.id === id);
  });

  /** Person + date range — everything the tiles, failure log and reviewer view use. */
  readonly scoped = computed(() => {
    const [range, from, to] = [this.range(), this.from(), this.to()];
    return this.personReviews().filter((r) => inRange(r.createdAt, range, from, to));
  });

  readonly pendingScoped = computed(() => {
    const id = this.personId();
    return this.detail().pending.filter((l) => !id || this.personOf(l)?.id === id);
  });

  readonly tiles = computed(() => {
    const rows = this.scoped();
    const pass = rows.filter((r) => r.outcome === 'PASS').length;
    const fail = rows.length - pass;
    const pending = this.pendingScoped().length;
    const allReviewed = this.personReviews().length;
    const lag = median(rows.map((r) => daysBetween(r.lead.createdAt, r.createdAt)));
    return {
      reviewed: rows.length,
      pass,
      fail,
      rate: passRate(pass, fail),
      pending,
      coverage: allReviewed + pending === 0 ? null : Math.round((allReviewed / (allReviewed + pending)) * 100),
      lag: lag === null ? null : Math.round(Math.max(0, lag) * 10) / 10,
    };
  });

  private weeklyBuckets(reviews: QaReviewRow[]) {
    const weeks = lastWeeks(WEEKS);
    const buckets = weeks.map((w) => ({ label: w.label, pass: 0, fail: 0 }));
    for (const r of reviews) {
      const i = bucketIndex(r.createdAt, weeks);
      if (i < 0) continue;
      if (r.outcome === 'PASS') buckets[i].pass += 1;
      else buckets[i].fail += 1;
    }
    const max = Math.max(1, ...buckets.map((b) => b.pass + b.fail));
    return buckets.map((b) => ({
      ...b,
      total: b.pass + b.fail,
      rate: passRate(b.pass, b.fail),
      heightPct: ((b.pass + b.fail) / max) * 100,
      passPct: b.pass + b.fail === 0 ? 0 : (b.pass / (b.pass + b.fail)) * 100,
    }));
  }

  /** Last 8 weeks of pass/fail for the chosen person (ignores the date pills on purpose). */
  readonly trend = computed(() => this.weeklyBuckets(this.personReviews()));

  readonly people = computed<PersonRow[]>(() => {
    const id = this.personId();
    const [range, from, to] = [this.range(), this.from(), this.to()];
    const now = Date.now();
    const pendingBy = new Map<string, number>();
    for (const l of this.detail().pending) {
      const p = this.personOf(l);
      if (p) pendingBy.set(p.id, (pendingBy.get(p.id) ?? 0) + 1);
    }
    const all = this.detail().reviews;
    const rateOf = (rows: QaReviewRow[]) =>
      passRate(rows.filter((r) => r.outcome === 'PASS').length, rows.filter((r) => r.outcome === 'FAIL').length);
    return this.detail()
      .people.filter((p) => !id || p.id === id)
      .map((p) => {
        const mine = all.filter((r) => this.personOf(r.lead)?.id === p.id);
        const inScope = mine.filter((r) => inRange(r.createdAt, range, from, to));
        const pass = inScope.filter((r) => r.outcome === 'PASS').length;
        const fail = inScope.length - pass;
        const recent = mine.filter((r) => now - new Date(r.createdAt).getTime() < 30 * DAY);
        const prior = mine.filter((r) => {
          const age = now - new Date(r.createdAt).getTime();
          return age >= 30 * DAY && age < 60 * DAY;
        });
        const [recentRate, priorRate] = [rateOf(recent), rateOf(prior)];
        const lastFail = mine.find((r) => r.outcome === 'FAIL')?.createdAt ?? null; // reviews arrive newest-first
        return {
          id: p.id,
          name: p.name,
          email: p.email,
          reviewed: inScope.length,
          pass,
          fail,
          rate: passRate(pass, fail),
          delta: recentRate === null || priorRate === null ? null : recentRate - priorRate,
          lastFail,
          pending: pendingBy.get(p.id) ?? 0,
        };
      });
  });

  readonly peopleView = createListView<PersonRow>({
    source: this.people,
    searchFields: (p) => [p.name, p.email],
    sorters: {
      name: (p) => p.name,
      reviewed: (p) => p.reviewed,
      fail: (p) => p.fail,
      rate: (p) => p.rate,
      pending: (p) => p.pending,
    },
    initialSort: { key: 'fail', dir: 'desc' },
    pageSize: 10,
  });

  readonly failures = computed(() => this.scoped().filter((r) => r.outcome === 'FAIL'));

  readonly failuresView = createListView<QaReviewRow>({
    source: this.failures,
    searchFields: (r) => [r.lead.customerName, this.personOf(r.lead)?.name, r.reviewer.name, r.comment, r.lead.state],
    sorters: {
      customer: (r) => r.lead.customerName,
      person: (r) => this.personOf(r.lead)?.name,
      createdAt: (r) => new Date(r.createdAt).getTime(),
    },
    initialSort: { key: 'createdAt', dir: 'desc' },
    pageSize: 10,
  });

  readonly reasons = computed(() => topReasons(this.failures().map((r) => r.comment)));

  readonly pendingRows = computed<PendingRow[]>(() =>
    this.pendingScoped().map((l) => ({ ...l, ageDays: daysSince(l.createdAt) })),
  );

  readonly pendingView = createListView<PendingRow>({
    source: this.pendingRows,
    searchFields: (l) => [l.customerName, this.personOf(l)?.name, l.state],
    sorters: {
      customer: (l) => l.customerName,
      person: (l) => this.personOf(l)?.name,
      age: (l) => l.ageDays,
    },
    initialSort: { key: 'age', dir: 'desc' },
    pageSize: 10,
  });

  readonly reviewers = computed<ReviewerRow[]>(() => {
    const by = new Map<string, ReviewerRow & { withComment: number }>();
    for (const r of this.scoped()) {
      const row = by.get(r.reviewer.id) ?? {
        id: r.reviewer.id,
        name: r.reviewer.name,
        reviewed: 0,
        pass: 0,
        fail: 0,
        commentPct: 0,
        withComment: 0,
      };
      row.reviewed += 1;
      if (r.outcome === 'PASS') row.pass += 1;
      else row.fail += 1;
      if (r.comment?.trim()) row.withComment += 1;
      by.set(r.reviewer.id, row);
    }
    return [...by.values()]
      .map((r) => ({ ...r, commentPct: Math.round((r.withComment / r.reviewed) * 100) }))
      .sort((a, b) => b.reviewed - a.reviewed);
  });

  /** A person's full review history (any date) for the person panel. */
  readonly personHistory = computed(() => {
    const p = this.selectedPerson();
    if (!p) return [];
    return this.detail().reviews.filter((r) => this.personOf(r.lead)?.id === p.id);
  });

  readonly personTrend = computed(() => this.weeklyBuckets(this.personHistory()));

  setRange(range: RangeKey): void {
    this.range.set(range);
    this.from.set('');
    this.to.set('');
  }

  setFrom(v: string): void {
    this.from.set(v);
    this.range.set('');
  }

  setTo(v: string): void {
    this.to.set(v);
    this.range.set('');
  }

  openReview(r: QaReviewRow): void {
    this.peek.set({
      lead: r.lead,
      verdict: { outcome: r.outcome, comment: r.comment, reviewer: r.reviewer, createdAt: r.createdAt },
    });
  }

  openLead(lead: QaLeadSummary): void {
    this.peek.set({ lead, verdict: null });
  }

  sortArrow(view: { sortKey(): string | null; sortDir(): string }, key: string): string {
    if (view.sortKey() !== key) return '';
    return view.sortDir() === 'asc' ? '↑' : '↓';
  }

  deltaText(d: number | null): string {
    if (d === null) return '—';
    if (d === 0) return '0 pts';
    return `${d > 0 ? '▲' : '▼'} ${Math.abs(d)} pts`;
  }

  deltaClass(d: number | null): string {
    return d === null || d === 0 ? 'delta' : d > 0 ? 'delta delta--up' : 'delta delta--down';
  }
}
