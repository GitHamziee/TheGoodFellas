import { Component, OnInit, inject, signal } from '@angular/core';
import { AnalyticsService, OverallAnalytics as OverallAnalyticsData } from '../../../core/services/analytics.service';

@Component({
  selector: 'app-analytics-overall',
  templateUrl: './analytics-overall.html',
  styleUrl: '../../shared-page.css',
})
export class AnalyticsOverall implements OnInit {
  private readonly analyticsService = inject(AnalyticsService);

  readonly overall = signal<OverallAnalyticsData | null>(null);
  readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    this.overall.set(await this.analyticsService.overall());
    this.loading.set(false);
  }
}
