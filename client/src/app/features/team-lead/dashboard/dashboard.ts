import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideChartColumn, LucideClock, LucideLock, LucideSend } from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { AuthService } from '../../../core/services/auth.service';
import { TeamLeadLeadRow } from '../../../core/models/lead.model';
import { getAvatarTone, getInitials, pacificIsoDate, pacificToday, timeAgo } from '../../../core/format-utils';
import { EmptyState, SkeletonRows, StatTile } from '../../../shared/ui/ui';
import { Period, PeriodFilter, inPeriod } from '../../../shared/ui/period-filter';
import { Leaderboard, buildLeaderboard } from '../../../shared/ui/leaderboard';
import { reloadOnChange } from '../../../core/live-reload';

@Component({
  selector: 'app-team-lead-dashboard',
  imports: [RouterLink, PeriodFilter, StatTile, EmptyState, SkeletonRows, LucideSend, LucideClock, LucideChartColumn, LucideLock, Leaderboard],
  templateUrl: './dashboard.html',
})
export class TeamLeadDashboard implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly leadService = inject(LeadService);
  private readonly auth = inject(AuthService);

  readonly allLeads = signal<TeamLeadLeadRow[]>([]);
  readonly period = signal<Period>('day');
  readonly anchor = signal(pacificIsoDate(pacificToday()));
  /** Leads submitted inside the selected day / week / month. */
  readonly leads = computed(() => inPeriod(this.allLeads(), this.period(), this.anchor()));
  readonly loading = signal(true);

  readonly firstName = computed(() => this.auth.user()?.name?.split(' ')[0] ?? '');
  readonly timeAgo = timeAgo;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  readonly stats = computed(() => {
    const rows = this.leads();
    const all = this.allLeads();
    return {
      total: rows.length,
      thisWeek: inPeriod(all, 'week', this.anchor()).length,
      thisMonth: inPeriod(all, 'month', this.anchor()).length,
    };
  });

  /** Per-junior-closer totals on the period's leads, shared by both boards. */
  private readonly juniorStats = computed(() => {
    const by = new Map<string, { id: string; name: string; total: number; accepted: number }>();
    for (const lead of this.leads()) {
      const p = lead.juniorCloser;
      if (!p) continue;
      const row = by.get(p.id) ?? { id: p.id, name: p.name, total: 0, accepted: 0 };
      row.total += 1;
      if (lead.status === 'ACCEPTED') row.accepted += 1;
      by.set(p.id, row);
    }
    return [...by.values()];
  });

  /** Junior closers ranked by accepted leads — whose submissions actually get approved. */
  readonly juniorLeaderboard = computed(() =>
    this.juniorStats()
      .map((r) => ({ ...r, rate: r.total ? Math.round((r.accepted / r.total) * 100) : 0 }))
      .sort((a, b) => b.accepted - a.accepted || b.rate - a.rate)
      .slice(0, 5),
  );

  /** Junior closers ranked by lead volume — how many leads each one has submitted. */
  readonly juniorVolumeBoard = computed(() =>
    [...this.juniorStats()].sort((a, b) => b.total - a.total || b.accepted - a.accepted).slice(0, 5),
  );

  readonly boards = computed(() => [
    buildLeaderboard('Top Junior Closers', 'Ranked by approval rate', '/team-lead/analytics/junior-closers', this.juniorLeaderboard(), 'rate'),
    buildLeaderboard('Top Junior Closers by Volume', 'Ranked by leads submitted', '/team-lead/analytics/junior-closers', this.juniorVolumeBoard(), 'volume'),
  ]);

  readonly recent = computed(() =>
    [...this.leads()]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6),
  );

  async ngOnInit(): Promise<void> {
    try {
      this.allLeads.set(await this.leadService.teamLeadSubmitted());
    } finally {
      this.loading.set(false);
    }
  }
}
