import { Component, OnInit, inject, signal } from '@angular/core';
import { BonusPersonRow, BonusRules, BonusService } from '../../../core/services/bonus.service';
import { currentMonth, dayLabel, shiftMonth } from '../../../core/bonus-utils';
import { formatPkr } from '../../../core/format-utils';
import { apiErrorMessage } from '../../../core/api';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';
import { PageHero, SkeletonRows, StatTile } from '../../../shared/ui/ui';

/** The signed-in Retention person's own daily and monthly bonus for a month. */
@Component({
  selector: 'app-retention-bonus',
  imports: [PageHero, StatTile, SkeletonRows],
  template: `
    <div class="page">
      <app-page-hero eyebrow="Earnings" title="My Bonus" tone="moss" [count]="loading() ? '–' : pkr(me()?.total ?? 0)" countLabel="this month" />

      <div class="pills">
        <button type="button" class="pill" (click)="shift(-1)">←</button>
        <span class="pill active">{{ month() }}</span>
        <button type="button" class="pill" [disabled]="month() >= thisMonth" (click)="shift(1)">→</button>
      </div>

      @if (error()) {
        <div class="error">{{ error() }}</div>
      }

      @if (loading()) {
        <app-skeleton-rows [count]="4" />
      } @else if (me(); as p) {
        <div class="stats-row">
          <app-stat-tile [value]="p.monthly.count + ' / ' + rules().monthlyThreshold" label="Approvals" tone="tone-c" />
          <app-stat-tile [value]="pkr(p.dailyTotal)" label="Daily bonus" tone="tone-d" />
          <app-stat-tile [value]="pkr(p.monthly.total)" label="Monthly bonus" tone="tone-gold" />
          <app-stat-tile [value]="pkr(p.total)" label="Total" tone="tone-b" />
        </div>

        <div class="card card--flush">
          <div class="card-head"><h2>Daily bonus</h2></div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Submitted</th><th>Approvals</th><th>Bonus</th><th>Paid on</th></tr>
              </thead>
              <tbody>
                @for (d of p.days; track d.day) {
                  <tr>
                    <td>{{ label(d.day) }}</td>
                    <td>{{ d.count }}</td>
                    <td>{{ pkr(d.bonus) }}</td>
                    <td>{{ label(d.payoutDay) }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="4">No approvals yet</td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>

        <div class="card card--flush">
          <div class="card-head"><h2>Monthly bonus</h2></div>
          <div class="table-wrap">
            <table>
              <tbody>
                <tr><td>Monthly bonus ({{ rules().monthlyThreshold }} approvals)</td><td>{{ pkr(p.monthly.base) }}</td></tr>
                <tr><td>Level × {{ p.monthly.extra.level }}</td><td>{{ pkr(p.monthly.extra.level * rules().levelRate) }}</td></tr>
                <tr><td>Graded / Modified × {{ p.monthly.extra.gradedModified }}</td><td>{{ pkr(p.monthly.extra.gradedModified * rules().gradedRate) }}</td></tr>
                <tr><td>GI × {{ p.monthly.extra.gi }}</td><td>{{ pkr(p.monthly.extra.gi * rules().giRate) }}</td></tr>
                @if (p.monthly.extra.unclassified) {
                  <tr><td>No plan type × {{ p.monthly.extra.unclassified }}</td><td>{{ pkr(0) }}</td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </div>
  `,
})
export class RetentionBonus implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.refresh());
  private readonly bonuses = inject(BonusService);

  readonly thisMonth = currentMonth();
  readonly month = signal(this.thisMonth);
  readonly me = signal<BonusPersonRow | null>(null);
  readonly rules = signal<BonusRules>({
    monthlyThreshold: 15, monthlyBase: 0, daily2: 0, daily3: 0, daily4: 0, daily5: 0, daily6: 0, levelRate: 0, gradedRate: 0, giRate: 0,
  });
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly pkr = formatPkr;
  readonly label = dayLabel;

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.bonuses.mine(this.month());
      this.rules.set(res.rules);
      this.me.set(res.me);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not load your bonus.'));
    } finally {
      this.loading.set(false);
    }
  }

  shift(by: number): void {
    this.month.set(shiftMonth(this.month(), by));
    void this.refresh();
  }
}
