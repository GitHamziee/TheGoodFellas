import { Component, OnInit, inject, signal } from '@angular/core';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { CallReviewAnalytics } from '../../../core/models/review.model';
import { IssueAnalytics } from '../issue-analytics';

/** Live Call Report — issues QA has flagged against each Junior Closer's live calls. */
@Component({
  selector: 'app-qa-live-call-junior',
  imports: [IssueAnalytics],
  template: `
    <app-issue-analytics
      subtitle="Live-call issues QA has flagged for each junior closer."
      peopleLabel="Junior closers"
      emptyTitle="No junior closers yet"
      emptyHint="Create junior closer accounts and flagged issues will show up here."
      [source]="issues()"
      [loading]="loading()"
    />
  `,
})
export class QaLiveCallJunior implements OnInit {
  private readonly analyticsService = inject(AnalyticsService);

  readonly issues = signal<CallReviewAnalytics>({ total: 0, byPerson: [], recent: [] });
  readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    try {
      this.issues.set(await this.analyticsService.callReviewsJunior());
    } finally {
      this.loading.set(false);
    }
  }
}
