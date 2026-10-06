import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideChartColumn,
  LucideClock,
  LucideFileText,
  LucideTriangleAlert,
  LucideUsers,
} from '@lucide/angular';
import { AnalyticsService, DraftsAnalytics as DraftsAnalyticsData } from '../../../core/services/analytics.service';
import { DraftReason } from '../../../core/models/lead.model';
import { getAvatarTone, getInitials, pluralize, timeAgo } from '../../../core/format-utils';
import { DRAFT_REASON_LABEL } from '../../../core/lead-options';
import { Select } from '../../../shared/ui/select';
import { EmptyState, SkeletonRows, StatTile } from '../../../shared/ui/ui';

/** Stands in for "no junior closer" (a closer-built, self-/AI-sourced lead) in the
 * junior-closer filter — kept out of the real id space so it can never collide. */
const NO_JUNIOR = '__none__';

@Component({
  selector: 'app-analytics-drafts',
  imports: [
    FormsModule,
    Select,
    StatTile,
    EmptyState,
    SkeletonRows,
    LucideChartColumn,
    LucideClock,
    LucideFileText,
    LucideTriangleAlert,
    LucideUsers,
  ],
  templateUrl: './analytics-drafts.html',
})
export class AnalyticsDrafts implements OnInit {
  private readonly analyticsService = inject(AnalyticsService);

  readonly data = signal<DraftsAnalyticsData | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly draftReasonLabel = DRAFT_REASON_LABEL;
  readonly timeAgo = timeAgo;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly pluralize = pluralize;

  /** Closer / Junior Closer pre-filters — everything below (stats, the reason
   * breakdown, the table) is derived from the same filtered set, so picking "Jimmy" in
   * the junior-closer filter narrows the disposition counts to exactly his dropped
   * calls, not just the table. */
  readonly closerFilter = signal('');
  readonly juniorFilter = signal('');

  readonly closerOptions = computed(() => {
    const seen = new Map<string, string>();
    for (const row of this.data()?.drafts ?? []) seen.set(row.closer.id, row.closer.name);
    return [
      { value: '', label: 'All closers' },
      ...[...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
    ];
  });

  readonly juniorOptions = computed(() => {
    const seen = new Map<string, string>();
    let hasSelfSourced = false;
    for (const row of this.data()?.drafts ?? []) {
      if (row.juniorCloser) seen.set(row.juniorCloser.id, row.juniorCloser.name);
      else hasSelfSourced = true;
    }
    const options = [
      { value: '', label: 'All junior closers' },
      ...[...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
    ];
    if (hasSelfSourced) options.push({ value: NO_JUNIOR, label: 'No junior closer (self-sourced)' });
    return options;
  });

  readonly filteredDrafts = computed(() => {
    const rows = this.data()?.drafts ?? [];
    const closer = this.closerFilter();
    const junior = this.juniorFilter();
    return rows.filter((r) => {
      if (closer && r.closer.id !== closer) return false;
      if (junior === NO_JUNIOR && r.juniorCloser) return false;
      if (junior && junior !== NO_JUNIOR && r.juniorCloser?.id !== junior) return false;
      return true;
    });
  });

  readonly isFiltered = computed(() => !!this.closerFilter() || !!this.juniorFilter());

  readonly stats = computed(() => {
    const rows = this.filteredDrafts();
    const ages = rows.map((r) => r.ageDays);
    return {
      total: rows.length,
      avgAgeDays: ages.length ? Math.round(ages.reduce((sum, n) => sum + n, 0) / ages.length) : 0,
      oldestDays: ages.length ? Math.max(...ages) : 0,
      closersHolding: new Set(rows.map((r) => r.closer.id)).size,
    };
  });

  /** How many drafts are sitting in each disposition, most first — what the admin
   * actually asked for: a plain count per reason, not a bar chart. */
  readonly byReason = computed(() => {
    const counts = new Map<DraftReason, number>();
    for (const r of this.filteredDrafts()) {
      if (r.draftReason) counts.set(r.draftReason, (counts.get(r.draftReason) ?? 0) + 1);
    }
    return [...counts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
  });

  readonly rows = computed(() => [...this.filteredDrafts()].sort((a, b) => b.ageDays - a.ageDays));

  clearFilters(): void {
    this.closerFilter.set('');
    this.juniorFilter.set('');
  }

  async ngOnInit(): Promise<void> {
    try {
      this.data.set(await this.analyticsService.drafts());
    } catch {
      this.error.set('Could not load draft analytics. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
