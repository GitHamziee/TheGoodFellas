import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideArrowRight,
  LucideCircleCheck,
  LucideClock,
  LucideFileText,
  LucideSparkles,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { AuthService } from '../../../core/services/auth.service';
import { Lead } from '../../../core/models/lead.model';
import {
  formatMoney,
  getAvatarTone,
  getInitials,
  humanizeEnum,
  pacificIsoDate,
  pacificToday,
  timeAgo,
} from '../../../core/format-utils';
import { EmptyState, PaymentBadge, SkeletonRows } from '../../../shared/ui/ui';
import { Period, PeriodFilter, inPeriod } from '../../../shared/ui/period-filter';
import { reloadOnChange } from '../../../core/live-reload';

type Kind = 'CPA' | 'CPL';

const kindOf = (l: Lead): Kind => (l.leadType === 'CPL' ? 'CPL' : 'CPA');

@Component({
  selector: 'app-client-dashboard',
  imports: [
    RouterLink,
    PeriodFilter,
    PaymentBadge,
    EmptyState,
    SkeletonRows,
    LucideCircleCheck,
    LucideClock,
    LucideFileText,
    LucideArrowRight,
    LucideSparkles,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class ClientDashboard implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly leadService = inject(LeadService);
  private readonly auth = inject(AuthService);

  readonly previews = signal<Lead[]>([]);
  /** Every approved lead, unfiltered: feeds the 6-month chart and the all-time count. */
  readonly allHistory = signal<Lead[]>([]);
  readonly period = signal<Period>('day');
  readonly anchor = signal(pacificIsoDate(pacificToday()));
  /** Approved leads inside the selected day / week / month. "Waiting on you" is a backlog and is never filtered. */
  readonly history = computed(() => inPeriod(this.allHistory(), this.period(), this.anchor()));
  readonly loading = signal(true);

  readonly firstName = computed(() => this.auth.user()?.name?.split(' ')[0] ?? '');
  readonly timeAgo = timeAgo;
  readonly humanizeEnum = humanizeEnum;
  readonly formatMoney = formatMoney;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly kindOf = kindOf;
  readonly pageOf = (l: Lead) => (kindOf(l) === 'CPL' ? '/client/cpl-leads' : '/client/cpa-leads');

  readonly greeting = computed(() => {
    const h = new Date().getHours();
    return h < 5 ? 'Burning the midnight oil' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  });

  readonly waiting = computed(() => this.previews().length);

  /** One-line read on where the client stands right now. */
  readonly headline = computed(() => {
    const n = this.waiting();
    if (n === 0) return "You're all caught up — nothing is waiting on you.";
    return n === 1 ? 'One new lead is waiting for your call.' : `${n} new leads are waiting for your call.`;
  });

  /** Per-type numbers for the two pipeline cards. */
  readonly pipelines = computed(() => {
    const build = (kind: Kind) => {
      const pending = this.previews().filter((l) => kindOf(l) === kind);
      const accepted = this.history().filter((l) => kindOf(l) === kind);
      const closed = accepted.filter((l) => l.paymentStatus === 'PAID').length;
      return {
        kind,
        path: kind === 'CPL' ? '/client/cpl-leads' : '/client/cpa-leads',
        pending: pending.length,
        accepted: accepted.length,
        thisMonth: inPeriod(this.allHistory(), 'month', this.anchor()).filter((l) => kindOf(l) === kind).length,
        closed,
        closedPct: accepted.length ? Math.round((closed / accepted.length) * 100) : 0,
        annualPremium: accepted.reduce((sum, l) => sum + (l.monthlyPremiums ?? 0) * 12, 0),
      };
    };
    return [build('CPA'), build('CPL')];
  });

  /** Approved leads per month for the last six months, scaled for the bar chart. */
  readonly months = computed(() => {
    const now = new Date();
    const buckets = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleString('en', { month: 'short' }), count: 0 };
    });
    for (const l of this.allHistory()) {
      const d = new Date(l.createdAt);
      const b = buckets.find((x) => x.key === `${d.getFullYear()}-${d.getMonth()}`);
      if (b) b.count++;
    }
    const max = Math.max(1, ...buckets.map((b) => b.count));
    return buckets.map((b, i) => ({ ...b, pct: Math.round((b.count / max) * 100), current: i === 5 }));
  });

  readonly totalAccepted = computed(() => this.allHistory().length);

  /** Newest offers first. */
  readonly awaiting = computed(() =>
    [...this.previews()]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5),
  );

  readonly recentAccepted = computed(() =>
    [...this.history()]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5),
  );

  async ngOnInit(): Promise<void> {
    try {
      const [previews, history] = await Promise.all([
        this.leadService.assignedPreviews(),
        this.leadService.clientHistory(),
      ]);
      this.previews.set(previews);
      this.allHistory.set(history);
    } finally {
      this.loading.set(false);
    }
  }
}
