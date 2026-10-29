import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BonusPersonRow, BonusRules, BonusService } from '../../../core/services/bonus.service';
import { currentMonth, dayLabel, shiftMonth } from '../../../core/bonus-utils';
import { formatPkr } from '../../../core/format-utils';
import { apiErrorMessage } from '../../../core/api';
import { toastNotice } from '../../../core/toast-notice';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';
import { EmptyState, SkeletonRows } from '../../../shared/ui/ui';

/** Retention bonus rules (editable) and the per-person bonus report for a month. */
@Component({
  selector: 'app-team-bonuses',
  imports: [FormsModule, EmptyState, SkeletonRows],
  template: `
    <div class="card">
      <div class="inline-head"><h2>Retention bonus rules</h2></div>
      <div class="form-grid">
        <label>Monthly target (approvals)<input type="number" min="1" [(ngModel)]="form.monthlyThreshold" name="monthlyThreshold" /></label>
        <label>Monthly bonus (PKR)<input type="number" min="0" [(ngModel)]="form.monthlyBase" name="monthlyBase" /></label>
        <label>Level, per extra lead (PKR)<input type="number" min="0" [(ngModel)]="form.levelRate" name="levelRate" /></label>
        <label>Graded / Modified, per extra lead (PKR)<input type="number" min="0" [(ngModel)]="form.gradedRate" name="gradedRate" /></label>
        <label>GI, per extra lead (PKR)<input type="number" min="0" [(ngModel)]="form.giRate" name="giRate" /></label>
        <span></span>
        <label>2 approvals in a day (PKR)<input type="number" min="0" [(ngModel)]="form.daily2" name="daily2" /></label>
        <label>3 approvals in a day (PKR)<input type="number" min="0" [(ngModel)]="form.daily3" name="daily3" /></label>
        <label>4 approvals in a day (PKR)<input type="number" min="0" [(ngModel)]="form.daily4" name="daily4" /></label>
        <label>5 approvals in a day (PKR)<input type="number" min="0" [(ngModel)]="form.daily5" name="daily5" /></label>
        <label>6+ approvals in a day (PKR)<input type="number" min="0" [(ngModel)]="form.daily6" name="daily6" /></label>
      </div>
      @if (error()) {
        <div class="error">{{ error() }}</div>
      }
      <div class="inline-head">
        <span></span>
        <button type="button" class="btn" [disabled]="saving()" (click)="save()">
          @if (saving()) { <span class="spinner"></span> Saving… } @else { Save rules }
        </button>
      </div>
    </div>

    <div class="card card--flush">
      <div class="card-head">
        <h2>Retention bonuses</h2>
        <div class="pills">
          <button type="button" class="pill" (click)="shift(-1)">←</button>
          <span class="pill active">{{ month() }}</span>
          <button type="button" class="pill" [disabled]="month() >= thisMonth" (click)="shift(1)">→</button>
        </div>
      </div>

      @if (loading()) {
        <app-skeleton-rows [count]="4" />
      } @else if (people().length === 0) {
        <app-empty-state title="No approvals this month" hint="" />
      } @else {
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Approvals</th>
                <th>Daily</th>
                <th>Monthly</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              @for (p of people(); track p.userId) {
                <tr class="clickable" (click)="toggle(p.userId)">
                  <td><span class="cell-main">{{ p.name }}</span></td>
                  <td>{{ p.monthly.count }}</td>
                  <td>{{ pkr(p.dailyTotal) }}</td>
                  <td>{{ pkr(p.monthly.total) }}</td>
                  <td><strong>{{ pkr(p.total) }}</strong></td>
                </tr>
                @if (open() === p.userId) {
                  <tr>
                    <td colspan="5">
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
                          }
                        </tbody>
                      </table>
                      <table>
                        <tbody>
                          <tr><td>Monthly bonus</td><td>{{ pkr(p.monthly.base) }}</td></tr>
                          <tr><td>Level × {{ p.monthly.extra.level }}</td><td>{{ pkr(p.monthly.extra.level * rules().levelRate) }}</td></tr>
                          <tr><td>Graded / Modified × {{ p.monthly.extra.gradedModified }}</td><td>{{ pkr(p.monthly.extra.gradedModified * rules().gradedRate) }}</td></tr>
                          <tr><td>GI × {{ p.monthly.extra.gi }}</td><td>{{ pkr(p.monthly.extra.gi * rules().giRate) }}</td></tr>
                          @if (p.monthly.extra.unclassified) {
                            <tr><td>No plan type × {{ p.monthly.extra.unclassified }}</td><td>{{ pkr(0) }}</td></tr>
                          }
                        </tbody>
                      </table>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class TeamBonuses implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.refresh());
  private readonly bonuses = inject(BonusService);

  readonly thisMonth = currentMonth();
  readonly month = signal(this.thisMonth);
  readonly people = signal<BonusPersonRow[]>([]);
  readonly rules = signal<BonusRules>({
    monthlyThreshold: 15, monthlyBase: 0, daily2: 0, daily3: 0, daily4: 0, daily5: 0, daily6: 0, levelRate: 0, gradedRate: 0, giRate: 0,
  });
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly open = signal<string | null>(null);
  readonly notice = toastNotice();
  readonly pkr = formatPkr;
  readonly label = dayLabel;

  form: BonusRules = { ...this.rules() };

  async ngOnInit(): Promise<void> {
    try {
      const rules = await this.bonuses.rules();
      this.rules.set(rules);
      this.form = { ...rules };
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not load bonus rules.'));
    }
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      const report = await this.bonuses.report(this.month());
      this.rules.set(report.rules);
      this.people.set(report.people);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not load bonuses.'));
    } finally {
      this.loading.set(false);
    }
  }

  shift(by: number): void {
    this.month.set(shiftMonth(this.month(), by));
    this.open.set(null);
    void this.refresh();
  }

  toggle(userId: string): void {
    this.open.update((id) => (id === userId ? null : userId));
  }

  async save(): Promise<void> {
    this.error.set(null);
    this.saving.set(true);
    try {
      const saved = await this.bonuses.saveRules({ ...this.form });
      this.rules.set(saved);
      this.form = { ...saved };
      this.notice.set('Bonus rules saved.');
      await this.refresh();
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not save the bonus rules.'));
    } finally {
      this.saving.set(false);
    }
  }
}
