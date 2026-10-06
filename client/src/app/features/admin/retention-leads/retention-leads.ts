import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideBanknote,
  LucideBanknoteX,
  LucideBuilding2,
  LucideCircleCheck,
  LucideClock,
  LucideHeadset,
  LucideInbox,
  LucideUserCheck,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { UserService } from '../../../core/services/user.service';
import { ExternalClientService } from '../../../core/services/external-client.service';
import { ExternalClient } from '../../../core/models/external-client.model';
import { Lead } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import { formatPhone, formatPkr, getAvatarTone, getInitials, timeAgo } from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import {
  EmptyState,
  Pagination,
  PaymentBadge,
  SearchBox,
  SkeletonRows,
  StatTile,
  StatusBadge,
} from '../../../shared/ui/ui';
import { LeadDetail } from '../../../shared/lead-detail';

interface LookupUser {
  id: string;
  name: string;
  email: string;
}

const STATUS_FILTERS = [
  { label: 'All', value: '' },
  { label: 'New', value: 'NEW' },
  { label: 'Submitted', value: 'SUBMITTED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Sent back', value: 'RETURNED_TO_RETENTION' },
  { label: 'Assigned', value: 'ASSIGNED' },
  { label: 'Accepted', value: 'ACCEPTED' },
  { label: 'Assigned (External)', value: 'ASSIGNED_EXTERNAL' },
  { label: 'Charged Back', value: 'CHARGED_BACK' },
];

/**
 * Admin's full-pipeline view of RETENTION leads — every status, same pattern as the
 * dedicated CPA (leads.ts) and CPL (cpl-leads.ts) pages. `admin/retention` (Retention
 * Imports) is only the intake triage inbox for unassigned sheet imports; this page is
 * the reporting/history view across the whole lifecycle, including handing an unassigned
 * import to a Retention person — the one action this pipeline has that CPA/CPL don't.
 */
@Component({
  selector: 'app-admin-retention-leads',
  imports: [
    FormsModule,
    Modal,
    LeadDetail,
    StatTile,
    StatusBadge,
    PaymentBadge,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideInbox,
    LucideHeadset,
    LucideClock,
    LucideCircleCheck,
    LucideUserCheck,
    LucideBuilding2,
    LucideBanknote,
    LucideBanknoteX,
  ],
  templateUrl: './retention-leads.html',
})
export class AdminRetentionLeads implements OnInit {
  private readonly leadService = inject(LeadService);
  private readonly userService = inject(UserService);
  private readonly externalClientService = inject(ExternalClientService);

  readonly leads = signal<Lead[]>([]);
  readonly clients = signal<LookupUser[]>([]);
  readonly externalClients = signal<ExternalClient[]>([]);
  readonly retentionPeople = signal<LookupUser[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);

  /** Which lead each modal is acting on — only one is ever open at a time. */
  readonly detailLead = signal<Lead | null>(null);
  readonly assignRetentionLead = signal<Lead | null>(null);
  readonly assignLead = signal<Lead | null>(null);
  readonly assignExternalLead = signal<Lead | null>(null);

  readonly retentionSearch = signal('');
  readonly chosenRetentionId = signal('');
  readonly clientSearch = signal('');
  readonly chosenClientId = signal('');
  readonly externalClientSearch = signal('');
  readonly chosenExternalClientId = signal('');

  /** Lead being charged back — single-record action, mirrors the CPL/CPA pages. */
  readonly chargeBackLead = signal<Lead | null>(null);
  readonly chargeBackSubmitting = signal(false);
  chargeBackPkrAmount: number | null = null;
  chargeBackReason = '';

  /** Leads picked for the batch "Mark Paid" action, keyed by id across pages/filters. */
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly batchModalOpen = signal(false);
  readonly batchSubmitting = signal(false);
  batchPkrAmount: number | null = null;
  batchNote = '';

  readonly statusFilters = STATUS_FILTERS;

  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly formatPhone = formatPhone;
  readonly formatPkr = formatPkr;
  readonly timeAgo = timeAgo;

  readonly view = createListView<Lead>({
    source: this.leads,
    searchFields: (l) => [l.customerName, l.phone, l.state, l.carrierName, l.retention?.name],
    statusOf: (l) => l.status,
    sorters: {
      customerName: (l) => l.customerName,
      createdAt: (l) => new Date(l.createdAt).getTime(),
      updatedAt: (l) => new Date(l.updatedAt ?? l.createdAt).getTime(),
    },
    initialSort: { key: 'updatedAt', dir: 'desc' },
    pageSize: 10,
  });

  readonly stats = computed(() => {
    const rows = this.leads();
    const accepted = rows.filter((l) => l.status === 'ACCEPTED');
    return {
      total: rows.length,
      unassigned: rows.filter((l) => l.status === 'NEW' && !l.retentionId).length,
      inProgress: rows.filter((l) => l.status === 'NEW' && !!l.retentionId).length,
      submitted: rows.filter((l) => l.status === 'SUBMITTED').length,
      accepted: accepted.length,
      unpaid: accepted.filter((l) => l.paymentStatus === 'UNPAID').length,
      chargedBack: rows.filter((l) => l.status === 'CHARGED_BACK').length,
    };
  });

  readonly statusCounts = computed(() => {
    const rows = this.leads();
    const counts: Record<string, number> = {};
    for (const filter of STATUS_FILTERS) counts[filter.value] = 0;
    counts[''] = rows.length;
    for (const lead of rows) counts[lead.status] = (counts[lead.status] ?? 0) + 1;
    return counts;
  });

  readonly selectedCount = computed(() => this.selectedIds().size);

  /** Only unpaid ACCEPTED/ASSIGNED_EXTERNAL leads can be batch-marked paid. */
  isEligibleForBatchPaid(lead: Lead): boolean {
    return lead.paymentStatus === 'UNPAID' && (lead.status === 'ACCEPTED' || lead.status === 'ASSIGNED_EXTERNAL');
  }

  isSelected(lead: Lead): boolean {
    return this.selectedIds().has(lead.id);
  }

  toggleSelect(lead: Lead, event: Event): void {
    event.stopPropagation();
    if (!this.isEligibleForBatchPaid(lead)) return;
    this.selectedIds.update((ids) => {
      const next = new Set(ids);
      if (next.has(lead.id)) next.delete(lead.id);
      else next.add(lead.id);
      return next;
    });
  }

  /** Header checkbox — true only when every eligible row on the current page is selected. */
  readonly allVisibleEligibleSelected = computed(() => {
    const eligible = this.view.rows().filter((l) => this.isEligibleForBatchPaid(l));
    return eligible.length > 0 && eligible.every((l) => this.selectedIds().has(l.id));
  });

  toggleSelectAllVisible(): void {
    const eligible = this.view.rows().filter((l) => this.isEligibleForBatchPaid(l));
    const allSelected = this.allVisibleEligibleSelected();
    this.selectedIds.update((ids) => {
      const next = new Set(ids);
      for (const lead of eligible) {
        if (allSelected) next.delete(lead.id);
        else next.add(lead.id);
      }
      return next;
    });
  }

  clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  /** Retention-staff dropdown, narrowed by the search box inside the assign modal. */
  readonly filteredRetentionPeople = computed(() => {
    const term = this.retentionSearch().trim().toLowerCase();
    if (!term) return this.retentionPeople();
    return this.retentionPeople().filter(
      (p) => p.name.toLowerCase().includes(term) || p.email.toLowerCase().includes(term),
    );
  });

  /** Client dropdown, narrowed by the search box inside the assign modal. */
  readonly filteredClients = computed(() => {
    const term = this.clientSearch().trim().toLowerCase();
    if (!term) return this.clients();
    return this.clients().filter(
      (c) => c.name.toLowerCase().includes(term) || c.email.toLowerCase().includes(term),
    );
  });

  /** External client dropdown, narrowed by the search box inside the assign-external modal. */
  readonly filteredExternalClients = computed(() => {
    const term = this.externalClientSearch().trim().toLowerCase();
    if (!term) return this.externalClients();
    return this.externalClients().filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.company ?? '').toLowerCase().includes(term) ||
        (c.email ?? '').toLowerCase().includes(term),
    );
  });

  async ngOnInit(): Promise<void> {
    const [clients, externalClients, retentionPeople] = await Promise.all([
      this.userService.listClients(),
      this.externalClientService.list(),
      this.userService.listRetention(),
      this.refresh(),
    ]);
    this.clients.set(clients);
    this.externalClients.set(externalClients);
    this.retentionPeople.set(retentionPeople);
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.leads.set(await this.leadService.retentionAllLeads());
    } catch {
      this.error.set('Could not load retention leads. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }

  // ─── Assign to retention person (or re-hand a misassignment) ──
  openAssignRetention(lead: Lead, event?: Event): void {
    event?.stopPropagation();
    this.error.set(null);
    this.retentionSearch.set('');
    this.chosenRetentionId.set(lead.retention?.id ?? '');
    this.assignRetentionLead.set(lead);
  }

  async confirmAssignRetention(): Promise<void> {
    const lead = this.assignRetentionLead();
    const retentionId = this.chosenRetentionId();
    if (!lead || !retentionId) return;

    this.error.set(null);
    this.busyId.set(lead.id);
    try {
      const updated = await this.leadService.assignRetention(lead.id, retentionId);
      this.leads.update((rows) => rows.map((l) => (l.id === lead.id ? updated : l)));
      this.assignRetentionLead.set(null);
      this.notice.set(`${lead.customerName} assigned to ${updated.retention?.name ?? 'retention'}.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not assign the lead.');
    } finally {
      this.busyId.set(null);
    }
  }

  // ─── Assign to client ──────────────────────────────────────
  openAssign(lead: Lead, event?: Event): void {
    event?.stopPropagation();
    this.error.set(null);
    this.clientSearch.set('');
    this.chosenClientId.set(lead.suggestedClientId ?? '');
    this.assignLead.set(lead);
  }

  async confirmAssign(): Promise<void> {
    const lead = this.assignLead();
    const clientId = this.chosenClientId();
    if (!lead || !clientId) return;

    this.error.set(null);
    this.busyId.set(lead.id);
    try {
      const updated = await this.leadService.assignLead(lead.id, clientId);
      this.leads.update((rows) => rows.map((l) => (l.id === lead.id ? updated : l)));
      this.assignLead.set(null);
      this.notice.set(`${lead.customerName} assigned.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not assign the lead.');
    } finally {
      this.busyId.set(null);
    }
  }

  // ─── Assign external ──────────────────────────────────────
  openAssignExternal(lead: Lead, event?: Event): void {
    event?.stopPropagation();
    this.error.set(null);
    this.externalClientSearch.set('');
    this.chosenExternalClientId.set('');
    this.assignExternalLead.set(lead);
  }

  async confirmAssignExternal(): Promise<void> {
    const lead = this.assignExternalLead();
    const externalClientId = this.chosenExternalClientId();
    if (!lead || !externalClientId) return;

    this.error.set(null);
    this.busyId.set(lead.id);
    try {
      const updated = await this.leadService.assignLeadExternal(lead.id, externalClientId);
      this.leads.update((rows) => rows.map((l) => (l.id === lead.id ? updated : l)));
      this.assignExternalLead.set(null);
      this.notice.set(`${lead.customerName} assigned to external client.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not assign the lead.');
    } finally {
      this.busyId.set(null);
    }
  }

  /**
   * Records the client's accept decision on their behalf — same reasoning as the CPA/CPL
   * pages: the decision is often made over a phone call, so admin needs a way to record it
   * without waiting on the client's login.
   */
  async approveLead(lead: Lead, event?: Event): Promise<void> {
    event?.stopPropagation();
    this.error.set(null);
    this.busyId.set(lead.id);
    try {
      const updated = await this.leadService.approveLead(lead.id);
      this.leads.update((rows) => rows.map((l) => (l.id === lead.id ? updated : l)));
      if (this.detailLead()?.id === lead.id) this.detailLead.set(updated);
      this.notice.set(`${lead.customerName} approved on behalf of ${updated.client?.name ?? 'the client'}.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not approve this lead.');
    } finally {
      this.busyId.set(null);
    }
  }

  /** Reverts a mistaken PAID back to UNPAID — marking PAID only happens through the batch
   *  "Mark Paid" action below, which requires entering the PKR amount received. */
  async revertToUnpaid(lead: Lead, event: Event): Promise<void> {
    event.stopPropagation();
    this.error.set(null);
    this.busyId.set(lead.id);
    try {
      const updated = await this.leadService.markUnpaid(lead.id);
      this.leads.update((rows) => rows.map((l) => (l.id === lead.id ? updated : l)));
      if (this.detailLead()?.id === lead.id) this.detailLead.set(updated);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not update payment status.');
    } finally {
      this.busyId.set(null);
    }
  }

  openBatchModal(): void {
    if (this.selectedCount() === 0) return;
    this.error.set(null);
    this.batchPkrAmount = null;
    this.batchNote = '';
    this.batchModalOpen.set(true);
  }

  closeBatchModal(): void {
    this.batchModalOpen.set(false);
  }

  async confirmBatchMarkPaid(): Promise<void> {
    if (!this.batchPkrAmount || this.batchPkrAmount <= 0) {
      this.error.set('Enter the PKR amount received.');
      return;
    }

    this.error.set(null);
    this.batchSubmitting.set(true);
    try {
      const leadIds = [...this.selectedIds()];
      const { count } = await this.leadService.batchMarkPaid(leadIds, this.batchPkrAmount, this.batchNote.trim() || undefined);
      await this.refresh();
      this.clearSelection();
      this.batchModalOpen.set(false);
      this.notice.set(`Marked ${count} lead${count === 1 ? '' : 's'} paid — ${formatPkr(this.batchPkrAmount)} recorded.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not mark these leads paid.');
    } finally {
      this.batchSubmitting.set(false);
    }
  }

  /**
   * Opens the charge-back modal for an ACCEPTED + PAID lead — requires the PKR amount
   * clawed back and a reason, same reasoning as why marking a lead PAID requires the
   * batch modal above. Once charged back, re-assigning it happens on the separate
   * Charge Backs page (leadType-agnostic), same as CPA/CPL.
   */
  openChargeBack(lead: Lead, event?: Event): void {
    event?.stopPropagation();
    this.error.set(null);
    this.chargeBackPkrAmount = null;
    this.chargeBackReason = '';
    this.chargeBackLead.set(lead);
  }

  closeChargeBackModal(): void {
    this.chargeBackLead.set(null);
  }

  async confirmChargeBack(): Promise<void> {
    const lead = this.chargeBackLead();
    if (!lead) return;
    if (!this.chargeBackPkrAmount || this.chargeBackPkrAmount <= 0) {
      this.error.set('Enter the PKR amount charged back.');
      return;
    }
    if (!this.chargeBackReason.trim()) {
      this.error.set('A reason is required.');
      return;
    }

    this.error.set(null);
    this.chargeBackSubmitting.set(true);
    try {
      const updated = await this.leadService.chargeBackLead(lead.id, this.chargeBackPkrAmount, this.chargeBackReason.trim());
      this.leads.update((rows) => rows.map((l) => (l.id === lead.id ? updated : l)));
      if (this.detailLead()?.id === lead.id) this.detailLead.set(updated);
      this.chargeBackLead.set(null);
      this.notice.set(`${lead.customerName} marked charged back — ${formatPkr(this.chargeBackPkrAmount)} recorded.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not mark this lead charged back.');
    } finally {
      this.chargeBackSubmitting.set(false);
    }
  }
}
