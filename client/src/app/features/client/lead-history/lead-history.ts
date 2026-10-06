import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  LucideBanknote,
  LucideCircleCheck,
  LucideClock,
  LucideFileText,
  LucideMail,
  LucidePhone,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { Lead } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import { formatMoney, formatPhone, isThisMonth, timeAgo } from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import {
  EmptyState,
  Pagination,
  PaymentBadge,
  SearchBox,
  SkeletonRows,
  StatTile,
} from '../../../shared/ui/ui';
import { LeadDetail } from '../../../shared/lead-detail';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';

@Component({
  selector: 'app-client-lead-history',
  imports: [
    Modal,
    LeadDetail,
    StatTile,
    PaymentBadge,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideFileText,
    LucideCircleCheck,
    LucideBanknote,
    LucideClock,
    LucidePhone,
    LucideMail,
  ],
  templateUrl: './lead-history.html',
})
export class ClientLeadHistory implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly leadService = inject(LeadService);

  readonly leads = signal<Lead[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selected = signal<Lead | null>(null);

  readonly formatPhone = formatPhone;
  readonly formatMoney = formatMoney;
  readonly timeAgo = timeAgo;

  readonly paymentFilters = [
    { label: 'All', value: '' },
    { label: 'Open', value: 'UNPAID' },
    { label: 'Closed', value: 'PAID' },
  ];

  readonly view = createListView<Lead>({
    source: this.leads,
    searchFields: (l) => [l.customerName, l.phone, l.email, l.state, l.mailingAddress, l.carrierName],
    statusOf: (l) => l.paymentStatus,
    sorters: {
      customerName: (l) => l.customerName,
      coverageAmount: (l) => l.coverageAmount ?? 0,
      createdAt: (l) => new Date(l.createdAt).getTime(),
      updatedAt: (l) => new Date(l.updatedAt ?? l.createdAt).getTime(),
    },
    initialSort: { key: 'updatedAt', dir: 'desc' },
    pageSize: 12,
  });

  readonly stats = computed(() => {
    const rows = this.leads();
    const coverage = rows.reduce((sum, l) => sum + (l.coverageAmount ?? 0), 0);
    return {
      total: rows.length,
      thisMonth: rows.filter((l) => isThisMonth(l.createdAt)).length,
      closed: rows.filter((l) => l.paymentStatus === 'PAID').length,
      coverage,
    };
  });

  readonly paymentCounts = computed(() => {
    const rows = this.leads();
    return {
      '': rows.length,
      UNPAID: rows.filter((l) => l.paymentStatus === 'UNPAID').length,
      PAID: rows.filter((l) => l.paymentStatus === 'PAID').length,
    } as Record<string, number>;
  });

  async ngOnInit(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      this.leads.set(await this.leadService.clientHistory());
    } catch {
      this.error.set('Could not load your lead history. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }
}
