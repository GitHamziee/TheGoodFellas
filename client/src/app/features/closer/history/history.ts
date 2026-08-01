import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  LucideCircleCheck,
  LucideCircleX,
  LucideClock,
  LucideLock,
  LucideSend,
  LucideTarget,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { LeadHistoryRow } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import {
  formatDateTime,
  formatPhone,
  getAvatarTone,
  getInitials,
  isThisMonth,
  timeAgo,
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

@Component({
  selector: 'app-closer-history',
  imports: [
    Modal,
    Detail,
    StatTile,
    StatusBadge,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideSend,
    LucideCircleCheck,
    LucideCircleX,
    LucideClock,
    LucideTarget,
    LucideLock,
  ],
  templateUrl: './history.html',
})
export class CloserHistory implements OnInit {
  private readonly leadService = inject(LeadService);

  readonly leads = signal<LeadHistoryRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selected = signal<LeadHistoryRow | null>(null);

  readonly formatPhone = formatPhone;
  readonly formatDateTime = formatDateTime;
  readonly timeAgo = timeAgo;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  readonly statusFilters = [
    { label: 'All', value: '' },
    { label: 'Submitted', value: 'SUBMITTED' },
    { label: 'Assigned', value: 'ASSIGNED' },
    { label: 'Accepted', value: 'ACCEPTED' },
    { label: 'Rejected', value: 'REJECTED' },
  ];

  readonly view = createListView<LeadHistoryRow>({
    source: this.leads,
    searchFields: (l) => [l.customerName, l.phone],
    statusOf: (l) => l.status,
    sorters: {
      customerName: (l) => l.customerName,
      status: (l) => l.status,
      createdAt: (l) => new Date(l.createdAt).getTime(),
    },
    initialSort: { key: 'createdAt', dir: 'desc' },
    pageSize: 12,
  });

  readonly stats = computed(() => {
    const rows = this.leads();
    const accepted = rows.filter((l) => l.status === 'ACCEPTED').length;
    const rejected = rows.filter((l) => l.status === 'REJECTED').length;
    const decided = accepted + rejected;
    return {
      total: rows.length,
      thisMonth: rows.filter((l) => isThisMonth(l.createdAt)).length,
      accepted,
      rejected,
      // Share of decided leads that were accepted — blank until something is decided.
      acceptRate: decided ? Math.round((accepted / decided) * 100) : null,
    };
  });

  readonly statusCounts = computed(() => {
    const rows = this.leads();
    const counts: Record<string, number> = { '': rows.length };
    for (const f of this.statusFilters) if (f.value) counts[f.value] = 0;
    for (const l of rows) counts[l.status] = (counts[l.status] ?? 0) + 1;
    return counts;
  });

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    try {
      this.leads.set(await this.leadService.closerHistory());
    } catch {
      this.error.set('Could not load your history. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }
}
