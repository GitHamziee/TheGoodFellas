import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideArrowRight,
  LucideCircleCheck,
  LucideCircleX,
  LucideHeadset,
  LucideInbox,
  LucideLayers,
  LucideTag,
  LucideTrendingUp,
  LucideUserCheck,
  LucideWallet,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { AuthService } from '../../../core/services/auth.service';
import { Lead, LeadStatus } from '../../../core/models/lead.model';
import { getAvatarTone, getInitials, pacificIsoDate, pacificToday, timeAgo } from '../../../core/format-utils';
import { EmptyState, SkeletonRows, StatusBadge } from '../../../shared/ui/ui';
import { Period, PeriodFilter, periodBounds } from '../../../shared/ui/period-filter';
import { Leaderboard, buildLeaderboard } from '../../../shared/ui/leaderboard';
import { reloadOnChange } from '../../../core/live-reload';

/** A lead sitting in an admin-owned status longer than this is called out as stalled. */
const STALE_AFTER_DAYS = 2;

/** The lead journey, left to right. `owner` is who the lead is blocked on at that stage. */
const FLOW: { status: LeadStatus; label: string; owner: string; mine: boolean }[] = [
  { status: 'NEW', label: 'Intake', owner: 'With closer', mine: false },
  { status: 'SUBMITTED', label: 'Review', owner: 'With you', mine: true },
  { status: 'ASSIGNED', label: 'Offered', owner: 'With client', mine: false },
  { status: 'ACCEPTED', label: 'Approved', owner: 'Closed', mine: false },
];

@Component({
  selector: 'app-admin-dashboard',
  imports: [
    RouterLink,
    PeriodFilter,
    StatusBadge,
    EmptyState,
    Leaderboard,
    SkeletonRows,
    LucideArrowRight,
    LucideCircleCheck,
    LucideCircleX,
    LucideHeadset,
    LucideInbox,
    LucideLayers,
    LucideTag,
    LucideTrendingUp,
    LucideUserCheck,
    LucideWallet,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class AdminDashboard implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly leadService = inject(LeadService);
  private readonly auth = inject(AuthService);

  /** Every lead, unfiltered: the command bar is a backlog and must never hide old work. */
  readonly allLeads = signal<Lead[]>([]);
  readonly period = signal<Period>('day');
  readonly anchor = signal(pacificIsoDate(pacificToday()));

  /** Leads submitted inside the selected day / week / month; every metric below the command bar reads this. */
  readonly leads = computed(() => {
    const [start, end] = periodBounds(this.period(), this.anchor());
    return this.allLeads().filter((l) => {
      const t = new Date(l.createdAt).getTime();
      return t >= start && t < end;
    });
  });
  readonly loading = signal(true);

  readonly staleAfterDays = STALE_AFTER_DAYS;
  readonly firstName = computed(() => this.auth.user()?.name?.split(' ')[0] ?? '');
  readonly timeAgo = timeAgo;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  /** The three things only an admin can clear. This drives the top command bar. */
  readonly actions = computed(() => {
    const rows = this.allLeads();
    const toAssign = rows.filter((l) => l.status === 'SUBMITTED');
    const toFix = rows.filter((l) => l.status === 'REJECTED');
    const toCollect = rows.filter((l) => l.status === 'ACCEPTED' && l.paymentStatus === 'UNPAID');
    // CPA and CPL leads are marked paid from their own separate admin pages, so "to collect"
    // is split by type — a single count would send the admin to a page missing half of them.
    const toCollectCpa = toCollect.filter((l) => l.leadType === 'CPA').length;
    const toCollectCpl = toCollect.filter((l) => l.leadType === 'CPL').length;
    return {
      toAssign: toAssign.length,
      toFix: toFix.length,
      toCollectCpa,
      toCollectCpl,
      total: toAssign.length + toFix.length + toCollectCpa + toCollectCpl,
      /** Assignment work that has been waiting too long — the reason to act today rather than tomorrow. */
      stalled: toAssign.filter((l) => this.ageInDays(l.updatedAt) >= STALE_AFTER_DAYS).length,
    };
  });

  /** Lead counts per journey stage. The rejected side-branch hangs off it separately. */
  readonly flow = computed(() => {
    const rows = this.leads();
    return FLOW.map((stage) => ({
      ...stage,
      count: rows.filter((l) => l.status === stage.status).length,
    }));
  });

  readonly rejectedCount = computed(() => this.leads().filter((l) => l.status === 'REJECTED').length);

  /** How many leads came in through each pipeline — CPA, CPL, and Retention each have
   *  their own dedicated admin page, so this is the at-a-glance split between them. */
  readonly bySource = computed(() => {
    const rows = this.leads();
    return {
      cpa: rows.filter((l) => l.leadType === 'CPA').length,
      cpl: rows.filter((l) => l.leadType === 'CPL').length,
      retention: rows.filter((l) => l.leadType === 'RETENTION').length,
    };
  });

  /**
   * How the pipeline is converting, in leads. Deliberately count-based: a lead's
   * `coverageAmount` is the customer's policy size, not what we bill the client
   * for the lead, so it is never totalled up and shown as money owed.
   */
  readonly conversion = computed(() => {
    const rows = this.leads();
    const accepted = rows.filter((l) => l.status === 'ACCEPTED');
    const rejected = rows.filter((l) => l.status === 'REJECTED');
    const decided = accepted.length + rejected.length;
    const pending = rows.length - decided;
    const max = Math.max(1, accepted.length, rejected.length, pending);
    return {
      total: rows.length,
      accepted: accepted.length,
      rejected: rejected.length,
      pending,
      acceptedPct: Math.round((accepted.length / max) * 100),
      rejectedPct: Math.round((rejected.length / max) * 100),
      pendingPct: Math.round((pending / max) * 100),
      acceptRate: decided ? Math.round((accepted.length / decided) * 100) : null,
      paid: accepted.filter((l) => l.paymentStatus === 'PAID').length,
      unpaid: accepted.filter((l) => l.paymentStatus === 'UNPAID').length,
    };
  });

  /** Closers ranked by accepted leads — who is actually converting, not just submitting. */
  readonly leaderboard = computed(() => {
    const byCloser = new Map<string, { id: string; name: string; total: number; accepted: number }>();

    // CPL leads have no closer to rank — leaderboard is closer performance specifically.
    for (const lead of this.leads()) {
      if (!lead.closer) continue;
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

  /** Closers ranked by lead volume — how many leads each one has handled, regardless of outcome. */
  readonly volumeBoard = computed(() => {
    const byCloser = new Map<string, { id: string; name: string; total: number; accepted: number }>();

    for (const lead of this.leads()) {
      if (!lead.closer) continue;
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

    return [...byCloser.values()].sort((a, b) => b.total - a.total || b.accepted - a.accepted).slice(0, 5);
  });

  /** Per-junior-closer totals, shared by both junior boards. */
  private readonly juniorStats = computed(() => {
    const byJunior = new Map<string, { id: string; name: string; total: number; accepted: number }>();

    for (const lead of this.leads()) {
      if (!lead.juniorCloser) continue;
      const row = byJunior.get(lead.juniorCloser.id) ?? {
        id: lead.juniorCloser.id,
        name: lead.juniorCloser.name,
        total: 0,
        accepted: 0,
      };
      row.total += 1;
      if (lead.status === 'ACCEPTED') row.accepted += 1;
      byJunior.set(lead.juniorCloser.id, row);
    }

    return [...byJunior.values()];
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

  /** The four leaderboards, top three each. */
  readonly boards = computed(() => [
    buildLeaderboard('Top Closers', 'Ranked by approval rate', '/admin/analytics/closers', this.leaderboard(), 'rate'),
    buildLeaderboard('Top Closers by Volume', 'Ranked by leads handled', '/admin/analytics/closers', this.volumeBoard(), 'volume'),
    buildLeaderboard('Top Junior Closers', 'Ranked by approval rate', '/admin/analytics/junior-closers', this.juniorLeaderboard(), 'rate'),
    buildLeaderboard('Top Junior Closers by Volume', 'Ranked by leads submitted', '/admin/analytics/junior-closers', this.juniorVolumeBoard(), 'volume'),
  ]);

  readonly recent = computed(() =>
    [...this.leads()]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 6),
  );

  async ngOnInit(): Promise<void> {
    try {
      this.allLeads.set(await this.leadService.allLeads());
    } finally {
      this.loading.set(false);
    }
  }

  ageInDays(dateStr: string): number {
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  }
}
