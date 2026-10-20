import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideBanknoteArrowUp,
  LucideCircleCheck,
  LucideClock,
  LucideHourglass,
  LucideInbox,
  LucideSend,
  LucideTarget,
  LucideTriangleAlert,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { AuthService } from '../../../core/services/auth.service';
import { LeadHistoryRow, LeadInboxPreview } from '../../../core/models/lead.model';
import { getAvatarTone, getInitials, humanizeEnum, pacificIsoDate, pacificToday, timeAgo } from '../../../core/format-utils';
import { EmptyState, SkeletonRows, StatTile, StatusBadge } from '../../../shared/ui/ui';
import { Period, PeriodFilter, inPeriod } from '../../../shared/ui/period-filter';
import { reloadOnChange } from '../../../core/live-reload';

const STALE_AFTER_DAYS = 3;

@Component({
  selector: 'app-closer-dashboard',
  imports: [
    RouterLink,
    PeriodFilter,
    StatTile,
    StatusBadge,
    EmptyState,
    SkeletonRows,
    LucideInbox,
    LucideClock,
    LucideTriangleAlert,
    LucideSend,
    LucideCircleCheck,
    LucideTarget,
    LucideHourglass,
    LucideBanknoteArrowUp,
  ],
  templateUrl: './dashboard.html',
})
export class CloserDashboard implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly leadService = inject(LeadService);
  private readonly auth = inject(AuthService);

  readonly inbox = signal<LeadInboxPreview[]>([]);
  readonly allHistory = signal<LeadHistoryRow[]>([]);
  readonly period = signal<Period>('day');
  readonly anchor = signal(pacificIsoDate(pacificToday()));
  /** Past leads submitted inside the selected period; the inbox backlog is never filtered. */
  readonly history = computed(() => inPeriod(this.allHistory(), this.period(), this.anchor()));
  readonly loading = signal(true);

  readonly firstName = computed(() => this.auth.user()?.name?.split(' ')[0] ?? '');
  readonly timeAgo = timeAgo;
  readonly humanizeEnum = humanizeEnum;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  readonly stats = computed(() => {
    const waiting = this.inbox();
    const past = this.history();
    const accepted = past.filter((l) => l.status === 'ACCEPTED').length;
    const rejected = past.filter((l) => l.status === 'REJECTED').length;
    const decided = accepted + rejected;
    return {
      waiting: waiting.length,
      stale: waiting.filter((l) => this.ageInDays(l.createdAt) >= STALE_AFTER_DAYS).length,
      submitted: past.length,
      accepted,
      acceptRate: decided ? Math.round((accepted / decided) * 100) : null,
      // A sale a client accepted and paid for, then clawed back later — still theirs in
      // history (closerId never changes), just flagged separately from the approve/decline split.
      chargedBack: past.filter((l) => l.status === 'CHARGED_BACK').length,
    };
  });

  /** Newest first. */
  readonly upNext = computed(() =>
    [...this.inbox()]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5),
  );

  readonly recentOutcomes = computed(() =>
    [...this.history()]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5),
  );

  async ngOnInit(): Promise<void> {
    try {
      const [inbox, history] = await Promise.all([
        this.leadService.inbox(),
        this.leadService.closerHistory(),
      ]);
      this.inbox.set(inbox);
      this.allHistory.set(history);
    } finally {
      this.loading.set(false);
    }
  }

  ageInDays(dateStr: string): number {
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  }

  isStale(lead: LeadInboxPreview): boolean {
    return this.ageInDays(lead.createdAt) >= STALE_AFTER_DAYS;
  }
}
