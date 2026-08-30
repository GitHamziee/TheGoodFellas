import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  LucideCircleCheck,
  LucideCircleX,
  LucideClock,
  LucideSend,
  LucideTarget,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { Lead } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import { formatPhone, getAvatarTone, getInitials, isThisMonth, timeAgo } from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import { LeadDetail } from '../../../shared/lead-detail';
import { EmptyState, Pagination, SearchBox, SkeletonRows, StatTile, StatusBadge } from '../../../shared/ui/ui';
import { NoCopy } from '../../../shared/no-copy.directive';

/**
 * Shared team history — every RETENTION lead the team has already worked past the queue,
 * not scoped to the caller (same philosophy as the queue page). Full detail except money:
 * `retentionHistory()` comes back with coverageAmount/monthlyPremiums stripped server-side,
 * so `<app-lead-detail>` simply never renders those rows (it hides fields it doesn't have).
 * `appNoCopy` + `[allowCopy]="false"` on the detail view block lifting the data out —
 * paste still works everywhere else, only copy/cut and the clipboard-copy button are blocked.
 */
@Component({
  selector: 'app-retention-history',
  imports: [
    NoCopy,
    Modal,
    LeadDetail,
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
  ],
  templateUrl: './history.html',
})
export class RetentionHistory implements OnInit {
  private readonly leadService = inject(LeadService);

  readonly leads = signal<Lead[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selected = signal<Lead | null>(null);

  readonly formatPhone = formatPhone;
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

  readonly view = createListView<Lead>({
    source: this.leads,
    searchFields: (l) => [l.customerName, l.phone, l.state, l.carrierName, l.retention?.name],
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
      this.leads.set(await this.leadService.retentionHistory());
    } catch {
      this.error.set('Could not load the team history. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }
}
