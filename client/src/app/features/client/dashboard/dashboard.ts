import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideBanknote,
  LucideCircleCheck,
  LucideClock,
  LucideFileText,
  LucideInbox,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { AuthService } from '../../../core/services/auth.service';
import { Lead } from '../../../core/models/lead.model';
import {
  formatMoney,
  getAvatarTone,
  getInitials,
  humanizeEnum,
  isThisMonth,
  timeAgo,
} from '../../../core/format-utils';
import { EmptyState, PaymentBadge, SkeletonRows, StatTile } from '../../../shared/ui/ui';
import { reloadOnChange } from '../../../core/live-reload';

@Component({
  selector: 'app-client-dashboard',
  imports: [
    RouterLink,
    StatTile,
    PaymentBadge,
    EmptyState,
    SkeletonRows,
    LucideInbox,
    LucideCircleCheck,
    LucideClock,
    LucideBanknote,
    LucideFileText,
  ],
  templateUrl: './dashboard.html',
})
export class ClientDashboard implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly leadService = inject(LeadService);
  private readonly auth = inject(AuthService);

  readonly previews = signal<Lead[]>([]);
  readonly history = signal<Lead[]>([]);
  readonly loading = signal(true);

  readonly firstName = computed(() => this.auth.user()?.name?.split(' ')[0] ?? '');
  readonly timeAgo = timeAgo;
  readonly humanizeEnum = humanizeEnum;
  readonly formatMoney = formatMoney;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  readonly stats = computed(() => {
    const pending = this.previews();
    const accepted = this.history();
    return {
      pending: pending.length,
      accepted: accepted.length,
      thisMonth: accepted.filter((l) => isThisMonth(l.createdAt)).length,
      closed: accepted.filter((l) => l.paymentStatus === 'PAID').length,
      coverage: accepted.reduce((sum, l) => sum + (l.coverageAmount ?? 0), 0),
    };
  });

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
      this.history.set(history);
    } finally {
      this.loading.set(false);
    }
  }
}
