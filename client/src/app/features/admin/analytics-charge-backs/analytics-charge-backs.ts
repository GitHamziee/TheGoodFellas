import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { LucideBanknoteX, LucideClock, LucideUsers } from '@lucide/angular';
import {
  AnalyticsService,
  ChargeBackAnalytics as ChargeBackAnalyticsData,
  ChargeBackBucket,
} from '../../../core/services/analytics.service';
import { formatPkr, getAvatarTone, getInitials, pluralize, timeAgo } from '../../../core/format-utils';
import { EmptyState, SkeletonRows, StatTile } from '../../../shared/ui/ui';

@Component({
  selector: 'app-analytics-charge-backs',
  imports: [StatTile, EmptyState, SkeletonRows, LucideBanknoteX, LucideClock, LucideUsers],
  templateUrl: './analytics-charge-backs.html',
})
export class AnalyticsChargeBacks implements OnInit {
  private readonly analyticsService = inject(AnalyticsService);

  readonly data = signal<ChargeBackAnalyticsData | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly formatPkr = formatPkr;
  readonly timeAgo = timeAgo;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly pluralize = pluralize;

  private pctByCount(rows: ChargeBackBucket[]): (ChargeBackBucket & { pct: number })[] {
    const max = Math.max(1, ...rows.map((r) => r.count));
    return rows.map((r) => ({ ...r, pct: Math.round((r.count / max) * 100) }));
  }

  readonly byClientChart = computed(() => this.pctByCount(this.data()?.byClient ?? []));
  readonly byCloserChart = computed(() => this.pctByCount(this.data()?.byCloser ?? []));

  async ngOnInit(): Promise<void> {
    try {
      this.data.set(await this.analyticsService.chargeBacks());
    } catch {
      this.error.set('Could not load charge-back analytics. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
