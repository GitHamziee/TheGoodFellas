import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { LucideBanknote, LucideLayers } from '@lucide/angular';
import { AnalyticsService, ClosePlanRow, UserOutcomeRow } from '../../../core/services/analytics.service';
import { PlanType } from '../../../core/models/lead.model';
import { PLAN_TYPE_LABEL, PLAN_TYPE_OPTIONS } from '../../../core/lead-options';
import { formatMoney, getAvatarTone, getInitials } from '../../../core/format-utils';
import { EmptyState, SkeletonRows, StatTile } from '../../../shared/ui/ui';
import { OutcomeAnalytics } from '../outcome-analytics';

@Component({
  selector: 'app-analytics-closer',
  imports: [OutcomeAnalytics, StatTile, EmptyState, SkeletonRows, LucideLayers, LucideBanknote],
  template: `
    <app-outcome-analytics
      subtitle="How the leads each closer enriched and submitted end up, once a client has decided."
      peopleLabel="Closers"
      emptyTitle="No closers yet"
      emptyHint="Create closer accounts and their lead outcomes will show up here."
      [source]="rows()"
      [loading]="loading()"
    />

    <div class="page-head" style="margin-top: 2.25rem;">
      <div>
        <h2>Sales by plan</h2>
        <p class="sub">
          Expected revenue ($) from leads that reached a paying destination (accepted, or handed to an
          external client) — count × that client's cost for the plan. Not a record of money actually
          collected; see the Expenses page for that.
        </p>
      </div>
    </div>

    @if (!planLoading()) {
      <div class="stats-row">
        @for (p of planTotals(); track p.planType) {
          <app-stat-tile [value]="formatMoney(p.revenue)" [label]="planLabel[p.planType] + ' — ' + p.count + ' leads'" tone="tone-a">
            <svg lucideBanknote></svg>
          </app-stat-tile>
        }
      </div>

      <div class="inline-head" style="margin-top: 1.5rem;">
        <h2>Annual premium</h2>
        <span class="count">monthly premium × 12 — a separate figure from the per-plan revenue above</span>
      </div>
      <div class="stats-row">
        <app-stat-tile [value]="formatMoney(totalAnnualPremium())" label="All closers, sold leads" tone="tone-b">
          <svg lucideBanknote></svg>
        </app-stat-tile>
      </div>
    }

    <div class="card card--flush">
      @if (planLoading()) {
        <app-skeleton-rows [count]="5" />
      } @else if (planRows().length === 0) {
        <app-empty-state title="Nothing sold yet" hint="Once leads are accepted or handed to an external client, their plan breakdown shows up here.">
          <svg lucideLayers></svg>
        </app-empty-state>
      } @else {
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th rowspan="2">Closer</th>
                <th class="right" [attr.colspan]="planTypeOptions.length + 1">Sold by plan</th>
                <th class="right col-group-divider" rowspan="2">
                  Annual premium
                  <span class="hint" style="display: block; font-weight: 500; text-transform: none;">monthly × 12</span>
                </th>
              </tr>
              <tr>
                @for (opt of planTypeOptions; track opt.value) {
                  <th class="right">{{ opt.label }}</th>
                }
                <th class="right">Total</th>
              </tr>
            </thead>
            <tbody>
              @for (row of planRows(); track row.id) {
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
                  <td class="right num col-group-divider">{{ formatMoney(row.annualPremiumRevenue) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class AnalyticsCloser implements OnInit {
  private readonly analyticsService = inject(AnalyticsService);

  readonly rows = signal<UserOutcomeRow[]>([]);
  readonly loading = signal(true);

  readonly planRows = signal<ClosePlanRow[]>([]);
  readonly planLoading = signal(true);

  readonly planTypeOptions = PLAN_TYPE_OPTIONS;
  readonly planLabel = PLAN_TYPE_LABEL;
  readonly formatMoney = formatMoney;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  /** Same four plans, summed across every closer, for the top stat tiles. */
  readonly planTotals = computed(() => {
    const rows = this.planRows();
    return this.planTypeOptions.map(({ value: planType }) => ({
      planType,
      count: rows.reduce((sum, r) => sum + (r.plans.find((p) => p.planType === planType)?.count ?? 0), 0),
      revenue: rows.reduce((sum, r) => sum + (r.plans.find((p) => p.planType === planType)?.revenue ?? 0), 0),
    })) as { planType: PlanType; count: number; revenue: number }[];
  });

  /** Sum of every closer's `annualPremiumRevenue` (USD), for the top stat tile. */
  readonly totalAnnualPremium = computed(() =>
    this.planRows().reduce((sum, r) => sum + (r.annualPremiumRevenue ?? 0), 0),
  );

  async ngOnInit(): Promise<void> {
    try {
      this.rows.set(await this.analyticsService.closers());
    } finally {
      this.loading.set(false);
    }
    try {
      this.planRows.set(await this.analyticsService.closerPlans());
    } finally {
      this.planLoading.set(false);
    }
  }
}
