import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideFlag, LucideLayers, LucideTriangleAlert, LucideUsers } from '@lucide/angular';
import { AnalyticsService } from '../../core/services/analytics.service';
import { CallReviewDetail, CallReviewIssue, QaLane, QaLeadSummary } from '../../core/models/review.model';
import { createListView } from '../../core/list-view';
import { formatDateTime, getAvatarTone, getInitials, timeAgo } from '../../core/format-utils';
import { Modal } from '../../shared/ui/modal';
import { Select, SelectOption } from '../../shared/ui/select';
import { EmptyState, Pagination, SearchBox, SkeletonRows, StatTile } from '../../shared/ui/ui';
import { QaLeadPeek } from './qa-lead-peek';
import { RANGE_PILLS, RangeKey, bucketIndex, inRange, lastWeeks } from './qa-stats';
import { reloadOnChange } from '../../core/live-reload';
import { DateInput } from '../../shared/ui/date-input';

type Tab = 'overview' | 'log' | 'reviewers';

interface PersonRow {
  id: string;
  name: string;
  email: string;
  inRange: number;
  last30: number;
  allTime: number;
  /** Issue-count change, last 30 days minus the 30 before; null when there's no history either side. */
  delta: number | null;
  lastFlagged: string | null;
}

interface ReviewerRow {
  id: string;
  name: string;
  count: number;
  people: number;
}

const DAY = 86400000;
const WEEKS = 8;
const REPEAT_THRESHOLD = 3;

/**
 * Live Call Report — issues QA has flagged against a lane's people on live calls. There is
 * no "pass" side (a clean call never gets a row), so everything here is an issue count over
 * time: who keeps getting flagged, whether it's improving, and the full comment history.
 * Built from the full issue list (no cap); aggregation is in memory.
 */
@Component({
  selector: 'app-qa-call-report',
  imports: [DateInput, 
    FormsModule,
    Modal,
    Select,
    StatTile,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    QaLeadPeek,
    LucideFlag,
    LucideLayers,
    LucideTriangleAlert,
    LucideUsers,
  ],
  templateUrl: './qa-call-report.html',
})
export class QaCallReport implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly analytics = inject(AnalyticsService);

  readonly lane = input.required<QaLane>();
  readonly subtitle = input('');
  readonly peopleLabel = input('People');

  readonly detail = signal<CallReviewDetail>({ people: [], issues: [] });
  readonly loading = signal(true);
  readonly error = signal('');

  readonly tab = signal<Tab>('overview');
  readonly range = signal<RangeKey>('');
  readonly from = signal('');
  readonly to = signal('');
  readonly personId = signal('');
  readonly reviewerId = signal('');

  readonly selectedPerson = signal<PersonRow | null>(null);
  readonly peekLead = signal<QaLeadSummary | null>(null);

  readonly rangePills = RANGE_PILLS;
  readonly repeatThreshold = REPEAT_THRESHOLD;
  readonly timeAgo = timeAgo;
  readonly formatDateTime = formatDateTime;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  async ngOnInit(): Promise<void> {
    try {
      this.detail.set(await this.analytics.callReviews(this.lane()));
    } catch {
      this.error.set('Could not load the report. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  readonly personOptions = computed<SelectOption[]>(() => [
    { value: '', label: 'Everyone' },
    ...this.detail().people.map((p) => ({ value: p.id, label: p.name })),
  ]);

  readonly reviewerOptions = computed<SelectOption[]>(() => {
    const seen = new Map<string, string>();
    for (const i of this.detail().issues) seen.set(i.reviewer.id, i.reviewer.name);
    return [
      { value: '', label: 'Any QA reviewer' },
      ...[...seen.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label })),
    ];
  });

  // Person + reviewer filtered, any date — feeds the weekly trend and 30-day windows.
  private readonly filteredAnyDate = computed(() => {
    const [person, reviewer] = [this.personId(), this.reviewerId()];
    return this.detail().issues.filter(
      (i) => (!person || i.reviewee.id === person) && (!reviewer || i.reviewer.id === reviewer),
    );
  });

  readonly scoped = computed(() => {
    const [range, from, to] = [this.range(), this.from(), this.to()];
    return this.filteredAnyDate().filter((i) => inRange(i.createdAt, range, from, to));
  });

  readonly people = computed<PersonRow[]>(() => {
    const person = this.personId();
    const [range, from, to] = [this.range(), this.from(), this.to()];
    const reviewer = this.reviewerId();
    const now = Date.now();
    const issues = this.detail().issues.filter((i) => !reviewer || i.reviewer.id === reviewer);
    return this.detail()
      .people.filter((p) => !person || p.id === person)
      .map((p) => {
        const mine = issues.filter((i) => i.reviewee.id === p.id);
        const age = (i: CallReviewIssue) => now - new Date(i.createdAt).getTime();
        const last30 = mine.filter((i) => age(i) < 30 * DAY).length;
        const prior30 = mine.filter((i) => age(i) >= 30 * DAY && age(i) < 60 * DAY).length;
        return {
          id: p.id,
          name: p.name,
          email: p.email,
          inRange: mine.filter((i) => inRange(i.createdAt, range, from, to)).length,
          last30,
          allTime: mine.length,
          delta: last30 === 0 && prior30 === 0 ? null : last30 - prior30,
          lastFlagged: mine[0]?.createdAt ?? null, // issues arrive newest-first
        };
      });
  });

  readonly tiles = computed(() => {
    const rows = this.people();
    const top = [...rows].sort((a, b) => b.inRange - a.inRange)[0];
    return {
      issues: this.scoped().length,
      flagged: rows.filter((r) => r.inRange > 0).length,
      clean: rows.filter((r) => r.inRange === 0).length,
      repeat: rows.filter((r) => r.last30 >= REPEAT_THRESHOLD).length,
      top: top && top.inRange > 0 ? `${top.name} (${top.inRange})` : '—',
    };
  });

  readonly trend = computed(() => {
    const weeks = lastWeeks(WEEKS);
    const counts = weeks.map((w) => ({ label: w.label, total: 0 }));
    for (const i of this.filteredAnyDate()) {
      const idx = bucketIndex(i.createdAt, weeks);
      if (idx >= 0) counts[idx].total += 1;
    }
    const max = Math.max(1, ...counts.map((c) => c.total));
    return counts.map((c) => ({ ...c, heightPct: (c.total / max) * 100 }));
  });

  readonly peopleView = createListView<PersonRow>({
    source: this.people,
    searchFields: (p) => [p.name, p.email],
    sorters: {
      name: (p) => p.name,
      inRange: (p) => p.inRange,
      last30: (p) => p.last30,
      allTime: (p) => p.allTime,
      lastFlagged: (p) => (p.lastFlagged ? new Date(p.lastFlagged).getTime() : null),
    },
    initialSort: { key: 'inRange', dir: 'desc' },
    pageSize: 10,
  });

  readonly logView = createListView<CallReviewIssue>({
    source: this.scoped,
    searchFields: (i) => [i.reviewee.name, i.reviewer.name, i.comment, i.lead?.customerName],
    sorters: {
      person: (i) => i.reviewee.name,
      lead: (i) => i.lead?.customerName,
      reviewer: (i) => i.reviewer.name,
      createdAt: (i) => new Date(i.createdAt).getTime(),
    },
    initialSort: { key: 'createdAt', dir: 'desc' },
    pageSize: 10,
  });

  readonly reviewers = computed<ReviewerRow[]>(() => {
    const by = new Map<string, { id: string; name: string; count: number; people: Set<string> }>();
    for (const i of this.scoped()) {
      const row = by.get(i.reviewer.id) ?? { id: i.reviewer.id, name: i.reviewer.name, count: 0, people: new Set<string>() };
      row.count += 1;
      row.people.add(i.reviewee.id);
      by.set(i.reviewer.id, row);
    }
    return [...by.values()]
      .map((r) => ({ id: r.id, name: r.name, count: r.count, people: r.people.size }))
      .sort((a, b) => b.count - a.count);
  });

  readonly personHistory = computed(() => {
    const p = this.selectedPerson();
    return p ? this.detail().issues.filter((i) => i.reviewee.id === p.id) : [];
  });

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

  sortArrow(view: { sortKey(): string | null; sortDir(): string }, key: string): string {
    if (view.sortKey() !== key) return '';
    return view.sortDir() === 'asc' ? '↑' : '↓';
  }

  /** More issues than the prior 30 days is bad news, so up = red here (opposite of pass rate). */
  deltaText(d: number | null): string {
    if (d === null) return '—';
    if (d === 0) return 'No change';
    return `${d > 0 ? '▲' : '▼'} ${Math.abs(d)}`;
  }

  deltaClass(d: number | null): string {
    return d === null || d === 0 ? 'delta' : d > 0 ? 'delta delta--down' : 'delta delta--up';
  }
}
