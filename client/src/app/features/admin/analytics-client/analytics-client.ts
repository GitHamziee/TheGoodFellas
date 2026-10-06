import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { LucideBanknote, LucideLayers } from '@lucide/angular';
import { AnalyticsService, ClosePlanRow } from '../../../core/services/analytics.service';
import { PlanType } from '../../../core/models/lead.model';
import { PLAN_TYPE_LABEL, PLAN_TYPE_OPTIONS } from '../../../core/lead-options';
import { formatMoney, getAvatarTone, getInitials } from '../../../core/format-utils';
import { EmptyState, SkeletonRows, StatTile } from '../../../shared/ui/ui';
import { reloadOnChange } from '../../../core/live-reload';

@Component({
  selector: 'app-analytics-client',
  imports: [StatTile, EmptyState, SkeletonRows, LucideLayers, LucideBanknote],
  template: `
    <div class="page-head">
      <div>
        <h2>Sales by plan</h2>
        <p class="sub">
          Expected revenue ($) from accepted leads — count × that client's cost for the plan. Handed-off
          external-client leads aren't included (no pricing exists for those). Not a record of money
          actually collected; see the Expenses page for that.
        </p>
      </div>
    </div>

    @if (!loading()) {
      <div class="stats-row">
        @for (p of planTotals(); track p.planType) {
          <app-stat-tile [value]="formatMoney(p.revenue)" [label]="planLabel[p.planType] + ' — ' + p.count + ' leads'" tone="tone-a">
            <svg lucideBanknote></svg>
          </app-stat-tile>
        }
      </div>
    }

    <div class="card card--flush">
      @if (loading()) {
        <app-skeleton-rows [count]="5" />
      } @else if (rows().length === 0) {
        <app-empty-state title="Nothing sold yet" hint="Once a client's leads are accepted, their plan breakdown shows up here.">
          <svg lucideLayers></svg>
        </app-empty-state>
      } @else {
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                @for (opt of planTypeOptions; track opt.value) {
                  <th class="right">{{ opt.label }}</th>
                }
                <th class="right">Total revenue</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.id) {
                <tr>
                  <td>
                    <div class="person">
                      <span class="avatar-sm" [class]="getAvatarTone(row.id)">{{ getInitials(row.name) }}</span>
                      <span class="who">
                        <span class="cell-main">{{ row.name }}</span>
                        <span class="cell-sub">{{ row.email }}</span>
                      </span>
                    </div>
                  </td>
                  @for (plan of row.plans; track plan.planType) {
                    <td class="right num">
                      @if (plan.count > 0) {
                        <div><strong>{{ formatMoney(plan.revenue) }}</strong></div>
                        <div class="cell-sub">{{ plan.count }} {{ plan.count === 1 ? 'lead' : 'leads' }}</div>
                      } @else {
                        <span class="empty">—</span>
                      }
                    </td>
                  }
                  <td class="right num"><strong>{{ formatMoney(row.totalRevenue) }}</strong></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class AnalyticsClient implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly analyticsService = inject(AnalyticsService);

  readonly rows = signal<ClosePlanRow[]>([]);
  readonly loading = signal(true);

  readonly planTypeOptions = PLAN_TYPE_OPTIONS;
  readonly planLabel = PLAN_TYPE_LABEL;
  readonly formatMoney = formatMoney;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  /** Same four plans, summed across every client, for the top stat tiles. */
  readonly planTotals = computed(() => {
    const rows = this.rows();
    return this.planTypeOptions.map(({ value: planType }) => ({
      planType,
      count: rows.reduce((sum, r) => sum + (r.plans.find((p) => p.planType === planType)?.count ?? 0), 0),
      revenue: rows.reduce((sum, r) => sum + (r.plans.find((p) => p.planType === planType)?.revenue ?? 0), 0),
    })) as { planType: PlanType; count: number; revenue: number }[];
  });

  async ngOnInit(): Promise<void> {
    try {
      this.rows.set(await this.analyticsService.clientPlans());
    } finally {
      this.loading.set(false);
    }
  }
}
