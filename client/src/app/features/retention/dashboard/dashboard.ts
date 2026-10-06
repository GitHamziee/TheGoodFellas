import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideCircleCheck,
  LucideClock,
  LucideSend,
  LucideTarget,
  LucideUsers,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { AuthService } from '../../../core/services/auth.service';
import { Lead } from '../../../core/models/lead.model';
import { getAvatarTone, getInitials, humanizeEnum, isThisMonth, timeAgo } from '../../../core/format-utils';
import { EmptyState, SkeletonRows, StatTile, StatusBadge } from '../../../shared/ui/ui';
import { reloadOnChange } from '../../../core/live-reload';

/**
 * Retention's landing page — mirrors Closer's dashboard shape (queue at a glance + recent
 * outcomes), but pulls from the shared team queue/history rather than an individually-owned
 * inbox, and never shows money — see retentionHistory()/listRetentionHistory().
 */
@Component({
  selector: 'app-retention-dashboard',
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
    LucideUsers,
  ],
  templateUrl: './dashboard.html',
})
export class RetentionDashboard implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly leadService = inject(LeadService);
  private readonly auth = inject(AuthService);

  readonly queue = signal<Lead[]>([]);
  readonly history = signal<Lead[]>([]);
  readonly loading = signal(true);

  readonly firstName = computed(() => this.auth.user()?.name?.split(' ')[0] ?? '');
  readonly currentUserId = computed(() => this.auth.user()?.id ?? null);

  readonly timeAgo = timeAgo;
  readonly humanizeEnum = humanizeEnum;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  readonly stats = computed(() => {
    const queue = this.queue();
    const past = this.history();
    const mine = this.currentUserId();
    const accepted = past.filter((l) => l.status === 'ACCEPTED').length;
    const rejected = past.filter((l) => l.status === 'REJECTED').length;
    const decided = accepted + rejected;
    return {
      queueTotal: queue.length,
      mine: queue.filter((l) => l.retention?.id === mine).length,
      submitted: past.length,
      thisMonth: past.filter((l) => isThisMonth(l.createdAt)).length,
      accepted,
      acceptRate: decided ? Math.round((accepted / decided) * 100) : null,
    };
  });

  /** My own queue items, oldest first — those are the ones at risk of going stale. */
  readonly upNext = computed(() => {
    const mine = this.currentUserId();
    return [...this.queue()]
      .filter((l) => l.retention?.id === mine)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, 5);
  });

  /** Whole team's most recent outcomes — history is a shared view, same as the queue. */
  readonly recentOutcomes = computed(() =>
    [...this.history()]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5),
  );

  async ngOnInit(): Promise<void> {
    try {
      const [queue, history] = await Promise.all([
        this.leadService.retentionQueue(),
        this.leadService.retentionHistory(),
      ]);
      this.queue.set(queue);
      this.history.set(history);
    } finally {
      this.loading.set(false);
    }
  }
}
