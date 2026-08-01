import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideBriefcase,
  LucideChartColumn,
  LucideCircleCheck,
  LucideCircleX,
  LucideLayers,
  LucideShieldCheck,
  LucideTarget,
  LucideUsers,
  LucideWallet,
} from '@lucide/angular';
import {
  AnalyticsService,
  OverallAnalytics as OverallAnalyticsData,
} from '../../../core/services/analytics.service';
import { LeadStatus } from '../../../core/models/lead.model';
import { Role } from '../../../core/models/user.model';
import { ROLE_LABEL } from '../../../core/nav-config';
import { EmptyState, SkeletonRows, StatTile } from '../../../shared/ui/ui';

const STATUS_ORDER: { status: LeadStatus; label: string; hint: string }[] = [
  { status: 'NEW', label: 'New', hint: 'Submitted by a junior closer, waiting on a closer' },
  { status: 'SUBMITTED', label: 'Submitted', hint: 'Enriched by a closer, waiting on admin assignment' },
  { status: 'ASSIGNED', label: 'Assigned', hint: 'Offered to a client, awaiting their decision' },
  { status: 'ACCEPTED', label: 'Accepted', hint: 'Taken on by a client' },
  { status: 'REJECTED', label: 'Rejected', hint: 'Sent back — needs fixing and reassignment' },
];

const ROLE_ORDER: Role[] = ['JUNIOR_CLOSER', 'CLOSER', 'ADMIN', 'CLIENT'];

const ROLE_TONE: Record<Role, string> = {
  ADMIN: 'tone-b',
  CLOSER: 'tone-c',
  JUNIOR_CLOSER: 'tone-d',
  CLIENT: 'tone-f',
};

@Component({
  selector: 'app-analytics-overall',
  imports: [
    RouterLink,
    StatTile,
    EmptyState,
    SkeletonRows,
    LucideLayers,
    LucideCircleCheck,
    LucideCircleX,
    LucideWallet,
    LucideTarget,
    LucideUsers,
    LucideBriefcase,
    LucideShieldCheck,
    LucideChartColumn,
  ],
  templateUrl: './analytics-overall.html',
})
export class AnalyticsOverall implements OnInit {
  private readonly analyticsService = inject(AnalyticsService);

  readonly overall = signal<OverallAnalyticsData | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly roleLabel = ROLE_LABEL;
  readonly roleTone = ROLE_TONE;
  readonly roleOrder = ROLE_ORDER;

  readonly metrics = computed(() => {
    const o = this.overall();
    if (!o) return null;
    const accepted = o.statusCounts.ACCEPTED ?? 0;
    const rejected = o.statusCounts.REJECTED ?? 0;
    const decided = accepted + rejected;
    const inFlight = (o.statusCounts.NEW ?? 0) + (o.statusCounts.SUBMITTED ?? 0) + (o.statusCounts.ASSIGNED ?? 0);
    return {
      total: o.totalLeads,
      accepted,
      rejected,
      inFlight,
      closed: o.closedCount,
      unpaid: o.unpaidAcceptedCount,
      // Share of decided leads that were accepted.
      acceptRate: decided ? Math.round((accepted / decided) * 100) : null,
      // Share of accepted leads that have been marked paid.
      collectionRate: accepted ? Math.round((o.closedCount / accepted) * 100) : null,
    };
  });

  /** Status counts scaled to the largest bucket for the bar chart. */
  readonly statusBars = computed(() => {
    const o = this.overall();
    if (!o) return [];
    const rows = STATUS_ORDER.map((s) => ({
      ...s,
      count: o.statusCounts[s.status] ?? 0,
      cls: `fb fb--${s.status.toLowerCase()}`,
      barCls: `bar bar--${s.status === 'ACCEPTED' ? 'accepted' : s.status === 'REJECTED' ? 'rejected' : 'other'}`,
    }));
    const max = Math.max(1, ...rows.map((r) => r.count));
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    return rows.map((r) => ({
      ...r,
      pct: Math.round((r.count / max) * 100),
      share: total ? Math.round((r.count / total) * 100) : 0,
    }));
  });

  readonly roleRows = computed(() => {
    const o = this.overall();
    if (!o) return [];
    const total = ROLE_ORDER.reduce((sum, r) => sum + (o.roleCounts[r] ?? 0), 0);
    return ROLE_ORDER.map((role) => ({
      role,
      label: ROLE_LABEL[role],
      tone: ROLE_TONE[role],
      count: o.roleCounts[role] ?? 0,
      share: total ? Math.round(((o.roleCounts[role] ?? 0) / total) * 100) : 0,
    }));
  });

  async ngOnInit(): Promise<void> {
    try {
      this.overall.set(await this.analyticsService.overall());
    } catch {
      this.error.set('Could not load analytics. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
