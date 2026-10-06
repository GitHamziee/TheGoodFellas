import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideBanknote,
  LucideBanknoteX,
  LucideBuilding2,
  LucideCircleCheck,
  LucideCircleX,
  LucideClock,
  LucideFileText,
  LucideHeadset,
  LucideInbox,
  LucideLayers,
  LucideSend,
  LucideUndo2,
  LucideUserCheck,
  LucideWallet,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { UserService } from '../../../core/services/user.service';
import { ExternalClientService } from '../../../core/services/external-client.service';
import { ExternalClient } from '../../../core/models/external-client.model';
import { Lead, LeadStatus } from '../../../core/models/lead.model';
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
import { Select } from '../../../shared/ui/select';
import { LeadDetail } from '../../../shared/lead-detail';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';

const STATUS_FILTERS: { label: string; value: string }[] = [
  { label: 'All', value: '' },
  { label: 'New', value: 'NEW' },
  { label: 'Submitted', value: 'SUBMITTED' },
  { label: 'Assigned', value: 'ASSIGNED' },
  { label: 'Accepted', value: 'ACCEPTED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Sent back', value: 'RETURNED_TO_RETENTION' },
  { label: 'Assigned (External)', value: 'ASSIGNED_EXTERNAL' },
  { label: 'Charged Back', value: 'CHARGED_BACK' },
];

interface LookupUser {
  id: string;
  name: string;
  email: string;
}

@Component({
  selector: 'app-admin-leads',
  imports: [
    FormsModule,
    Modal,
    Select,
    LeadDetail,
    StatTile,
    StatusBadge,
    PaymentBadge,
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
    LucideBanknoteX,
    LucideClock,
    LucideFileText,
    LucideUndo2,
    LucideBuilding2,
    LucideUserCheck,
    LucideHeadset,
  ],
  templateUrl: './leads.html',
})
export class AdminLeads implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.refresh());
  private readonly leadService = inject(LeadService);
  private readonly userService = inject(UserService);
  private readonly externalClientService = inject(ExternalClientService);

  readonly leads = signal<Lead[]>([]);
  readonly clients = signal<LookupUser[]>([]);
  readonly externalClients = signal<ExternalClient[]>([]);
  readonly loading = signal(true);
  readonly busyId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly selected = signal<Lead | null>(null);
  readonly closerFilter = signal('');
  readonly sourceFilter = signal('');
  readonly retentionPeople = signal<LookupUser[]>([]);
  readonly assignRetentionLead = signal<Lead | null>(null);
  readonly retentionSearch = signal('');
  readonly chosenRetentionId = signal('');

  /** Which lead each queue-style modal is acting on — only one is ever open at a time. */
  readonly assignLead = signal<Lead | null>(null);
  readonly assignExternalLead = signal<Lead | null>(null);
  readonly returnLead = signal<Lead | null>(null);

  readonly clientSearch = signal('');
  readonly chosenClientId = signal('');
  readonly externalClientSearch = signal('');
  readonly chosenExternalClientId = signal('');

  /** Who to send the lead back to, and what they need to fix. */
  readonly returnTarget = signal<'JUNIOR_CLOSER' | 'CLOSER'>('CLOSER');
  readonly returnReason = signal('');

  readonly statusFilters = STATUS_FILTERS;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly formatPhone = formatPhone;
  readonly formatPkr = formatPkr;
  readonly timeAgo = timeAgo;

  /** Leads picked for the batch "Mark Paid" action, keyed by id across pages/filters. */
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly batchModalOpen = signal(false);
  readonly batchSubmitting = signal(false);
  batchPkrAmount: number | null = null;
  batchNote = '';

  /** Lead being charged back — single-record action, mirrors the batch "Mark Paid" modal. */
  readonly chargeBackModalOpen = signal(false);
  readonly chargeBackSubmitting = signal(false);
  chargeBackPkrAmount: number | null = null;
  chargeBackReason = '';

  /** Closers that actually appear on a lead — drives the "filter by closer" dropdown. */
  readonly closers = computed(() => {
    const seen = new Map<string, string>();
    for (const lead of this.cpaLeads()) {
      if (lead.closer) seen.set(lead.closer.id, lead.closer.name);
    }
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });

  readonly closerOptions = computed(() => [
    { value: '', label: 'All closers' },
    ...this.closers().map((c) => ({ value: c.id, label: c.name })),
  ]);

  /** CPA and Retention leads share this page (same admin actions, same payment flow). CPL
   * leads stay on their own page. */
  private readonly cpaLeads = computed(() =>
    this.leads().filter((l) => l.leadType === 'CPA' || l.leadType === 'RETENTION'),
  );

  readonly sourceOptions = [
    { value: '', label: 'All sources' },
    { value: 'CPA', label: 'CPA' },
    { value: 'RETENTION', label: 'Retention' },
  ];

  private readonly byCloser = computed(() => {
    const closerId = this.closerFilter();
    const source = this.sourceFilter();
    let rows = this.cpaLeads();
    if (source) rows = rows.filter((l) => l.leadType === source);
    return closerId ? rows.filter((l) => l.closer?.id === closerId) : rows;
  });

  readonly view = createListView<Lead>({
    source: this.byCloser,
    searchFields: (l) => [l.customerName, l.phone, l.state, l.closer?.name, l.client?.name, l.externalClient?.name, l.juniorCloser?.name, l.retention?.name],
    statusOf: (l) => l.status,
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
    const rows = this.cpaLeads();
    const count = (s: LeadStatus) => rows.filter((l) => l.status === s).length;
    const accepted = rows.filter((l) => l.status === 'ACCEPTED');
    return {
      total: rows.length,
      submitted: count('SUBMITTED'),
      assigned: count('ASSIGNED'),
      accepted: accepted.length,
      rejected: count('REJECTED'),
      assignedExternal: count('ASSIGNED_EXTERNAL'),
      chargedBack: count('CHARGED_BACK'),
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
    for (const lead of rows) counts[lead.status] = (counts[lead.status] ?? 0) + 1;
    return counts;
  });

  /** Retention-staff dropdown, narrowed by the search box inside the assign-retention modal. */
  readonly filteredRetentionPeople = computed(() => {
    const term = this.retentionSearch().trim().toLowerCase();
    if (!term) return this.retentionPeople();
    return this.retentionPeople().filter(
      (p) => p.name.toLowerCase().includes(term) || p.email.toLowerCase().includes(term),
    );
  });

  readonly selectedCount = computed(() => this.selectedIds().size);

  /** Only unpaid ACCEPTED/ASSIGNED_EXTERNAL leads can be batch-marked paid. */
  isEligibleForBatchPaid(lead: Lead): boolean {
    return lead.paymentStatus === 'UNPAID' && (lead.status === 'ACCEPTED' || lead.status === 'ASSIGNED_EXTERNAL');
  }

  /** Only ACCEPTED + PAID leads can be batch-charged back. */
  isEligibleForBatchChargeBack(lead: Lead): boolean {
    return lead.paymentStatus === 'PAID' && lead.status === 'ACCEPTED';
  }

  /** A row is selectable if either batch action (Mark Paid / Charge Back) applies to it. */
  isSelectable(lead: Lead): boolean {
    return this.isEligibleForBatchPaid(lead) || this.isEligibleForBatchChargeBack(lead);
  }

  private selectedLeads(): Lead[] {
    const ids = this.selectedIds();
    return this.leads().filter((l) => ids.has(l.id));
  }

  readonly payableSelectedCount = computed(() => this.selectedLeads().filter((l) => this.isEligibleForBatchPaid(l)).length);
  readonly chargeableSelectedCount = computed(
    () => this.selectedLeads().filter((l) => this.isEligibleForBatchChargeBack(l)).length,
  );

  isSelected(lead: Lead): boolean {
    return this.selectedIds().has(lead.id);
  }

  toggleSelect(lead: Lead, event: Event): void {
    event.stopPropagation();
    if (!this.isSelectable(lead)) return;
    this.selectedIds.update((ids) => {
      const next = new Set(ids);
      if (next.has(lead.id)) next.delete(lead.id);
      else next.add(lead.id);
      return next;
    });
  }

  /** Header checkbox — true only when every eligible row on the current page is selected. */
  readonly allVisibleEligibleSelected = computed(() => {
    const eligible = this.view.rows().filter((l) => this.isSelectable(l));
    return eligible.length > 0 && eligible.every((l) => this.selectedIds().has(l.id));
  });

  toggleSelectAllVisible(): void {
    const eligible = this.view.rows().filter((l) => this.isSelectable(l));
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

  setSourceFilter(value: string): void {
    this.sourceFilter.set(value);
    this.view.page.set(1);
  }

  // ─── Assign to retention person (unworked retention leads only) ──
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
      if (this.selected()?.id === lead.id) this.selected.set(updated);
      this.assignRetentionLead.set(null);
      this.notice.set(`${lead.customerName} assigned to ${updated.retention?.name ?? 'retention'}.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not assign the lead.');
    } finally {
      this.busyId.set(null);
    }
  }

  async refresh(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      this.leads.set(await this.leadService.allLeads());
    } catch {
      this.error.set('Could not load leads. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  // ─── Assign ────────────────────────────────────────────────
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
      if (this.selected()?.id === lead.id) this.selected.set(updated);
      this.assignLead.set(null);
      this.notice.set(`${lead.customerName} assigned to ${updated.client?.name ?? 'client'}.`);
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
      if (this.selected()?.id === lead.id) this.selected.set(updated);
      this.assignExternalLead.set(null);
      this.notice.set(`${lead.customerName} assigned to ${updated.externalClient?.name ?? 'external client'}.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not assign the lead.');
    } finally {
      this.busyId.set(null);
    }
  }

  // ─── Send back for correction ──────────────────────────────
  openReturn(lead: Lead, event?: Event): void {
    event?.stopPropagation();
    this.error.set(null);
    this.returnTarget.set('CLOSER');
    this.returnReason.set('');
    this.returnLead.set(lead);
  }

  async confirmReturn(): Promise<void> {
    const lead = this.returnLead();
    const reason = this.returnReason().trim();
    if (!lead || !reason) return;

    this.error.set(null);
    this.busyId.set(lead.id);
    try {
      const updated = await this.leadService.returnLead(lead.id, this.returnTarget(), reason);
      this.leads.update((rows) => rows.map((l) => (l.id === lead.id ? updated : l)));
      if (this.selected()?.id === lead.id) this.selected.set(updated);
      this.returnLead.set(null);
      const who = this.returnTarget() === 'JUNIOR_CLOSER' ? lead.juniorCloser?.name : lead.closer?.name;
      this.notice.set(`${lead.customerName} sent back to ${who ?? 'the team'} to fix.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not send the lead back.');
    } finally {
      this.busyId.set(null);
    }
  }

  setCloserFilter(value: string): void {
    this.closerFilter.set(value);
    this.view.page.set(1);
  }

  /**
   * Records the client's accept decision on their behalf — the normal path is the client
   * logging in and accepting it themselves, but that decision is often made over a phone
   * call in practice, so admin needs a way to record it without waiting on the client's login.
   */
  async approveLead(lead: Lead, event?: Event): Promise<void> {
    event?.stopPropagation();
    this.error.set(null);
    this.busyId.set(lead.id);
    try {
      const updated = await this.leadService.approveLead(lead.id);
      this.leads.update((rows) => rows.map((l) => (l.id === lead.id ? updated : l)));
      if (this.selected()?.id === lead.id) this.selected.set(updated);
      this.notice.set(`${lead.customerName} approved on behalf of ${updated.client?.name ?? 'the client'}.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not approve this lead.');
    } finally {
      this.busyId.set(null);
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }

  /**
   * Reverts a mistaken PAID back to UNPAID. Marking a lead PAID is deliberately not
   * available as a quick toggle — it only happens through the batch "Mark Paid" action
   * below, which requires entering the PKR amount received, even for a single lead.
   */
  async revertToUnpaid(lead: Lead, event: Event): Promise<void> {
    event.stopPropagation();
    this.error.set(null);
    this.busyId.set(lead.id);
    try {
      const updated = await this.leadService.markUnpaid(lead.id);
      // Patch in place so the current page/filter/scroll position is preserved.
      this.leads.update((rows) => rows.map((l) => (l.id === lead.id ? updated : l)));
      if (this.selected()?.id === lead.id) this.selected.set(updated);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not update payment status.');
    } finally {
      this.busyId.set(null);
    }
  }

  openBatchModal(): void {
    if (this.payableSelectedCount() === 0) return;
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
      const leadIds = this.selectedLeads().filter((l) => this.isEligibleForBatchPaid(l)).map((l) => l.id);
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
   * Opens the batch charge-back modal for the selected ACCEPTED + PAID leads. Like Mark
   * Paid, it's a batch action that requires the PKR amount (one total for the batch) plus
   * a reason — never a quick toggle.
   */
  openChargeBackModal(): void {
    if (this.chargeableSelectedCount() === 0) return;
    this.error.set(null);
    this.chargeBackPkrAmount = null;
    this.chargeBackReason = '';
    this.chargeBackModalOpen.set(true);
  }

  closeChargeBackModal(): void {
    this.chargeBackModalOpen.set(false);
  }

  async confirmChargeBack(): Promise<void> {
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
      const leadIds = this.selectedLeads().filter((l) => this.isEligibleForBatchChargeBack(l)).map((l) => l.id);
      const { count } = await this.leadService.batchChargeBack(leadIds, this.chargeBackPkrAmount, this.chargeBackReason.trim());
      const amount = this.chargeBackPkrAmount;
      await this.refresh();
      this.clearSelection();
      this.chargeBackModalOpen.set(false);
      this.notice.set(`Charged back ${count} lead${count === 1 ? '' : 's'} — ${formatPkr(amount)} recorded.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not charge back these leads.');
    } finally {
      this.chargeBackSubmitting.set(false);
    }
  }
}
