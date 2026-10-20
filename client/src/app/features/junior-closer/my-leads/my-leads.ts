import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideCircleCheck,
  LucideClock,
  LucideLock,
  LucideSend,
  LucideTarget,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { LeadHistoryRow, LeadStatus } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import {
  formatDateTime,
  getAvatarTone,
  getInitials,
  isThisMonth,
  isToday,
  timeAgo,
  juniorOutcome, qaPassRate,
} from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import {
  Detail,
  EmptyState,
  Pagination,
  SearchBox,
  SkeletonRows,
  StatTile,
  StatusBadge,
} from '../../../shared/ui/ui';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';

@Component({
  selector: 'app-my-leads',
  imports: [
    RouterLink,
    Modal,
    Detail,
    StatTile,
    StatusBadge,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideSend,
    LucideClock,
    LucideCircleCheck,
    LucideTarget,
    LucideLock,
  ],
  templateUrl: './my-leads.html',
})
export class MyLeads implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly leadService = inject(LeadService);

  readonly leads = signal<LeadHistoryRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selected = signal<LeadHistoryRow | null>(null);

  readonly formatDateTime = formatDateTime;
  readonly timeAgo = timeAgo;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  readonly statusFilters = [
    { label: 'All', value: '' },
    { label: 'With closer', value: 'NEW' },
    { label: 'CPL pending', value: 'SUBMITTED' },
    { label: 'Closed', value: 'ACCEPTED' },
    { label: 'Sent back', value: 'RETURNED_TO_JUNIOR' },
  ];

  /** From the junior's side a CPA lead is "Approved" once it has reached the admin; a CPL only
   * once the Client accepts it (see juniorOutcome). */
  readonly displayStatus = (l: LeadHistoryRow): LeadStatus => {
    const o = juniorOutcome(l);
    if (o !== 'PENDING') return o;
    return l.leadType === 'CPL' ? 'SUBMITTED' : l.status;
  };

  readonly view = createListView<LeadHistoryRow>({
    source: this.leads,
    searchFields: (l) => [l.customerName],
    statusOf: (l) => this.displayStatus(l),
    sorters: {
      customerName: (l) => l.customerName,
      status: (l) => l.status,
      createdAt: (l) => new Date(l.createdAt).getTime(),
      updatedAt: (l) => new Date(l.updatedAt ?? l.createdAt).getTime(),
    },
    initialSort: { key: 'updatedAt', dir: 'desc' },
    pageSize: 12,
  });

  readonly stats = computed(() => {
    const rows = this.leads();
    // Approved = CPA reached the admin / CPL accepted by a Client; rejected = admin sent it back.
    const rejected = rows.filter((l) => juniorOutcome(l) === 'RETURNED_TO_JUNIOR').length;
    const accepted = rows.filter((l) => juniorOutcome(l) === 'ACCEPTED').length;
    const acceptedCpl = rows.filter((l) => l.leadType === 'CPL' && juniorOutcome(l) === 'ACCEPTED').length;
    const decided = accepted + rejected;
    return {
      total: rows.length,
      today: rows.filter((l) => isToday(l.createdAt)).length,
      // "Closed" is CPA only — an accepted CPL counts under "Approved CPL" instead.
      accepted: accepted - acceptedCpl,
      acceptedCpl,
      qaRate: qaPassRate(rows),
      // Only counts leads that reached a final decision.
      acceptRate: decided ? Math.round((accepted / decided) * 100) : null,
    };
  });

  readonly statusCounts = computed(() => {
    const rows = this.leads();
    const counts: Record<string, number> = { '': rows.length };
    for (const f of this.statusFilters) if (f.value) counts[f.value] = 0;
    for (const l of rows) {
      const s = this.displayStatus(l);
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  });

  async ngOnInit(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      // History shows the current calendar month only (1st to month end, Pacific).
      this.leads.set((await this.leadService.myLeads()).filter((l) => isThisMonth(l.createdAt)));
    } catch {
      this.error.set('Could not load your leads. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }
}
