import { Component, OnInit, inject, signal } from '@angular/core';
import { AnalyticsService, UserOutcomeRow } from '../../../core/services/analytics.service';

@Component({
  selector: 'app-analytics-junior',
  templateUrl: './analytics-junior.html',
  styleUrl: '../../shared-page.css',
})
export class AnalyticsJunior implements OnInit {
  private readonly analyticsService = inject(AnalyticsService);

  readonly rows = signal<UserOutcomeRow[]>([]);
  readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    this.rows.set(await this.analyticsService.juniorClosers());
    this.loading.set(false);
  }
}
