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
import { LeadHistoryRow, LeadStatus } from '../../../core/models/lead.model';
import {
  formatPhone,
  getAvatarTone,
  getInitials,
  isThisMonth,
  isToday,
  timeAgo,
} from '../../../core/format-utils';
import { EmptyState, SkeletonRows, StatTile, StatusBadge } from '../../../shared/ui/ui';

const PIPELINE: { status: LeadStatus; label: string }[] = [
  { status: 'NEW', label: 'With closer' },
  { status: 'SUBMITTED', label: 'With admin' },
  { status: 'ASSIGNED', label: 'With client' },
  { status: 'ACCEPTED', label: 'Accepted' },
  { status: 'REJECTED', label: 'Rejected' },
];

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
      inFlight: rows.filter((l) => l.status === 'NEW' || l.status === 'SUBMITTED').length,
      accepted,
      acceptRate: decided ? Math.round((accepted / decided) * 100) : null,
    };
  });

  readonly pipeline = computed(() => {
    const rows = this.leads();
    const counts = PIPELINE.map((step) => ({
      ...step,
      count: rows.filter((l) => l.status === step.status).length,
      cls: `fb fb--${step.status.toLowerCase()}`,
    }));
    const max = Math.max(1, ...counts.map((c) => c.count));
    return counts.map((c) => ({ ...c, pct: Math.round((c.count / max) * 100) }));
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
