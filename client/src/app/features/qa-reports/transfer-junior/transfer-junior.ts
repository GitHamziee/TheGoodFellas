import { Component, OnInit, inject, signal } from '@angular/core';
import { AnalyticsService, UserOutcomeRow } from '../../../core/services/analytics.service';
import { OutcomeAnalytics } from '../../admin/outcome-analytics';

/** Transfer Report — how QA scored the leads each Junior Closer submitted (intake quality). */
@Component({
  selector: 'app-qa-transfer-junior',
  imports: [OutcomeAnalytics],
  template: `
    <app-outcome-analytics
      subtitle="How QA scored each junior closer's submitted lead information."
      peopleLabel="Junior closers"
      totalLabel="Leads reviewed"
      goodLabel="Pass"
      badLabel="Fail"
      rateLabel="Pass rate"
      noneLabel="No reviews yet"
      unitLabel="reviews"
      emptyTitle="No reviews yet"
      emptyHint="Once QA reviews a junior closer's submitted leads, results show up here."
      [source]="rows()"
      [loading]="loading()"
    />
  `,
})
export class QaTransferJunior implements OnInit {
  private readonly analyticsService = inject(AnalyticsService);

  readonly rows = signal<UserOutcomeRow[]>([]);
  readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    try {
      this.rows.set(await this.analyticsService.qaJuniorClosers());
    } finally {
      this.loading.set(false);
    }
  }
}
