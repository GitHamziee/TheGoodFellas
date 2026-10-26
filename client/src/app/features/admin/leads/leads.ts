import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideBanknote,
  LucideBanknoteX,
  LucideBuilding2,
  LucideCircleCheck,
  LucideCircleX,
  LucideFileText,
  LucideHeadset,
  LucideLayers,
  LucideSquarePen,
  LucideUndo2,
  LucideUserCheck,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { UserService } from '../../../core/services/user.service';
import { ExternalClientService } from '../../../core/services/external-client.service';
import { ExternalClient } from '../../../core/models/external-client.model';
import { Lead, LeadStatus } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import {
  APP_TIME_ZONE,
  formatDate,
  formatPhone,
  formatPkr,
  getAvatarTone,
  getInitials,
  pacificIsoDate,
  timeAgo,
} from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import {
  EmptyState,
  Pagination,
  PaymentBadge,
  SearchBox,
  SkeletonRows,
  StatusBadge,
  PageHero,
} from '../../../shared/ui/ui';
import { DayBar, rangeBounds, rangeLabel } from '../../../shared/ui/day-bar';
import { LeadQuickEdit } from '../../../shared/lead-quick-edit';
import { Select } from '../../../shared/ui/select';
import { CHARGE_BACK_REASON_OPTIONS } from '../../../core/lead-options';
import { LeadDetail } from '../../../shared/lead-detail';
import { RowMenu } from '../../../shared/ui/row-menu';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';
import { apiErrorMessage } from '../../../core/api';

const STATUS_FILTERS: { label: string; value: string }[] = [
  { label: 'All', value: '' },
  { label: 'New', value: 'NEW' },
  { label: 'Assigned', value: 'ASSIGNED' },
  { label: 'Approved', value: 'ACCEPTED' },
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
    PageHero,
    RowMenu,
    FormsModule,
    Modal,
    Select,
    LeadDetail,
    LeadQuickEdit,
    DayBar,
    StatusBadge,
    PaymentBadge,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideCircleCheck,
    LucideCircleX,
    LucideBanknote,
    LucideBanknoteX,
    LucideFileText,
    LucideUndo2,
    LucideBuilding2,
    LucideUserCheck,
    LucideHeadset,
    LucideLayers,
    LucideSquarePen,
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

  /** Which lead each queue-style modal is acting on — only one is ever open at a time. */
  readonly assignLead = signal<Lead | null>(null);
  readonly assignExternalLead = signal<Lead | null>(null);
  readonly returnLead = signal<Lead | null>(null);
  readonly editLead = signal<Lead | null>(null);

  /** Day shown in the log below — Pacific yyyy-MM-dd, '' for every day. Starts on today. */
  readonly day = signal(pacificIsoDate());
  /** End of a date range (inclusive); '' means just `day`. */
  readonly dayTo = signal('');

  readonly clientSearch = signal('');
  readonly chosenClientId = signal('');
  readonly externalClientSearch = signal('');
  readonly chosenExternalClientId = signal('');

  /** Who to send the lead back to, and what they need to fix. */
  readonly returnTarget = signal<'JUNIOR_CLOSER' | 'CLOSER' | 'RETENTION' | null>('CLOSER');
  readonly returnReason = signal('');

  readonly statusFilters = STATUS_FILTERS;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly formatPhone = formatPhone;
  readonly formatPkr = formatPkr;
  readonly timeAgo = timeAgo;
  readonly formatDate = formatDate;

  /** Leads picked for the batch "Mark Paid" action, keyed by id across pages/filters. */
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly batchModalOpen = signal(false);
  readonly batchSubmitting = signal(false);
  batchPkrAmount: number | null = null;
  batchNote = '';

  /** Admin approve/decline on the client's behalf — Approve is immediate, Reject opens a modal for an optional reason. */
  readonly rejectModalOpen = signal(false);
  readonly decisionSubmitting = signal(false);
  rejectReason = '';

  /** Lead being charged back — single-record action, mirrors the batch "Mark Paid" modal. */
  readonly chargeBackModalOpen = signal(false);
  readonly chargeBackSubmitting = signal(false);
  chargeBackPkrAmount: number | null = null;
  chargeBackReasonChoice = '';
  chargeBackReasonNote = '';
  readonly chargeBackReasonOptions = CHARGE_BACK_REASON_OPTIONS;

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
   * leads stay on their own page. Retention leads only show once a retention person has
   * worked them — imported/unworked ones (NEW, DRAFT) live on Retention Imports. */
  private readonly cpaLeads = computed(() =>
    this.leads().filter(
      (l) => l.leadType === 'CPA' || (l.leadType === 'RETENTION' && l.status !== 'NEW' && l.status !== 'DRAFT'),
    ),
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

  /** Waiting on the admin: freshly submitted or bounced back by a client. These sit on top
   * whatever day they came in. */
  isPending(lead: Lead): boolean {
    return lead.status === 'SUBMITTED' || lead.status === 'REJECTED';
  }

  private readonly searchFields = (l: Lead) => [
    l.customerName,
    l.phone,
    l.state,
    l.closer?.name,
    l.client?.name,
    l.externalClient?.name,
    l.juniorCloser?.name,
    l.retention?.name,
  ];

  /** The "needs your action" list — search applies, day and status pills don't. Oldest first — the longest-waiting leads lead the list. */
  readonly pendingNewestFirst = signal(true);

  readonly pendingLeads = computed(() => {
    const term = this.view.search().trim().toLowerCase();
    const dir = this.pendingNewestFirst() ? -1 : 1;
    return this.byCloser()
      .filter((l) => this.isPending(l))
      .filter((l) => !term || this.searchFields(l).some((f) => f != null && String(f).toLowerCase().includes(term)))
      .sort((a, b) => dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
  });

  /** Everything the admin has already dealt with — the day-by-day log. */
  private readonly logged = computed(() => this.byCloser().filter((l) => !this.isPending(l)));

  /** Searching looks across every day, so a customer is findable without knowing when they came in. */
  readonly dayMode = computed(() => !!this.day() && !this.view.search().trim());

  /** One calendar day (not a range) — the log shows times instead of dates. */
  readonly singleDay = computed(() => this.dayMode() && !this.dayTo());

  private readonly byDay = computed(() => {
    const rows = this.logged();
    if (!this.dayMode()) return rows;
    const [from, to] = rangeBounds(this.day(), this.dayTo());
    return rows.filter((l) => {
      const t = new Date(l.updatedAt ?? l.createdAt).getTime();
      return t >= from && t < to;
    });
  });

  readonly loggedTotal = computed(() => this.logged().length);

  /** Lead count per Pacific day, for the day tabs. */
  readonly dayCounts = computed(() => {
    const counts: Record<string, number> = {};
    for (const l of this.logged()) {
      const iso = pacificIsoDate(l.updatedAt ?? l.createdAt);
      counts[iso] = (counts[iso] ?? 0) + 1;
    }
    return counts;
  });

  readonly view = createListView<Lead>({
    source: this.byDay,
    searchFields: this.searchFields,
    statusOf: (l) => l.status,
    sorters: {
      customerName: (l) => l.customerName,
      status: (l) => l.status,
      createdAt: (l) => new Date(l.createdAt).getTime(),
      updatedAt: (l) => new Date(l.updatedAt ?? l.createdAt).getTime(),
    },
    initialSort: { key: 'updatedAt', dir: 'desc' },
    pageSize: 15,
  });

  readonly summary = computed(() => {
    const rows = this.byDay();
    const count = (s: LeadStatus) => rows.filter((l) => l.status === s).length;
    const accepted = rows.filter((l) => l.status === 'ACCEPTED');
    return {
      total: rows.length,
      withClients: count('ASSIGNED') + count('ASSIGNED_EXTERNAL'),
      accepted: accepted.length,
      unpaid: rows.filter((l) => this.isEligibleForBatchPaid(l)).length,
      chargedBack: count('CHARGED_BACK'),
    };
  });

  /** Count per status pill, so the filter row doubles as a breakdown. */

  /** Hero headline: the day being viewed, so it never repeats the topbar's page title. */
  readonly heroTitle = computed(() => {
    const iso = this.day();
    if (!iso) return 'Every day, all in one place';
    if (this.dayTo()) return rangeLabel(iso, this.dayTo());
    const [y, m, d] = iso.split('-').map(Number);
    const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
    });
    return iso === pacificIsoDate() ? `Today · ${label}` : label;
  });

  readonly heroSub = computed(() => {
    const s = this.summary();
    if (s.total === 0) return this.dayMode() ? (this.dayTo() ? 'Nothing logged in this range yet.' : 'Nothing logged for this day yet.') : 'Nothing logged yet.';
    return [`${s.accepted} approved`, `${s.withClients} with clients`, `${s.unpaid} unpaid`, s.chargedBack ? `${s.chargedBack} charged back` : '']
      .filter(Boolean)
      .join(' · ');
  });


  /** Pending list is capped so the day log stays near the top; "Show all" expands it. */
  readonly showAllPending = signal(false);
  readonly visiblePending = computed(() => (this.showAllPending() ? this.pendingLeads() : this.pendingLeads().slice(0, 5)));

  /** Whole days a lead has been waiting on the admin. */
  waitDays(lead: Lead): number {
    return Math.max(0, Math.floor((Date.now() - new Date(lead.createdAt).getTime()) / 86_400_000));
  }

  waitLabel(lead: Lead): string {
    const d = this.waitDays(lead);
    return d === 0 ? 'Today' : `${d}d`;
  }

  /** Set after a successful assignment so the admin sees the assigned lead (with its copy action). */
  readonly assignedLead = signal<{ lead: Lead; to: string } | null>(null);


  readonly statusCounts = computed(() => {
    const rows = this.byDay();
    const counts: Record<string, number> = { '': rows.length };
    for (const filter of STATUS_FILTERS) counts[filter.value] = 0;
    counts[''] = rows.length;
    for (const lead of rows) counts[lead.status] = (counts[lead.status] ?? 0) + 1;
    return counts;
  });

  /** Status dropdown — one select instead of a row of pills; counts ride along in the label. */
  readonly statusOptions = computed(() => {
    const counts = this.statusCounts();
    const current = this.view.status();
    return STATUS_FILTERS.filter((f) => !f.value || counts[f.value] > 0 || current === f.value).map((f) => ({
      value: f.value,
      label: f.value ? `${f.label} (${counts[f.value]})` : `All statuses (${counts['']})`,
    }));
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

  /** Awaiting a response from a client (login account or external) — admin can decide for them. */
  isEligibleForDecision(lead: Lead): boolean {
    return lead.status === 'ASSIGNED' || lead.status === 'ASSIGNED_EXTERNAL';
  }

  /** A row is selectable if any batch action (Approve / Reject / Mark Paid / Charge Back) applies to it. */
  isSelectable(lead: Lead): boolean {
    return this.isEligibleForDecision(lead) || this.isEligibleForBatchPaid(lead) || this.isEligibleForBatchChargeBack(lead);
  }

  private selectedLeads(): Lead[] {
    const ids = this.selectedIds();
    return this.leads().filter((l) => ids.has(l.id));
  }

  readonly decidableSelectedCount = computed(() => this.selectedLeads().filter((l) => this.isEligibleForDecision(l)).length);
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
    const [clients, externalClients] = await Promise.all([
      this.userService.listClients(),
      this.externalClientService.list(),
      this.refresh(),
    ]);
    this.clients.set(clients);
    this.externalClients.set(externalClients);
  }

  setSourceFilter(value: string): void {
    this.sourceFilter.set(value);
    this.view.page.set(1);
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
      this.assignedLead.set({ lead: updated, to: updated.client?.name ?? 'client' });
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not assign the lead.'));
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
      this.assignedLead.set({ lead: updated, to: updated.externalClient?.name ?? 'external client' });
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not assign the lead.'));
    } finally {
      this.busyId.set(null);
    }
  }

  // ─── Send back for correction ──────────────────────────────
  openReturn(lead: Lead, event?: Event): void {
    event?.stopPropagation();
    this.error.set(null);
    // Default to whichever party actually exists on the lead.
    this.returnTarget.set(
      lead.closer ? 'CLOSER' : lead.juniorCloser ? 'JUNIOR_CLOSER' : lead.retention ? 'RETENTION' : null,
    );
    this.returnReason.set('');
    this.returnLead.set(lead);
  }

  async confirmReturn(): Promise<void> {
    const lead = this.returnLead();
    const reason = this.returnReason().trim();
    const target = this.returnTarget();
    if (!lead || !reason || !target) return;

    this.error.set(null);
    this.busyId.set(lead.id);
    try {
      const updated = await this.leadService.returnLead(lead.id, target, reason);
      this.leads.update((rows) => rows.map((l) => (l.id === lead.id ? updated : l)));
      if (this.selected()?.id === lead.id) this.selected.set(updated);
      this.returnLead.set(null);
      const who =
        target === 'JUNIOR_CLOSER' ? lead.juniorCloser?.name
        : target === 'CLOSER' ? lead.closer?.name
        : lead.retention?.name;
      this.notice.set(`${lead.customerName} sent back to ${who ?? 'the team'} to fix.`);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not send the lead back.'));
    } finally {
      this.busyId.set(null);
    }
  }

  // ─── Edit (rejected leads only) ────────────────────────────
  openEdit(lead: Lead, event?: Event): void {
    event?.stopPropagation();
    this.error.set(null);
    this.editLead.set(lead);
  }

  onEdited(updated: Lead): void {
    this.leads.update((rows) => rows.map((l) => (l.id === updated.id ? updated : l)));
    this.editLead.set(null);
    this.notice.set(`Saved changes to ${updated.customerName}.`);
  }

  /** Time of day in Pacific — what the day log shows in place of a date. */
  timeOf(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString('en-US', { timeZone: APP_TIME_ZONE, hour: 'numeric', minute: '2-digit' });
  }

  setCloserFilter(value: string): void {
    this.closerFilter.set(value);
    this.view.page.set(1);
  }

  /**
   * Records the client's approve/decline decision on their behalf for the selected leads — the
   * normal path is the client logging in themselves (and external clients have no login at
   * all), but the decision is often made over a phone call, so admin records it here. Same
   * select-then-act flow as Mark Paid / Charge Back. Reject asks for an optional reason first.
   */
  async batchAccept(): Promise<void> {
    if (this.decidableSelectedCount() === 0) return;
    this.error.set(null);
    this.decisionSubmitting.set(true);
    try {
      const leadIds = this.selectedLeads().filter((l) => this.isEligibleForDecision(l)).map((l) => l.id);
      const { count } = await this.leadService.batchDecide(leadIds, 'ACCEPT');
      await this.refresh();
      this.clearSelection();
      this.notice.set(`Approved ${count} lead${count === 1 ? '' : 's'} on the client's behalf.`);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not approve these leads.'));
    } finally {
      this.decisionSubmitting.set(false);
    }
  }

  openRejectModal(): void {
    if (this.decidableSelectedCount() === 0) return;
    this.error.set(null);
    this.rejectReason = '';
    this.rejectModalOpen.set(true);
  }

  closeRejectModal(): void {
    this.rejectModalOpen.set(false);
  }

  async confirmBatchReject(): Promise<void> {
    this.error.set(null);
    this.decisionSubmitting.set(true);
    try {
      const leadIds = this.selectedLeads().filter((l) => this.isEligibleForDecision(l)).map((l) => l.id);
      const { count } = await this.leadService.batchDecide(leadIds, 'REJECT', this.rejectReason.trim() || undefined);
      await this.refresh();
      this.clearSelection();
      this.rejectModalOpen.set(false);
      this.notice.set(`Declined ${count} lead${count === 1 ? '' : 's'} — back in the queue for reassignment.`);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not decline these leads.'));
    } finally {
      this.decisionSubmitting.set(false);
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
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not update payment status.'));
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
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not mark these leads paid.'));
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
    this.chargeBackReasonChoice = '';
    this.chargeBackReasonNote = '';
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
    const reason = this.chargeBackReasonChoice === 'OTHER' ? this.chargeBackReasonNote.trim() : this.chargeBackReasonChoice;
    if (!reason) {
      this.error.set(this.chargeBackReasonChoice === 'OTHER' ? 'Type the reason for the charge-back.' : 'Pick a reason for the charge-back.');
      return;
    }

    this.error.set(null);
    this.chargeBackSubmitting.set(true);
    try {
      const leadIds = this.selectedLeads().filter((l) => this.isEligibleForBatchChargeBack(l)).map((l) => l.id);
      const { count } = await this.leadService.batchChargeBack(leadIds, this.chargeBackPkrAmount, reason);
      const amount = this.chargeBackPkrAmount;
      await this.refresh();
      this.clearSelection();
      this.chargeBackModalOpen.set(false);
      this.notice.set(`Charged back ${count} lead${count === 1 ? '' : 's'} — ${formatPkr(amount)} recorded.`);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not charge back these leads.'));
    } finally {
      this.chargeBackSubmitting.set(false);
    }
  }
}
