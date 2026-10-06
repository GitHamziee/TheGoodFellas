import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideChartColumn, LucideClock, LucideLock, LucideSend } from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { AuthService } from '../../../core/services/auth.service';
import { TeamLeadLeadRow } from '../../../core/models/lead.model';
import { getAvatarTone, getInitials, isThisMonth, isThisWeek, timeAgo } from '../../../core/format-utils';
import { EmptyState, SkeletonRows, StatTile } from '../../../shared/ui/ui';
import { reloadOnChange } from '../../../core/live-reload';

@Component({
  selector: 'app-team-lead-dashboard',
  imports: [RouterLink, StatTile, EmptyState, SkeletonRows, LucideSend, LucideClock, LucideChartColumn, LucideLock],
  templateUrl: './dashboard.html',
})
export class TeamLeadDashboard implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly leadService = inject(LeadService);
  private readonly auth = inject(AuthService);

  readonly leads = signal<TeamLeadLeadRow[]>([]);
  readonly loading = signal(true);

  readonly firstName = computed(() => this.auth.user()?.name?.split(' ')[0] ?? '');
  readonly timeAgo = timeAgo;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  readonly stats = computed(() => {
    const rows = this.leads();
    return {
      total: rows.length,
      thisWeek: rows.filter((l) => isThisWeek(l.createdAt)).length,
      thisMonth: rows.filter((l) => isThisMonth(l.createdAt)).length,
    };
  });

  readonly recent = computed(() =>
    [...this.leads()]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6),
  );

  async ngOnInit(): Promise<void> {
    try {
      this.leads.set(await this.leadService.teamLeadSubmitted());
    } finally {
      this.loading.set(false);
    }
  }
}
