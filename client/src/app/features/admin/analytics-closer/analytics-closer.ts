import { Component, OnInit, inject, signal } from '@angular/core';
import { AnalyticsService, UserOutcomeRow } from '../../../core/services/analytics.service';

@Component({
  selector: 'app-analytics-closer',
  templateUrl: './analytics-closer.html',
  styleUrl: '../../shared-page.css',
})
export class AnalyticsCloser implements OnInit {
  private readonly analyticsService = inject(AnalyticsService);

  readonly rows = signal<UserOutcomeRow[]>([]);
  readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    this.rows.set(await this.analyticsService.closers());
    this.loading.set(false);
  }
}
