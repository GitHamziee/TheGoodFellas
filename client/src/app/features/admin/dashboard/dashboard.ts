import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideArrowRight,
  LucideBanknote,
  LucideCircleCheck,
  LucideCircleX,
  LucideInbox,
  LucideTrendingUp,
  LucideTriangleAlert,
  LucideUserCheck,
  LucideWallet,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { AuthService } from '../../../core/services/auth.service';
import { Lead, LeadStatus } from '../../../core/models/lead.model';
import {
  formatMoney,
  getAvatarTone,
  getInitials,
  isThisMonth,
  timeAgo,
} from '../../../core/format-utils';
import { EmptyState, SkeletonRows, StatusBadge } from '../../../shared/ui/ui';

/** A lead sitting in an admin-owned status longer than this is called out as stalled. */
const STALE_AFTER_DAYS = 2;

/** The lead journey, left to right. `owner` is who the lead is blocked on at that stage. */
const FLOW: { status: LeadStatus; label: string; owner: string; mine: boolean }[] = [
  { status: 'NEW', label: 'Intake', owner: 'With closer', mine: false },
  { status: 'SUBMITTED', label: 'Review', owner: 'With you', mine: true },
  { status: 'ASSIGNED', label: 'Offered', owner: 'With client', mine: false },
  { status: 'ACCEPTED', label: 'Accepted', owner: 'Closed', mine: false },
];

@Component({
  selector: 'app-admin-dashboard',
  imports: [
    RouterLink,
    StatusBadge,
    EmptyState,
    SkeletonRows,
    LucideArrowRight,
    LucideBanknote,
    LucideCircleCheck,
    LucideCircleX,
    LucideInbox,
    LucideTrendingUp,
    LucideTriangleAlert,
    LucideUserCheck,
    LucideWallet,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class AdminDashboard implements OnInit {
  private readonly leadService = inject(LeadService);
  private readonly auth = inject(AuthService);

  readonly leads = signal<Lead[]>([]);
  readonly loading = signal(true);

  readonly staleAfterDays = STALE_AFTER_DAYS;
  readonly firstName = computed(() => this.auth.user()?.name?.split(' ')[0] ?? '');
  readonly timeAgo = timeAgo;
  readonly formatMoney = formatMoney;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  /** The three things only an admin can clear. This drives the top command bar. */
  readonly actions = computed(() => {
    const rows = this.leads();
    const toAssign = rows.filter((l) => l.status === 'SUBMITTED');
    const toFix = rows.filter((l) => l.status === 'REJECTED');
    const toCollect = rows.filter((l) => l.status === 'ACCEPTED' && l.paymentStatus === 'UNPAID');
    return {
      toAssign: toAssign.length,
      toFix: toFix.length,
      toCollect: toCollect.length,
      total: toAssign.length + toFix.length + toCollect.length,
      /** Assignment work that has been waiting too long — the reason to act today rather than tomorrow. */
      stalled: toAssign.filter((l) => this.ageInDays(l.updatedAt) >= STALE_AFTER_DAYS).length,
      outstanding: toCollect.reduce((sum, l) => sum + (l.coverageAmount ?? 0), 0),
    };
  });

  /** Lead counts per journey stage, plus the rejected side-branch. */
  readonly flow = computed(() => {
    const rows = this.leads();
    const counts = FLOW.map((stage) => ({
      ...stage,
      count: rows.filter((l) => l.status === stage.status).length,
    }));
    const max = Math.max(1, ...counts.map((c) => c.count));
    return counts.map((c) => ({ ...c, pct: Math.round((c.count / max) * 100) }));
  });

  readonly rejectedCount = computed(() => this.leads().filter((l) => l.status === 'REJECTED').length);

  readonly money = computed(() => {
    const rows = this.leads();
    const accepted = rows.filter((l) => l.status === 'ACCEPTED');
    const paid = accepted.filter((l) => l.paymentStatus === 'PAID');
    const written = accepted.reduce((sum, l) => sum + (l.coverageAmount ?? 0), 0);
    const collected = paid.reduce((sum, l) => sum + (l.coverageAmount ?? 0), 0);
    const decided = accepted.length + rows.filter((l) => l.status === 'REJECTED').length;
    return {
      written,
      collected,
      collectedPct: written ? Math.round((collected / written) * 100) : 0,
      acceptRate: decided ? Math.round((accepted.length / decided) * 100) : null,
      thisMonth: rows.filter((l) => isThisMonth(l.createdAt)).length,
      total: rows.length,
    };
  });

  /** Closers ranked by accepted leads — who is actually converting, not just submitting. */
  readonly leaderboard = computed(() => {
    const byCloser = new Map<string, { id: string; name: string; total: number; accepted: number }>();

    for (const lead of this.leads()) {
      const row = byCloser.get(lead.closer.id) ?? {
        id: lead.closer.id,
        name: lead.closer.name,
        total: 0,
        accepted: 0,
      };
      row.total += 1;
      if (lead.status === 'ACCEPTED') row.accepted += 1;
      byCloser.set(lead.closer.id, row);
    }

    return [...byCloser.values()]
      .map((r) => ({ ...r, rate: r.total ? Math.round((r.accepted / r.total) * 100) : 0 }))
      .sort((a, b) => b.accepted - a.accepted || b.rate - a.rate)
      .slice(0, 5);
  });

  readonly recent = computed(() =>
    [...this.leads()]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 6),
  );

  async ngOnInit(): Promise<void> {
    try {
      this.leads.set(await this.leadService.allLeads());
    } finally {
      this.loading.set(false);
    }
  }

  ageInDays(dateStr: string): number {
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  }
}
