import { AdminStatusBadge } from '../../../shared/ui/admin-status';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideCircleCheck,
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
  pacificIsoDate,
  pacificToday,
  timeAgo,
  juniorOutcome,
  qaPassRate,
} from '../../../core/format-utils';
import { EmptyState, SkeletonRows, StatTile, StatusBadge } from '../../../shared/ui/ui';
import { Period, PeriodFilter, inPeriod } from '../../../shared/ui/period-filter';
import { reloadOnChange } from '../../../core/live-reload';

@Component({
  selector: 'app-junior-dashboard',
  imports: [AdminStatusBadge, 
    RouterLink,
    PeriodFilter,
    StatTile,
    StatusBadge,
    EmptyState,
    SkeletonRows,
    LucideSend,
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

  readonly allLeads = signal<LeadHistoryRow[]>([]);
  readonly period = signal<Period>('day');
  readonly anchor = signal(pacificIsoDate(pacificToday()));
  /** Leads submitted inside the selected day / week / month. */
  readonly leads = computed(() => inPeriod(this.allLeads(), this.period(), this.anchor()));
  readonly loading = signal(true);

  readonly firstName = computed(() => this.auth.user()?.name?.split(' ')[0] ?? '');
  readonly timeAgo = timeAgo;
  readonly formatPhone = formatPhone;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  readonly stats = computed(() => {
    const rows = this.leads();
    // Approved = CPA reached the admin / CPL accepted by a Client; rejected = admin sent it back.
    const rejected = rows.filter((l) => juniorOutcome(l) === 'RETURNED_TO_JUNIOR').length;
    const accepted = rows.filter((l) => juniorOutcome(l) === 'ACCEPTED').length;
    const acceptedCpl = rows.filter((l) => l.leadType === 'CPL' && juniorOutcome(l) === 'ACCEPTED').length;
    const decided = accepted + rejected;
    return {
      total: rows.length,
      // "Closed" is CPA only — an accepted CPL counts under "Approved CPL" instead.
      accepted: accepted - acceptedCpl,
      acceptedCpl,
      qaRate: qaPassRate(rows),
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
      this.allLeads.set(await this.leadService.myLeads());
    } finally {
      this.loading.set(false);
    }
  }
}
