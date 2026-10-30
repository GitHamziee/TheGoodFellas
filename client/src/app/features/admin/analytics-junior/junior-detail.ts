import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  LucideArrowLeft,
  LucideCircleCheck,
  LucideCircleX,
  LucideClock,
  LucideLayers,
  LucideShieldCheck,
  LucideTarget,
  LucideTriangleAlert,
} from '@lucide/angular';
import { AnalyticsService, JuniorCloserDetail, JuniorLeadRow } from '../../../core/services/analytics.service';
import { createListView } from '../../../core/list-view';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';
import {
  formatDate,
  formatDateTime,
  getAvatarTone,
  getInitials,
  isThisMonth,
  isToday,
  isThisWeek,
  juniorOutcome,
  pacificIsoDate,
  timeAgo,
} from '../../../core/format-utils';
import {
  EmptyState,
  PageHero,
  Pagination,
  SearchBox,
  SkeletonRows,
  StatTile,
  StatusBadge,
} from '../../../shared/ui/ui';

type Outcome = 'ACCEPTED' | 'RETURNED_TO_JUNIOR' | 'PENDING';
const OUTCOME_LABEL: Record<Outcome, string> = {
  ACCEPTED: 'Handed off',
  RETURNED_TO_JUNIOR: 'Sent back',
  PENDING: 'Pending',
};
const TREND_DAYS = 14;
const DAY_MS = 86_400_000;

interface Tally {
  key: string;
  label: string;
  sub?: string;
  total: number;
  good: number;
  bad: number;
  goodPct: number;
  badPct: number;
  restPct: number;
}

interface LeadView extends JuniorLeadRow {
  outcome: Outcome;
}

/**
 * Deep-dive on one Junior Closer: throughput over time, how their leads end up, which
 * closers/states/lead types they feed, what QA and call reviews say about them, and every
 * lead they've ever submitted. Everything is derived in memory from the one detail payload.
 */
@Component({
  selector: 'app-junior-detail',
  imports: [
    RouterLink,
    NgTemplateOutlet,
    PageHero,
    StatTile,
    EmptyState,
    SkeletonRows,
    SearchBox,
    Pagination,
    StatusBadge,
    LucideArrowLeft,
    LucideCircleCheck,
    LucideCircleX,
    LucideClock,
    LucideLayers,
    LucideShieldCheck,
    LucideTarget,
    LucideTriangleAlert,
  ],
  template: `
    <div class="page">
      <a class="back-link" [routerLink]="['../analytics/junior-closers']">
        <svg lucideArrowLeft></svg> Junior closers
      </a>

      @if (loading() && !detail()) {
        <app-skeleton-rows [count]="6" />
      } @else if (error()) {
        <div class="error">{{ error() }}</div>
      } @else if (detail(); as d) {
        <app-page-hero
          eyebrow="Junior closer"
          [title]="d.person.name"
          [sub]="d.person.email + ' · on the team since ' + formatDate(d.person.createdAt)"
          tone="steel"
          [count]="stats().rate === null ? '—' : stats().rate + '%'"
          countLabel="hand-off rate"
        >
          <svg lucideTarget></svg>
        </app-page-hero>

        <div class="stats-row">
          <app-stat-tile [value]="stats().total" label="Leads submitted" tone="tone-gold">
            <svg lucideLayers></svg>
          </app-stat-tile>
          <app-stat-tile [value]="stats().today + ' / ' + stats().week + ' / ' + stats().month" label="Today / week / month" tone="tone-c">
            <svg lucideClock></svg>
          </app-stat-tile>
          <app-stat-tile [value]="stats().handedOff" label="Handed off" tone="tone-success">
            <svg lucideCircleCheck></svg>
          </app-stat-tile>
          <app-stat-tile [value]="stats().sentBack" label="Sent back" tone="tone-danger">
            <svg lucideCircleX></svg>
          </app-stat-tile>
          <app-stat-tile [value]="stats().pending" label="Pending" tone="tone-d">
            <svg lucideClock></svg>
          </app-stat-tile>
          <app-stat-tile
            [value]="qa().rate === null ? '—' : qa().rate + '%'"
            [label]="'QA pass rate (' + qa().total + ' reviewed)'"
            tone="tone-a"
          >
            <svg lucideShieldCheck></svg>
          </app-stat-tile>
          <app-stat-tile [value]="d.callIssues.length" label="Live-call issues" tone="tone-danger">
            <svg lucideTriangleAlert></svg>
          </app-stat-tile>
        </div>

        <div class="card">
          <div class="inline-head">
            <h2>Versus the team</h2>
            <span class="count">{{ d.team.people }} junior closers</span>
          </div>
          <div class="reason-summary">
            <div class="reason-summary-row">
              <span>Volume rank</span>
              <strong>#{{ d.team.volumeRank }} of {{ d.team.people }}</strong>
            </div>
            <div class="reason-summary-row">
              <span>Leads submitted — this person vs team average</span>
              <strong>{{ stats().total }} vs {{ d.team.avgTotal }}</strong>
            </div>
            <div class="reason-summary-row">
              <span>Hand-off rate — this person vs team</span>
              <strong>
                {{ stats().rate === null ? '—' : stats().rate + '%' }} vs
                {{ d.team.acceptRate === null ? '—' : d.team.acceptRate + '%' }}
              </strong>
            </div>
            <div class="reason-summary-row">
              <span>Active days (≥1 lead) / average per active day</span>
              <strong>{{ activity().activeDays }} / {{ activity().perActiveDay }}</strong>
            </div>
            <div class="reason-summary-row">
              <span>Last submission</span>
              <strong>{{ activity().last ? timeAgo(activity().last) : '—' }}</strong>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="inline-head">
            <h2>Submissions — last {{ trendDays }} days</h2>
            <span class="count">{{ trendTotal() }} leads</span>
          </div>
          <div class="trend" role="img" [attr.aria-label]="'Leads submitted per day, last ' + trendDays + ' days'">
            @for (day of trend(); track day.key) {
              <div class="trend-col" [title]="day.key + ' — ' + day.count + ' leads (' + day.handedOff + ' handed off)'">
                <span class="trend-n">{{ day.count || '' }}</span>
                <span class="trend-bar" [style.height.%]="day.pct"></span>
                <span class="trend-d">{{ day.label }}</span>
              </div>
            }
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="inline-head"><h2>Outcome by lead type</h2></div>
            <ng-container [ngTemplateOutlet]="tallyTpl" [ngTemplateOutletContext]="{ rows: byType(), good: 'Handed off', bad: 'Sent back' }" />
          </div>
          <div class="card">
            <div class="inline-head"><h2>Outcome by closer</h2><span class="count">who their leads go to</span></div>
            <ng-container [ngTemplateOutlet]="tallyTpl" [ngTemplateOutletContext]="{ rows: byCloser(), good: 'Handed off', bad: 'Sent back' }" />
          </div>
          <div class="card">
            <div class="inline-head"><h2>Top states</h2><span class="count">by volume</span></div>
            <ng-container [ngTemplateOutlet]="tallyTpl" [ngTemplateOutletContext]="{ rows: byState(), good: 'Handed off', bad: 'Sent back' }" />
          </div>
          <div class="card">
            <div class="inline-head"><h2>Where leads sit now</h2></div>
            @if (byStatus().length === 0) {
              <div class="empty">No leads yet.</div>
            } @else {
              <div class="reason-summary">
                @for (s of byStatus(); track s.status) {
                  <div class="reason-summary-row">
                    <app-status-badge [status]="s.status" />
                    <strong>{{ s.count }}</strong>
                  </div>
                }
              </div>
            }
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="inline-head">
              <h2>QA verdicts on their intake</h2>
              <span class="count">{{ qa().pass }} pass · {{ qa().fail }} fail</span>
            </div>
            @if (d.reviews.length === 0) {
              <div class="empty">No QA reviews yet.</div>
            } @else {
              <ul class="feed">
                @for (r of d.reviews.slice(0, 8); track r.id) {
                  <li>
                    <span class="badge" [class.badge--accepted]="r.outcome === 'PASS'" [class.badge--rejected]="r.outcome === 'FAIL'">
                      {{ r.outcome === 'PASS' ? 'Pass' : 'Fail' }}
                    </span>
                    <span class="feed-body">
                      <strong>{{ r.lead.customerName }}</strong>
                      @if (r.comment) { <span> — {{ r.comment }}</span> }
                      <small>{{ r.reviewer.name }} · {{ timeAgo(r.createdAt) }}</small>
                    </span>
                  </li>
                }
              </ul>
            }
          </div>
          <div class="card">
            <div class="inline-head">
              <h2>Live-call issues flagged</h2>
              <span class="count">{{ d.callIssues.length }} total</span>
            </div>
            @if (d.callIssues.length === 0) {
              <div class="empty">Nothing flagged by QA.</div>
            } @else {
              <ul class="feed">
                @for (c of d.callIssues.slice(0, 8); track c.id) {
                  <li>
                    <span class="badge badge--rejected">Issue</span>
                    <span class="feed-body">
                      {{ c.comment }}
                      <small>
                        {{ c.reviewer.name }} · {{ timeAgo(c.createdAt) }}
                        @if (c.lead) { · re: {{ c.lead.customerName }} }
                      </small>
                    </span>
                  </li>
                }
              </ul>
            }
          </div>
        </div>

        @if (sentBackLeads().length > 0) {
          <div class="card">
            <div class="inline-head">
              <h2>Currently sent back for correction</h2>
              <span class="count">{{ sentBackLeads().length }}</span>
            </div>
            <ul class="feed">
              @for (l of sentBackLeads(); track l.id) {
                <li>
                  <span class="badge badge--returned_to_junior">Sent back</span>
                  <span class="feed-body">
                    <strong>{{ l.customerName }}</strong> — {{ l.returnReason || 'No reason recorded' }}
                    <small>{{ timeAgo(l.updatedAt) }}</small>
                  </span>
                </li>
              }
            </ul>
          </div>
        }

        <div class="toolbar">
          <app-search-box
            [value]="view.search()"
            placeholder="Search their leads by customer, state or closer…"
            (valueChange)="view.setSearch($event)"
          />
          <div class="pills">
            @for (f of outcomeFilters; track f.value) {
              <button type="button" class="pill" [class.active]="view.status() === f.value" (click)="view.setStatus(f.value)">
                {{ f.label }} <span class="n">{{ outcomeCounts()[f.value] }}</span>
              </button>
            }
          </div>
        </div>

        <div class="card card--flush">
          @if (view.total() === 0) {
            <app-empty-state
              [title]="view.isFiltered() ? 'No leads match' : 'No leads yet'"
              [hint]="view.isFiltered() ? 'Try a different search or filter.' : 'Leads this person submits will appear here.'"
            >
              <svg lucideLayers></svg>
            </app-empty-state>
          } @else {
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th class="sortable" (click)="view.toggleSort('customerName')">Customer <span class="arrow">{{ arrow('customerName') }}</span></th>
                    <th class="hide-sm">Type</th>
                    <th class="hide-sm">State</th>
                    <th class="hide-md">Closer</th>
                    <th>Outcome</th>
                    <th>Pipeline status</th>
                    <th class="sortable right" (click)="view.toggleSort('createdAt')">Submitted <span class="arrow">{{ arrow('createdAt') }}</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (l of view.rows(); track l.id) {
                    <tr>
                      <td>
                        <span class="cell-main">{{ l.customerName }}</span>
                        @if (l.outcome === 'RETURNED_TO_JUNIOR' && l.returnReason) {
                          <span class="cell-sub">{{ l.returnReason }}</span>
                        }
                      </td>
                      <td class="hide-sm"><span class="badge badge--neutral">{{ l.leadType }}</span></td>
                      <td class="hide-sm">{{ l.state }}</td>
                      <td class="hide-md">
                        @if (l.closer) {
                          <div class="person">
                            <span class="avatar-sm" [class]="getAvatarTone(l.closer.id)">{{ getInitials(l.closer.name) }}</span>
                            <span class="nm">{{ l.closer.name }}</span>
                          </div>
                        } @else { <span class="empty">—</span> }
                      </td>
                      <td>
                        <span
                          class="badge"
                          [class.badge--accepted]="l.outcome === 'ACCEPTED'"
                          [class.badge--returned_to_junior]="l.outcome === 'RETURNED_TO_JUNIOR'"
                          [class.badge--neutral]="l.outcome === 'PENDING'"
                        >{{ outcomeLabel[l.outcome] }}</span>
                      </td>
                      <td><app-status-badge [status]="l.status" /></td>
                      <td class="right" [title]="formatDateTime(l.createdAt)">
                        <span class="chip"><svg lucideClock></svg>{{ timeAgo(l.createdAt) }}</span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <app-pagination
              [page]="view.page()"
              [totalPages]="view.totalPages()"
              [total]="view.total()"
              (pageChange)="view.page.set($event)"
            />
          }
        </div>
      }
    </div>

    <ng-template #tallyTpl let-rows="rows" let-good="good" let-bad="bad">
      @if (rows.length === 0) {
        <div class="empty">No data yet.</div>
      } @else {
        <div class="chart">
          @for (r of rows; track r.key) {
            <div class="chart-row" [title]="r.label + ' — ' + r.total + ' leads, ' + r.good + ' ' + good + ', ' + r.bad + ' ' + bad">
              <span class="chart-key">{{ r.label }}@if (r.sub) {<span class="sub">{{ r.sub }}</span>}</span>
              <span class="chart-track">
                @if (r.good > 0) { <span class="chart-bar chart-bar--good" [style.width.%]="r.goodPct"></span> }
                @if (r.bad > 0) { <span class="chart-bar chart-bar--bad" [style.width.%]="r.badPct"></span> }
                @if (r.restPct > 0) { <span class="chart-bar chart-bar--idle" [style.width.%]="r.restPct"></span> }
              </span>
              <span class="chart-val">{{ r.total }}</span>
            </div>
          }
        </div>
        <div class="chart-legend">
          <span><i class="sw--good"></i> {{ good }}</span>
          <span><i class="sw--bad"></i> {{ bad }}</span>
          <span><i class="sw--idle"></i> Pending</span>
        </div>
      }
    </ng-template>
  `,
  styles: `
    .grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
    @media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr; } }
    .grid-2 .card { margin-bottom: 0; }
    .trend { display: flex; align-items: flex-end; gap: 0.35rem; height: 9rem; padding-top: 1rem; }
    .trend-col { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 0.2rem; }
    .trend-bar { width: 100%; max-width: 28px; min-height: 2px; background: var(--chart-vol); border-radius: 4px 4px 0 0; transition: height 0.4s ease; }
    .trend-n { font-size: 0.7rem; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; min-height: 0.9rem; }
    .trend-d { font-size: 0.64rem; color: var(--gray-400); white-space: nowrap; }
    .feed { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
    .feed li { display: flex; gap: 0.7rem; align-items: flex-start; font-size: 0.83rem; }
    .feed .badge { flex-shrink: 0; margin-top: 0.1rem; }
    .feed-body { min-width: 0; overflow-wrap: anywhere; }
    .feed-body small { display: block; color: var(--gray-400); font-size: 0.72rem; margin-top: 0.1rem; }
  `,
})
export class JuniorDetail {
  private readonly liveReload = reloadOnChange(() => this.load());
  private readonly analytics = inject(AnalyticsService);
  private readonly route = inject(ActivatedRoute);
  private readonly id = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });

  readonly detail = signal<JuniorCloserDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');

  readonly trendDays = TREND_DAYS;
  readonly outcomeLabel = OUTCOME_LABEL;
  readonly getAvatarTone = getAvatarTone;
  readonly getInitials = getInitials;
  readonly formatDate = formatDate;
  readonly formatDateTime = formatDateTime;
  readonly timeAgo = timeAgo;

  readonly outcomeFilters: { value: string; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'ACCEPTED', label: 'Handed off' },
    { value: 'RETURNED_TO_JUNIOR', label: 'Sent back' },
    { value: 'PENDING', label: 'Pending' },
  ];

  readonly leads = computed<LeadView[]>(() =>
    (this.detail()?.leads ?? []).map((l) => ({ ...l, outcome: juniorOutcome(l) })),
  );

  readonly view = createListView<LeadView>({
    source: this.leads,
    searchFields: (l) => [l.customerName, l.state, l.closer?.name, l.leadType],
    statusOf: (l) => l.outcome,
    sorters: {
      customerName: (l) => l.customerName.toLowerCase(),
      createdAt: (l) => new Date(l.createdAt).getTime(),
      updatedAt: (l) => new Date(l.updatedAt).getTime(),
    },
    initialSort: { key: 'updatedAt', dir: 'desc' },
    pageSize: 10,
  });

  readonly outcomeCounts = computed<Record<string, number>>(() => {
    const c: Record<string, number> = { '': this.leads().length, ACCEPTED: 0, RETURNED_TO_JUNIOR: 0, PENDING: 0 };
    for (const l of this.leads()) c[l.outcome]++;
    return c;
  });

  readonly stats = computed(() => {
    const leads = this.leads();
    const handedOff = leads.filter((l) => l.outcome === 'ACCEPTED').length;
    const sentBack = leads.filter((l) => l.outcome === 'RETURNED_TO_JUNIOR').length;
    const decided = handedOff + sentBack;
    return {
      total: leads.length,
      handedOff,
      sentBack,
      pending: leads.length - decided,
      rate: decided ? Math.round((handedOff / decided) * 100) : null,
      today: leads.filter((l) => isToday(l.createdAt)).length,
      week: leads.filter((l) => isThisWeek(l.createdAt)).length,
      month: leads.filter((l) => isThisMonth(l.createdAt)).length,
    };
  });

  readonly qa = computed(() => {
    const reviews = this.detail()?.reviews ?? [];
    const pass = reviews.filter((r) => r.outcome === 'PASS').length;
    return {
      total: reviews.length,
      pass,
      fail: reviews.length - pass,
      rate: reviews.length ? Math.round((pass / reviews.length) * 100) : null,
    };
  });

  readonly activity = computed(() => {
    const leads = this.leads();
    const days = new Set(leads.map((l) => pacificIsoDate(l.createdAt)));
    return {
      activeDays: days.size,
      perActiveDay: days.size ? Math.round((leads.length / days.size) * 10) / 10 : 0,
      last: leads[0]?.createdAt ?? null, // payload is newest-first
    };
  });

  readonly trend = computed(() => {
    const counts = new Map<string, { count: number; handedOff: number }>();
    for (const l of this.leads()) {
      const key = pacificIsoDate(l.createdAt);
      const e = counts.get(key) ?? { count: 0, handedOff: 0 };
      e.count++;
      if (l.outcome === 'ACCEPTED') e.handedOff++;
      counts.set(key, e);
    }
    const now = Date.now();
    const days = Array.from({ length: TREND_DAYS }, (_, i) => {
      const key = pacificIsoDate(now - (TREND_DAYS - 1 - i) * DAY_MS);
      const e = counts.get(key) ?? { count: 0, handedOff: 0 };
      return { key, label: key.slice(5).replace('-', '/'), ...e };
    });
    const max = Math.max(1, ...days.map((d) => d.count));
    return days.map((d) => ({ ...d, pct: (d.count / max) * 80 }));
  });
  readonly trendTotal = computed(() => this.trend().reduce((s, d) => s + d.count, 0));

  readonly byType = computed(() => this.tally((l) => ({ key: l.leadType, label: l.leadType })));
  readonly byState = computed(() => this.tally((l) => ({ key: l.state, label: l.state }), 8));
  readonly byCloser = computed(() =>
    this.tally((l) =>
      l.closer
        ? { key: l.closer.id, label: l.closer.name }
        : { key: 'none', label: 'No closer', sub: l.leadType === 'CPL' ? 'CPL goes straight to admin' : undefined },
    ),
  );

  readonly byStatus = computed(() => {
    const m = new Map<JuniorLeadRow['status'], number>();
    for (const l of this.leads()) m.set(l.status, (m.get(l.status) ?? 0) + 1);
    return [...m.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
  });

  readonly sentBackLeads = computed(() => this.leads().filter((l) => l.outcome === 'RETURNED_TO_JUNIOR'));

  constructor() {
    effect(() => {
      this.id();
      untracked(() => {
        this.detail.set(null);
        this.loading.set(true);
        void this.load();
      });
    });
  }

  async load(): Promise<void> {
    const id = this.id().get('id');
    if (!id) return;
    if (!isSilentReload()) this.loading.set(true);
    try {
      this.detail.set(await this.analytics.juniorCloserDetail(id));
      this.error.set('');
    } catch (e: unknown) {
      this.error.set(
        (e as { status?: number })?.status === 404 ? 'Junior closer not found.' : 'Could not load this junior closer.',
      );
    } finally {
      this.loading.set(false);
    }
  }


  arrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }

  /** Group leads by a key and split each group into handed-off / sent-back / pending, scaled to the biggest group. */
  private tally(
    keyOf: (l: LeadView) => { key: string; label: string; sub?: string },
    limit = 8,
  ): Tally[] {
    const groups = new Map<string, Tally>();
    for (const l of this.leads()) {
      const { key, label, sub } = keyOf(l);
      const g = groups.get(key) ?? { key, label, sub, total: 0, good: 0, bad: 0, goodPct: 0, badPct: 0, restPct: 0 };
      g.total++;
      if (l.outcome === 'ACCEPTED') g.good++;
      else if (l.outcome === 'RETURNED_TO_JUNIOR') g.bad++;
      groups.set(key, g);
    }
    const top = [...groups.values()].sort((a, b) => b.total - a.total).slice(0, limit);
    const max = Math.max(1, ...top.map((g) => g.total));
    return top.map((g) => ({
      ...g,
      goodPct: (g.good / max) * 100,
      badPct: (g.bad / max) * 100,
      restPct: ((g.total - g.good - g.bad) / max) * 100,
    }));
  }
}
