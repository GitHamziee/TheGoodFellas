import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideBanknote,
  LucideBuilding2,
  LucideCircleCheck,
  LucideCircleX,
  LucideSquarePen,
  LucideTag,
  LucideUndo2,
  LucideUserCheck,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { UserService } from '../../../core/services/user.service';
import { ExternalClientService } from '../../../core/services/external-client.service';
import { ExternalClient } from '../../../core/models/external-client.model';
import { Lead } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import { D_CODE_OPTIONS } from '../../../core/lead-options';
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
import { Select } from '../../../shared/ui/select';
import {
  EmptyState,
  Pagination,
  PaymentBadge,
  SearchBox,
  SkeletonRows,
  StatusBadge,
  PageHero,
} from '../../../shared/ui/ui';
import { LeadDetail } from '../../../shared/lead-detail';
import { RowMenu } from '../../../shared/ui/row-menu';
import { AdminStatusControl } from '../../../shared/ui/admin-status';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';
import { DayBar, rangeBounds, rangeLabel } from '../../../shared/ui/day-bar';
import { LeadQuickEdit } from '../../../shared/lead-quick-edit';
import { MONEY_STATUSES, TRACKABLE_STATUSES } from '../../../core/lead-options';
import { apiErrorMessage } from '../../../core/api';

interface LookupUser {
  id: string;
  name: string;
  email: string;
}

const STATUS_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Assigned', value: 'ASSIGNED' },
  { label: 'Approved', value: 'ACCEPTED' },
  { label: 'Assigned (External)', value: 'ASSIGNED_EXTERNAL' },
];

@Component({
  selector: 'app-admin-cpl-leads',
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
    AdminStatusControl,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideBuilding2,
    LucideCircleCheck,
    LucideCircleX,
    LucideUserCheck,
    LucideUndo2,
    LucideSquarePen,
    LucideTag,
    LucideBanknote,
  ],
  templateUrl: './cpl-leads.html',
})
export class AdminCplLeads implements OnInit {
  protected readonly MONEY_STATUSES = MONEY_STATUSES;
  protected readonly TRACKABLE_STATUSES = TRACKABLE_STATUSES;
  private readonly liveReload = reloadOnChange(() => this.refresh());
  private readonly leadService = inject(LeadService);
  private readonly userService = inject(UserService);
  private readonly externalClientService = inject(ExternalClientService);

  readonly leads = signal<Lead[]>([]);
  readonly externalClients = signal<ExternalClient[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);

  /** Which lead each modal is acting on — only one is ever open at a time. */
  readonly detailLead = signal<Lead | null>(null);
  readonly assignLead = signal<Lead | null>(null);
  readonly assignExternalLead = signal<Lead | null>(null);
  readonly returnLead = signal<Lead | null>(null);
  readonly editLead = signal<Lead | null>(null);

  readonly clientSearch = signal('');
  readonly chosenClientId = signal('');
  readonly externalClientSearch = signal('');
  readonly chosenExternalClientId = signal('');
  readonly returnReason = signal('');

  readonly clients = signal<LookupUser[]>([]);

  readonly statusFilters = STATUS_FILTERS;
  readonly dCodeOptions = [{ value: '', label: 'All D-codes' }, ...D_CODE_OPTIONS];

  readonly dCodeFilter = signal('');
  readonly juniorFilter = signal('');
  /** Day shown in the log below — Pacific yyyy-MM-dd, '' for every day. Starts on today. */
  readonly day = signal(pacificIsoDate());
  /** End of a date range (inclusive); '' means just `day`. */
  readonly dayTo = signal('');

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

  /** Junior Closers who actually appear on a CPL lead — drives the "filter by junior" dropdown. */
  readonly juniorClosers = computed(() => {
    const seen = new Map<string, string>();
    for (const lead of this.leads()) {
      if (lead.juniorCloser) seen.set(lead.juniorCloser.id, lead.juniorCloser.name);
    }
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });

  readonly juniorOptions = computed(() => [
    { value: '', label: 'All Junior Closers' },
    ...this.juniorClosers().map((j) => ({ value: j.id, label: j.name })),
  ]);

  private readonly byFilters = computed(() => {
    let rows = this.leads();
    const dCode = this.dCodeFilter();
    const junior = this.juniorFilter();
    if (dCode) rows = rows.filter((l) => l.dCode === dCode);
    if (junior) rows = rows.filter((l) => l.juniorCloser?.id === junior);
    return rows;
  });

  /** Waiting on the admin — sits on top whatever day it came in. */
  isPending(lead: Lead): boolean {
    return lead.status === 'SUBMITTED';
  }

  /** A client declined it — kept out of the queue and the log, behind the "Rejected CPLs" toggle. */
  isRejected(lead: Lead): boolean {
    return lead.status === 'REJECTED';
  }

  readonly showRejected = signal(false);

  readonly rejectedLeads = computed(() => {
    const term = this.view.search().trim().toLowerCase();
    return this.byFilters()
      .filter((l) => this.isRejected(l))
      .filter((l) => !term || this.searchFields(l).some((f) => f != null && String(f).toLowerCase().includes(term)))
      .sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime());
  });

  /** Unfiltered count for the toggle badge, so it doesn't change with search. */
  readonly rejectedCount = computed(() => this.byFilters().filter((l) => this.isRejected(l)).length);

  private readonly searchFields = (l: Lead) => [l.customerName, l.phone, l.state, l.juniorCloser?.name];

  /** The "needs your action" list — search applies, day and status pills don't. Oldest first — the longest-waiting leads lead the list. */
  readonly pendingNewestFirst = signal(true);

  readonly pendingLeads = computed(() => {
    const term = this.view.search().trim().toLowerCase();
    const dir = this.pendingNewestFirst() ? -1 : 1;
    return this.byFilters()
      .filter((l) => this.isPending(l))
      .filter((l) => !term || this.searchFields(l).some((f) => f != null && String(f).toLowerCase().includes(term)))
      .sort((a, b) => dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
  });

  /** Everything the admin has already dealt with — the day-by-day log. */
  private readonly logged = computed(() => this.byFilters().filter((l) => !this.isPending(l) && !this.isRejected(l)));
  readonly loggedTotal = computed(() => this.logged().length);

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
      createdAt: (l) => new Date(l.createdAt).getTime(),
      updatedAt: (l) => new Date(l.updatedAt ?? l.createdAt).getTime(),
    },
    initialSort: { key: 'updatedAt', dir: 'desc' },
    pageSize: 15,
  });

  /** One-line recap of whatever the table is currently showing. */
  readonly summary = computed(() => {
    const rows = this.byDay();
    return {
      total: rows.length,
      withClients: rows.filter((l) => l.status === 'ASSIGNED' || l.status === 'ASSIGNED_EXTERNAL').length,
      accepted: rows.filter((l) => l.status === 'ACCEPTED').length,
      unpaid: rows.filter((l) => this.isEligibleForBatchPaid(l)).length,
    };
  });


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
    return `${s.accepted} approved · ${s.withClients} with clients · ${s.unpaid} unpaid`;
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
    const counts: Record<string, number> = {};
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

  /** Only unpaid assigned leads can be batch-marked paid. */
  isEligibleForBatchPaid(lead: Lead): boolean {
    return lead.paymentStatus === 'UNPAID' && MONEY_STATUSES.includes(lead.status);
  }

  /** A row is selectable if any batch action (Mark Paid) applies to it. */
  isSelectable(lead: Lead): boolean {
    return this.isEligibleForBatchPaid(lead);
  }

  private selectedLeads(): Lead[] {
    const ids = this.selectedIds();
    return this.leads().filter((l) => ids.has(l.id));
  }

  readonly payableSelectedCount = computed(() => this.selectedLeads().filter((l) => this.isEligibleForBatchPaid(l)).length);

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

  /** Detail-popup shortcut: narrows the selection to this one lead and runs the same batch flow. */
  actOnLead(lead: Lead): void {
    this.detailLead.set(null);
    this.selectedIds.set(new Set([lead.id]));
    this.openBatchModal();
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

  async refresh(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      this.leads.set(await this.leadService.cplLeads());
    } catch {
      this.error.set('Could not load CPL leads. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }

  clearCplFilters(): void {
    this.dCodeFilter.set('');
    this.juniorFilter.set('');
    this.view.page.set(1);
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

  // ─── Assign ────────────────────────────────────────────────
  openAssign(lead: Lead, event?: Event): void {
    event?.stopPropagation();
    this.error.set(null);
    this.clientSearch.set('');
    this.chosenClientId.set('');
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
      this.assignExternalLead.set(null);
      this.assignedLead.set({ lead: updated, to: updated.externalClient?.name ?? 'external client' });
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not assign the lead.'));
    } finally {
      this.busyId.set(null);
    }
  }

  // ─── Send back to Junior — CPL has no Closer, so there's only ever one target ──
  openReturn(lead: Lead, event?: Event): void {
    event?.stopPropagation();
    this.error.set(null);
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
      const updated = await this.leadService.returnLead(lead.id, 'JUNIOR_CLOSER', reason);
      this.leads.update((rows) => rows.map((l) => (l.id === lead.id ? updated : l)));
      this.returnLead.set(null);
      this.notice.set(`${lead.customerName} sent back to ${lead.juniorCloser?.name ?? 'the junior closer'} to fix.`);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not send the lead back.'));
    } finally {
      this.busyId.set(null);
    }
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
      this.leads.update((rows) => rows.map((l) => (l.id === lead.id ? updated : l)));
      if (this.detailLead()?.id === lead.id) this.detailLead.set(updated);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not update payment status.'));
    } finally {
      this.busyId.set(null);
    }
  }

  onAdminStatusChanged(updated: Lead): void {
    this.leads.update((rows) => rows.map((l) => (l.id === updated.id ? updated : l)));
    if (this.detailLead()?.id === updated.id) this.detailLead.set(updated);
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
}
