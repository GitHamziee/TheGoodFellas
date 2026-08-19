import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  LucideChartColumn,
  LucideClock,
  LucideFileText,
  LucideTriangleAlert,
  LucideUsers,
} from '@lucide/angular';
import { AnalyticsService, DraftsAnalytics as DraftsAnalyticsData } from '../../../core/services/analytics.service';
import { getAvatarTone, getInitials, humanizeEnum, pluralize, timeAgo } from '../../../core/format-utils';
import { EmptyState, SkeletonRows, StatTile } from '../../../shared/ui/ui';

@Component({
  selector: 'app-analytics-drafts',
  imports: [StatTile, EmptyState, SkeletonRows, LucideChartColumn, LucideClock, LucideFileText, LucideTriangleAlert, LucideUsers],
  templateUrl: './analytics-drafts.html',
})
export class AnalyticsDrafts implements OnInit {
  private readonly analyticsService = inject(AnalyticsService);

  readonly data = signal<DraftsAnalyticsData | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly humanizeEnum = humanizeEnum;
  readonly timeAgo = timeAgo;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly pluralize = pluralize;

  readonly byCloserChart = computed(() => {
    const d = this.data();
    if (!d) return [];
    const max = Math.max(1, ...d.byCloser.map((c) => c.count));
    return d.byCloser.map((c) => ({ ...c, pct: Math.round((c.count / max) * 100) }));
  });

  readonly byReasonChart = computed(() => {
    const d = this.data();
    if (!d) return [];
    const rows = Object.entries(d.byReason).map(([reason, count]) => ({ reason, count }));
    const max = Math.max(1, ...rows.map((r) => r.count));
    return rows
      .sort((a, b) => b.count - a.count)
      .map((r) => ({ ...r, pct: Math.round((r.count / max) * 100) }));
  });

  readonly rows = computed(() => {
    const d = this.data();
    if (!d) return [];
    return [...d.drafts].sort((a, b) => b.ageDays - a.ageDays);
  });

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
