import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideCircleCheck,
  LucideClock,
  LucideInbox,
  LucideSend,
  LucideTarget,
  LucideTriangleAlert,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { AuthService } from '../../../core/services/auth.service';
import { Lead, LeadHistoryRow } from '../../../core/models/lead.model';
import {
  formatPhone,
  getAvatarTone,
  getInitials,
  humanizeEnum,
  isThisMonth,
  timeAgo,
} from '../../../core/format-utils';
import { EmptyState, SkeletonRows, StatTile, StatusBadge } from '../../../shared/ui/ui';

const STALE_AFTER_DAYS = 3;

@Component({
  selector: 'app-closer-dashboard',
  imports: [
    RouterLink,
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
  ],
  templateUrl: './dashboard.html',
})
export class CloserDashboard implements OnInit {
  private readonly leadService = inject(LeadService);
  private readonly auth = inject(AuthService);

  readonly inbox = signal<Lead[]>([]);
  readonly history = signal<LeadHistoryRow[]>([]);
  readonly loading = signal(true);

  readonly firstName = computed(() => this.auth.user()?.name?.split(' ')[0] ?? '');
  readonly timeAgo = timeAgo;
  readonly formatPhone = formatPhone;
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
      thisMonth: past.filter((l) => isThisMonth(l.createdAt)).length,
      accepted,
      acceptRate: decided ? Math.round((accepted / decided) * 100) : null,
    };
  });

  /** Oldest first — those are the ones at risk of going stale. */
  readonly upNext = computed(() =>
    [...this.inbox()]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
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
      this.history.set(history);
    } finally {
      this.loading.set(false);
    }
  }

  ageInDays(dateStr: string): number {
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  }

  isStale(lead: Lead): boolean {
    return this.ageInDays(lead.createdAt) >= STALE_AFTER_DAYS;
  }
}
