import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  LucideBanknote,
  LucideCircleCheck,
  LucideCircleX,
  LucideClock,
  LucideFileText,
  LucideInbox,
  LucideLayers,
  LucideSend,
  LucideWallet,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { UserService } from '../../../core/services/user.service';
import { Lead, LeadStatus, PaymentStatus } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import { formatPhone, getAvatarTone, getInitials, timeAgo } from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import {
  EmptyState,
  Pagination,
  SearchBox,
  SkeletonRows,
  StatTile,
  StatusBadge,
} from '../../../shared/ui/ui';
import { LeadDetail } from '../../../shared/lead-detail';

const STATUS_FILTERS: { label: string; value: string }[] = [
  { label: 'All', value: '' },
  { label: 'New', value: 'NEW' },
  { label: 'Submitted', value: 'SUBMITTED' },
  { label: 'Assigned', value: 'ASSIGNED' },
  { label: 'Accepted', value: 'ACCEPTED' },
  { label: 'Rejected', value: 'REJECTED' },
];

@Component({
  selector: 'app-admin-leads',
  imports: [
    Modal,
    LeadDetail,
    StatTile,
    StatusBadge,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideLayers,
    LucideSend,
    LucideCircleCheck,
    LucideCircleX,
    LucideWallet,
    LucideInbox,
    LucideBanknote,
    LucideClock,
    LucideFileText,
  ],
  templateUrl: './leads.html',
})
export class AdminLeads implements OnInit {
  private readonly leadService = inject(LeadService);
  private readonly userService = inject(UserService);

  readonly leads = signal<Lead[]>([]);
  readonly loading = signal(true);
  readonly busyId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly selected = signal<Lead | null>(null);
  readonly closerFilter = signal('');

  readonly statusFilters = STATUS_FILTERS;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly formatPhone = formatPhone;
  readonly timeAgo = timeAgo;

  /** Closers that actually appear on a lead — drives the "filter by closer" dropdown. */
  readonly closers = computed(() => {
    const seen = new Map<string, string>();
    for (const lead of this.leads()) {
      if (lead.closer) seen.set(lead.closer.id, lead.closer.name);
    }
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });

  private readonly byCloser = computed(() => {
    const closerId = this.closerFilter();
    const rows = this.leads();
    return closerId ? rows.filter((l) => l.closer?.id === closerId) : rows;
  });

  readonly view = createListView<Lead>({
    source: this.byCloser,
    searchFields: (l) => [l.customerName, l.phone, l.state, l.closer?.name, l.client?.name, l.juniorCloser?.name],
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
    const count = (s: LeadStatus) => rows.filter((l) => l.status === s).length;
    const accepted = rows.filter((l) => l.status === 'ACCEPTED');
    return {
      total: rows.length,
      submitted: count('SUBMITTED'),
      assigned: count('ASSIGNED'),
      accepted: accepted.length,
      rejected: count('REJECTED'),
      paid: accepted.filter((l) => l.paymentStatus === 'PAID').length,
      unpaid: accepted.filter((l) => l.paymentStatus === 'UNPAID').length,
    };
  });

  /** Count per status pill, so the filter row doubles as a breakdown. */
  readonly statusCounts = computed(() => {
    const rows = this.byCloser();
    const counts: Record<string, number> = { '': rows.length };
    for (const filter of STATUS_FILTERS) counts[filter.value] = 0;
    counts[''] = rows.length;
    for (const lead of rows) counts[lead.status] += 1;
    return counts;
  });

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.leads.set(await this.leadService.allLeads());
    } catch {
      this.error.set('Could not load leads. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  setCloserFilter(value: string): void {
    this.closerFilter.set(value);
    this.view.page.set(1);
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }

  async togglePayment(lead: Lead, event: Event): Promise<void> {
    event.stopPropagation();
    const next: PaymentStatus = lead.paymentStatus === 'PAID' ? 'UNPAID' : 'PAID';
    this.error.set(null);
    this.busyId.set(lead.id);
    try {
      const updated = await this.leadService.setPaymentStatus(lead.id, next);
      // Patch in place so the current page/filter/scroll position is preserved.
      this.leads.update((rows) => rows.map((l) => (l.id === lead.id ? updated : l)));
      if (this.selected()?.id === lead.id) this.selected.set(updated);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not update payment status.');
    } finally {
      this.busyId.set(null);
    }
  }
}
