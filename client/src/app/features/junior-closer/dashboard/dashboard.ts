import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideCircleCheck,
  LucideClock,
  LucideFileText,
  LucideSend,
  LucideTarget,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { AuthService } from '../../../core/services/auth.service';
import { LeadHistoryRow } from '../../../core/models/lead.model';
import {
  formatPhone,
  getAvatarTone,
  getInitials,
  isThisMonth,
  isToday,
  timeAgo,
} from '../../../core/format-utils';
import { EmptyState, SkeletonRows, StatTile, StatusBadge } from '../../../shared/ui/ui';
import { reloadOnChange } from '../../../core/live-reload';

@Component({
  selector: 'app-junior-dashboard',
  imports: [
    RouterLink,
    StatTile,
    StatusBadge,
    EmptyState,
    SkeletonRows,
    LucideSend,
    LucideClock,
    LucideCircleCheck,
    LucideTarget,
    LucideFileText,
  ],
  templateUrl: './dashboard.html',
})
export class JuniorDashboard implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly leadService = inject(LeadService);
  private readonly auth = inject(AuthService);

  readonly leads = signal<LeadHistoryRow[]>([]);
  readonly loading = signal(true);

  readonly firstName = computed(() => this.auth.user()?.name?.split(' ')[0] ?? '');
  readonly timeAgo = timeAgo;
  readonly formatPhone = formatPhone;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  readonly stats = computed(() => {
    const rows = this.leads();
    const accepted = rows.filter((l) => l.status === 'ACCEPTED').length;
    const rejected = rows.filter((l) => l.status === 'REJECTED').length;
    const decided = accepted + rejected;
    return {
      total: rows.length,
      thisMonth: rows.filter((l) => isThisMonth(l.createdAt)).length,
      today: rows.filter((l) => isToday(l.createdAt)).length,
      accepted,
      acceptRate: decided ? Math.round((accepted / decided) * 100) : null,
    };
  });

  readonly recent = computed(() =>
    [...this.leads()]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6),
  );

  async ngOnInit(): Promise<void> {
    try {
      this.leads.set(await this.leadService.myLeads());
    } finally {
      this.loading.set(false);
    }
  }
}
