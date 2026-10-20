import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  LucideBanknote,
  LucideCircleCheck,
  LucideCircleX,
  LucideClock,
  LucideFileText,
  LucideInbox,
  LucideMail,
  LucidePencil,
  LucidePhone,
  LucideThumbsDown,
  LucideThumbsUp,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { Lead } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import { formatMoney, formatPhone, getAvatarTone, getInitials, humanizeEnum, pacificIsoDate, pacificToday, timeAgo } from '../../../core/format-utils';
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
import { LeadFullEdit } from '../../../shared/lead-full-edit';
import { Period, PeriodFilter, inPeriod } from '../../../shared/ui/period-filter';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';
import { apiErrorMessage } from '../../../core/api';

@Component({
  selector: 'app-client-lead-history',
  imports: [
    FormsModule,
    Modal,
    LeadDetail,
    LeadFullEdit,
    PeriodFilter,
    StatTile,
    PaymentBadge,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideFileText,
    LucidePencil,
    LucideCircleCheck,
    LucideBanknote,
    LucideClock,
    LucidePhone,
    LucideMail,
    LucideInbox,
    LucideCircleX,
    LucideThumbsUp,
    LucideThumbsDown,
  ],
  templateUrl: './lead-history.html',
})
export class ClientLeadHistory implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly leadService = inject(LeadService);

  /** Same page serves both routes: /client/cpa-leads (CPA + Retention) and /client/cpl-leads (CPL only). */
  readonly isCpl = inject(ActivatedRoute).snapshot.data['kind'] === 'CPL';

  /** Everything the client accepted, narrowed to this page's lead type. */
  readonly allLeads = signal<Lead[]>([]);
  readonly period = signal<Period>('day');
  readonly anchor = signal(pacificIsoDate(pacificToday()));
  /** Approved leads received inside the selected day / week / month; offered leads below stay unfiltered. */
  readonly leads = computed(() => inPeriod(this.allLeads(), this.period(), this.anchor()));
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selected = signal<Lead | null>(null);

  /** Offered-but-undecided leads of this page's type — shown in the section above the history. */
  readonly newLeads = signal<Lead[]>([]);
  readonly notice = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);
  readonly selectedNew = signal<Lead | null>(null);
  /** Non-null while the edit dialog is open. */
  readonly editing = signal<Lead | null>(null);
  /** Non-null while the reject dialog is collecting a reason. */
  readonly rejecting = signal<Lead | null>(null);
  rejectReason = '';
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  readonly formatPhone = formatPhone;
  readonly formatMoney = formatMoney;
  readonly timeAgo = timeAgo;
  readonly humanizeEnum = humanizeEnum;

  readonly paymentFilters = [
    { label: 'All', value: '' },
    { label: 'Open', value: 'UNPAID' },
    { label: 'Paid', value: 'PAID' },
  ];

  readonly view = createListView<Lead>({
    source: this.leads,
    searchFields: (l) => [l.customerName, l.phone, l.email, l.state, l.zipcode, l.mailingAddress, l.carrierName, l.dCode],
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
    const annualPremium = rows.reduce((sum, l) => sum + (l.monthlyPremiums ?? 0) * 12, 0);
    return {
      total: rows.length,
      closed: rows.filter((l) => l.paymentStatus === 'PAID').length,
      annualPremium,
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
      const [all, offered] = await Promise.all([
        this.leadService.clientHistory(),
        this.leadService.assignedPreviews(),
      ]);
      const mine = (l: Lead) => (l.leadType === 'CPL') === this.isCpl;
      this.allLeads.set(all.filter(mine));
      this.newLeads.set(offered.filter(mine));
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

  async accept(lead: Lead, event?: Event): Promise<void> {
    event?.stopPropagation();
    this.error.set(null);
    this.busyId.set(lead.id);
    try {
      await this.leadService.acceptLead(lead.id);
      this.selectedNew.set(null);
      this.notice.set(`Approved ${lead.customerName}. Full details are now in your approved leads below.`);
      await this.ngOnInit();
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not approve the lead.'));
    } finally {
      this.busyId.set(null);
    }
  }

  openEdit(lead: Lead, event?: Event): void {
    event?.stopPropagation();
    this.error.set(null);
    this.editing.set(lead);
  }

  onEdited(updated: Lead): void {
    this.newLeads.update((rows) => rows.map((l) => (l.id === updated.id ? updated : l)));
    if (this.selectedNew()?.id === updated.id) this.selectedNew.set(updated);
    this.editing.set(null);
    this.notice.set(`Saved changes to ${updated.customerName}.`);
  }

  openReject(lead: Lead, event?: Event): void {
    event?.stopPropagation();
    this.error.set(null);
    this.rejectReason = '';
    this.rejecting.set(lead);
  }

  async confirmReject(): Promise<void> {
    const lead = this.rejecting();
    if (!lead) return;
    this.error.set(null);
    this.busyId.set(lead.id);
    try {
      await this.leadService.rejectLead(lead.id, this.rejectReason.trim() || undefined);
      this.newLeads.update((rows) => rows.filter((l) => l.id !== lead.id));
      this.rejecting.set(null);
      this.selectedNew.set(null);
      this.notice.set(`Declined ${lead.customerName}. It's gone back to the admin team.`);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not decline the lead.'));
    } finally {
      this.busyId.set(null);
    }
  }
}
