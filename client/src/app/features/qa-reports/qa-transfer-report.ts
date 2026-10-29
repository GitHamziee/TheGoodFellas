import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideCircleCheck, LucideUsers } from '@lucide/angular';
import { AnalyticsService } from '../../core/services/analytics.service';
import { QaLane, QaLeadSummary, QaPerson, QaReviewRow, QaTransferDetail } from '../../core/models/review.model';
import { createListView } from '../../core/list-view';
import {
  formatDate,
  formatDateTime,
  getAvatarTone,
  getInitials,
  humanizeEnum,
  pacificStartOfDay,
  timeAgo,
} from '../../core/format-utils';
import { Modal } from '../../shared/ui/modal';
import { Select, SelectOption } from '../../shared/ui/select';
import { EmptyState, Pagination, SearchBox, SkeletonRows } from '../../shared/ui/ui';
import { QaLeadPeek, QaVerdict } from './qa-lead-peek';
import { bucketIndex, daysBetween, daysSince, lastWeeks, median, passRate, topReasons } from './qa-stats';
import { reloadOnChange } from '../../core/live-reload';
import { DateInput } from '../../shared/ui/date-input';

type Tab = 'overview' | 'failures' | 'pending' | 'reviewers';

/** Rolling look-back windows — rolling rather than calendar so "vs prior period" compares like with like. */
type Period = '7' | '30' | '90' | 'all';

const PERIODS: { label: string; value: Period }[] = [
  { label: '7d', value: '7' },
  { label: '30d', value: '30' },
  { label: '90d', value: '90' },
  { label: 'All', value: 'all' },
];

/** [start, end) in epoch ms; start null = open-ended. */
interface Span {
  start: number | null;
  end: number;
}

interface Delta {
  text: string;
  cls: string;
}

interface PersonRow {
  id: string;
  name: string;
  email: string;
  reviewed: number;
  pass: number;
  fail: number;
  rate: number | null;
  /** Pass-rate change in points vs the prior period (or last 30d vs the 30 before, on "All"); null when either side is empty. */
  delta: number | null;
  lastFail: string | null;
  pending: number;
  /** Weekly pass rate for the last WEEKS weeks (null = no reviews that week) — drives the row sparkline. */
  spark: (number | null)[];
  /** Most repeated QA comment on this person's fails in the period. */
  topIssue: { text: string; count: number } | null;
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
/** Below this pass rate — or falling at least COACH_DROP points — a person lands in "Needs coaching". */
const COACH_RATE = 75;
const COACH_DROP = 5;
const COACH_MIN_REVIEWS = 3;

/** Start of the Pacific day after a yyyy-MM-dd string (so `to` is inclusive). */
function dayStart(iso: string, offset = 0): number {
  const [y, m, d] = iso.split('-').map(Number);
  return pacificStartOfDay(y, m, d + offset);
}

function inSpan(dateStr: string, span: Span | null): boolean {
  if (!span) return true;
  const t = new Date(dateStr).getTime();
  return (span.start === null || t >= span.start) && t < span.end;
}

/**
 * Transfer Report — how QA scored the leads a lane's people submitted (Junior Closer intake or
 * Closer enrichment). Built from raw review rows so every number can be traced to a lead.
 * Laid out around the admin's three questions: who needs coaching (and on what), is QA keeping
 * up (backlog age, reviewer throughput), and does a QA fail predict a client reject/charge-back.
 * Aggregation is in memory (see analytics.service.ts).
 */
@Component({
  selector: 'app-qa-transfer-report',
  imports: [
    DateInput,
    FormsModule,
    Modal,
    Select,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    QaLeadPeek,
    LucideCircleCheck,
    LucideUsers,
  ],
  templateUrl: './qa-transfer-report.html',
})
export class QaTransferReport implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly analytics = inject(AnalyticsService);

  readonly lane = input.required<QaLane>();
  readonly peopleLabel = input('People');

  readonly detail = signal<QaTransferDetail>({ people: [], reviews: [], pending: [] });
  readonly loading = signal(true);
  readonly error = signal('');

  readonly tab = signal<Tab>('overview');
  readonly range = signal<Period>('30');
  readonly from = signal('');
  readonly to = signal('');
  readonly personId = signal('');

  /** The two date boxes stay tucked behind a "Custom" pill until asked for (or a custom range is active). */
  readonly customOpen = signal(false);
  readonly showCustom = computed(() => this.customOpen() || !!this.from() || !!this.to());

  readonly selectedPerson = signal<PersonRow | null>(null);
  readonly peek = signal<{ lead: QaLeadSummary; verdict: QaVerdict | null } | null>(null);

  readonly periods = PERIODS;
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

  /** The selected period; null = all time. */
  private readonly span = computed<Span | null>(() => {
    const [from, to] = [this.from(), this.to()];
    if (from || to) return { start: from ? dayStart(from) : null, end: to ? dayStart(to, 1) : Date.now() };
    const p = this.range();
    if (p === 'all') return null;
    const end = Date.now();
    return { start: end - Number(p) * DAY, end };
  });

  /** The equal-length window right before the selected one — what every delta compares against. */
  private readonly priorSpan = computed<Span | null>(() => {
    const s = this.span();
    if (!s || s.start === null) return null;
    return { start: s.start - (s.end - s.start), end: s.start };
  });

  readonly priorLabel = computed(() => {
    if (this.from() || this.to()) return 'vs prior period';
    const p = this.range();
    return p === 'all' ? 'vs prior 30d' : `vs prior ${p}d`;
  });

  // Reviews for the chosen person only (any date) — feeds trend, coverage and deltas.
  private readonly personReviews = computed(() => {
    const id = this.personId();
    return this.detail().reviews.filter((r) => !id || this.personOf(r.lead)?.id === id);
  });

  /** Person + period — everything the tiles, failure log and reviewer view use. */
  readonly scoped = computed(() => {
    const span = this.span();
    return this.personReviews().filter((r) => inSpan(r.createdAt, span));
  });

  private readonly priorScoped = computed(() => {
    const prior = this.priorSpan();
    return prior ? this.personReviews().filter((r) => inSpan(r.createdAt, prior)) : null;
  });

  readonly pendingScoped = computed(() => {
    const id = this.personId();
    return this.detail().pending.filter((l) => !id || this.personOf(l)?.id === id);
  });

  private stats(rows: QaReviewRow[]) {
    const pass = rows.filter((r) => r.outcome === 'PASS').length;
    const lag = median(rows.map((r) => daysBetween(r.lead.createdAt, r.createdAt)));
    return {
      reviewed: rows.length,
      pass,
      fail: rows.length - pass,
      rate: passRate(pass, rows.length - pass),
      lag: lag === null ? null : Math.round(Math.max(0, lag) * 10) / 10,
    };
  }

  readonly tiles = computed(() => {
    const now = this.stats(this.scoped());
    const priorRows = this.priorScoped();
    const prior = priorRows && priorRows.length > 0 ? this.stats(priorRows) : null;
    const pending = this.pendingRows();
    const allReviewed = this.personReviews().length;
    const total = allReviewed + pending.length;
    return {
      ...now,
      rateTone: now.rate === null ? '' : this.rateTone(now.rate),
      rateDelta: this.delta(now.rate !== null && prior?.rate != null ? now.rate - prior.rate : null, ' pts'),
      failDelta: this.delta(prior ? now.fail - prior.fail : null, '', false),
      lagDelta: this.delta(
        now.lag !== null && prior?.lag != null ? Math.round((now.lag - prior.lag) * 10) / 10 : null,
        'd',
        false,
      ),
      pending: pending.length,
      staleCount: pending.filter((l) => l.ageDays >= 7).length,
      coverage: total === 0 ? null : Math.round((allReviewed / total) * 100),
      coverageOf: `${allReviewed} of ${total} leads`,
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

  /** Last 8 weeks of pass/fail for the chosen person (ignores the period on purpose). */
  readonly trend = computed(() => this.weeklyBuckets(this.personReviews()));

  readonly people = computed<PersonRow[]>(() => {
    const id = this.personId();
    const span = this.span();
    const now = Date.now();
    // On "All" there is no prior window, so the row delta falls back to last 30d vs the 30 before.
    const recentSpan: Span = span && span.start !== null ? span : { start: now - 30 * DAY, end: now };
    const priorSpan: Span = { start: recentSpan.start! - (recentSpan.end - recentSpan.start!), end: recentSpan.start! };
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
        const inScope = mine.filter((r) => inSpan(r.createdAt, span));
        const pass = inScope.filter((r) => r.outcome === 'PASS').length;
        const fail = inScope.length - pass;
        const recentRate = rateOf(mine.filter((r) => inSpan(r.createdAt, recentSpan)));
        const priorRate = rateOf(mine.filter((r) => inSpan(r.createdAt, priorSpan)));
        const fails = inScope.filter((r) => r.outcome === 'FAIL');
        return {
          id: p.id,
          name: p.name,
          email: p.email,
          reviewed: inScope.length,
          pass,
          fail,
          rate: passRate(pass, fail),
          delta: recentRate === null || priorRate === null ? null : recentRate - priorRate,
          lastFail: mine.find((r) => r.outcome === 'FAIL')?.createdAt ?? null, // reviews arrive newest-first
          pending: pendingBy.get(p.id) ?? 0,
          spark: this.weeklyBuckets(mine).map((b) => b.rate),
          topIssue: topReasons(fails.map((r) => r.comment), 1)[0] ?? null,
        };
      });
  });

  /** People whose pass rate is low or sliding, worst (most fails) first. */
  readonly coaching = computed(() =>
    this.people()
      .filter(
        (p) =>
          p.reviewed >= COACH_MIN_REVIEWS &&
          p.rate !== null &&
          (p.rate < COACH_RATE || (p.delta !== null && p.delta <= -COACH_DROP)),
      )
      .sort((a, b) => b.fail - a.fail || (a.rate ?? 0) - (b.rate ?? 0))
      .slice(0, 4),
  );

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

  /** Top reasons with bar widths relative to the most common one. */
  readonly reasonBars = computed(() => {
    const top = this.reasons().slice(0, 5);
    const max = Math.max(1, ...top.map((r) => r.count));
    return top.map((r) => ({ ...r, pct: (r.count / max) * 100 }));
  });

  readonly pendingRows = computed<PendingRow[]>(() =>
    this.pendingScoped().map((l) => ({ ...l, ageDays: daysSince(l.createdAt) })),
  );

  /** Backlog by age — the 7d+ bucket is the one an admin chases QA about. */
  readonly backlog = computed(() => {
    const rows = this.pendingRows();
    const buckets = [
      { label: '< 1d', n: rows.filter((l) => l.ageDays < 1).length, cls: '' },
      { label: '1–3d', n: rows.filter((l) => l.ageDays >= 1 && l.ageDays < 3).length, cls: '' },
      { label: '3–7d', n: rows.filter((l) => l.ageDays >= 3 && l.ageDays < 7).length, cls: 'warn' },
      { label: '7d +', n: rows.filter((l) => l.ageDays >= 7).length, cls: 'bad' },
    ];
    const max = Math.max(1, ...buckets.map((b) => b.n));
    return {
      total: rows.length,
      oldest: rows.reduce((m, l) => Math.max(m, l.ageDays), 0),
      buckets: buckets.map((b) => ({ ...b, pct: (b.n / max) * 100 })),
    };
  });

  /**
   * Where each QA verdict's leads ended up with the client, from the lead's *current* status
   * (same convention as the rest of analytics — no audit log). Answers "does a QA fail matter?".
   */
  readonly outcomes = computed(() => {
    const rows = this.scoped();
    return (['PASS', 'FAIL'] as const)
      .map((outcome) => {
        const leads = rows.filter((r) => r.outcome === outcome).map((r) => r.lead.status);
        const n = leads.length;
        const pct = (k: string) => (n === 0 ? 0 : Math.round((leads.filter((s) => s === k).length / n) * 100));
        const [acc, rej, cb] = [pct('ACCEPTED'), pct('REJECTED'), pct('CHARGED_BACK')];
        return { label: outcome === 'PASS' ? 'Passed QA' : 'Failed QA', outcome, n, acc, rej, cb, lost: rej + cb };
      })
      .filter((o) => o.n > 0);
  });

  readonly pendingView = createListView<PendingRow>({
    source: this.pendingRows,
    searchFields: (l) => [l.customerName, this.personOf(l)?.name, l.state],
    sorters: {
      customer: (l) => l.customerName,
      person: (l) => this.personOf(l)?.name,
      age: (l) => l.ageDays,
    },
    initialSort: { key: 'age', dir: 'asc' },
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

  /** Index into the 8 weekly buckets of the bar the admin clicked, or null. */
  readonly selectedWeek = signal<number | null>(null);

  readonly weekReviews = computed(() => {
    const i = this.selectedWeek();
    if (i === null) return [];
    const weeks = lastWeeks(WEEKS);
    return this.personReviews().filter((r) => bucketIndex(r.createdAt, weeks) === i);
  });

  openWeek(i: number): void {
    if (this.trend()[i]?.total) this.selectedWeek.set(i);
  }

  toggleCustom(): void {
    if (this.showCustom()) {
      this.customOpen.set(false);
      this.from.set('');
      this.to.set('');
    } else {
      this.customOpen.set(true);
    }
  }

  setRange(p: Period): void {
    this.range.set(p);
    this.customOpen.set(false);
    this.from.set('');
    this.to.set('');
  }

  setFrom(v: string): void {
    this.from.set(v);
  }

  setTo(v: string): void {
    this.to.set(v);
  }

  pct(part: number, whole: number): number {
    return whole === 0 ? 0 : Math.round((part / whole) * 100);
  }

  /** Pass-rate tone: red under 65, amber under 80, green above. */
  rateTone(rate: number): string {
    return rate < 65 ? 'bad' : rate < 80 ? 'mid' : 'good';
  }

  /** ▲/▼ chip for a period-over-period change; `upIsGood` false for things like fails or review time. */
  delta(d: number | null, unit: string, upIsGood = true): Delta | null {
    if (d === null) return null;
    if (d === 0) return { text: 'No change', cls: 'delta' };
    const good = d > 0 === upIsGood;
    return { text: `${d > 0 ? '▲' : '▼'} ${Math.abs(d)}${unit}`, cls: good ? 'delta delta--up' : 'delta delta--down' };
  }

  /** SVG polyline points for a 0–100 pass-rate series in a 64×20 box; gaps (null) are skipped. */
  sparkPoints(values: (number | null)[]): string {
    const step = 64 / Math.max(1, values.length - 1);
    return values
      .map((v, i) => (v === null ? null : `${(i * step).toFixed(1)},${(18 - (v / 100) * 16).toFixed(1)}`))
      .filter((p): p is string => p !== null)
      .join(' ');
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
