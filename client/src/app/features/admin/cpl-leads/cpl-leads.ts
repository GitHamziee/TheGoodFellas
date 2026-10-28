import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideBanknote,
  LucideBuilding2,
  LucideCircleCheck,
  LucideFileText,
  LucideSquarePen,
  LucideUndo2,
  LucideUserCheck,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { UserService } from '../../../core/services/user.service';
import { ExternalClientService } from '../../../core/services/external-client.service';
import { ExternalClient } from '../../../core/models/external-client.model';
import { Lead } from '../../../core/models/lead.model';
import { highlightFromQuery } from '../../../core/highlight';
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
} from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import { Select } from '../../../shared/ui/select';
import {
  EmptyState,
  Pagination,
  SearchBox,
  SkeletonRows,
  StatusBadge,
} from '../../../shared/ui/ui';
import { LeadDetail } from '../../../shared/lead-detail';
import { RowMenu } from '../../../shared/ui/row-menu';
import { AdminStatusControl } from '../../../shared/ui/admin-status';
import { LifecycleButton } from '../../../shared/ui/lifecycle-button';
import { NotePeek } from '../../../shared/ui/lead-notes';
import { AuthService } from '../../../core/services/auth.service';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';
import { DayBar, rangeBounds, rangeLabel, shiftIsoDay } from '../../../shared/ui/day-bar';
import { LeadQuickEdit } from '../../../shared/lead-quick-edit';
import { MONEY_STATUSES, TRACKABLE_STATUSES } from '../../../core/lead-options';
import { apiErrorMessage } from '../../../core/api';
import { toastNotice } from '../../../core/toast-notice';

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
    RowMenu,
    FormsModule,
    Modal,
    Select,
    LeadDetail,
    LeadQuickEdit,
    DayBar,
    StatusBadge,
    AdminStatusControl,
    LifecycleButton,
    NotePeek,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideBuilding2,
    LucideCircleCheck,
    LucideUserCheck,
    LucideUndo2,
    LucideSquarePen,
    LucideFileText,
    LucideBanknote,
  ],
  templateUrl: './cpl-leads.html',
  // Same layout as CPA & Retention Leads — one stylesheet so the two pages can't drift apart.
  styleUrl: '../leads/leads.css',
})
export class AdminCplLeads implements OnInit {
  protected readonly MONEY_STATUSES = MONEY_STATUSES;
  protected readonly TRACKABLE_STATUSES = TRACKABLE_STATUSES;
  private readonly liveReload = reloadOnChange(() => this.refresh());
  private readonly leadService = inject(LeadService);
  private readonly userService = inject(UserService);
  private readonly auth = inject(AuthService);
  /** Retention Manager browses and annotates; every pipeline action is hidden (and 403s server-side). */
  readonly readOnly = computed(() => this.auth.role() === 'RETENTION_MANAGER');
  private readonly externalClientService = inject(ExternalClientService);

  readonly leads = signal<Lead[]>([]);
  readonly externalClients = signal<ExternalClient[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = toastNotice();
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
  readonly dCodeOptions = [
    { value: '', label: 'D-code: All' },
    ...D_CODE_OPTIONS.map((o) => ({ ...o, label: `D-code: ${o.label}` })),
  ];

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
    { value: '', label: 'Junior closer: All' },
    ...this.juniorClosers().map((j) => ({ value: j.id, label: `Junior closer: ${j.name}` })),
  ]);

  private readonly byFilters = computed(() => {
    let rows = this.leads();
    const dCode = this.dCodeFilter();
    const junior = this.juniorFilter();
    if (dCode) rows = rows.filter((l) => l.dCode === dCode);
    if (junior) rows = rows.filter((l) => l.juniorCloser?.id === junior);
    return rows;
  });

  /** Waiting on the admin to assign — submitted by a junior closer, declined by a client, or
   * charged back and needing a new client. Lives on the To do tab whatever day it came in. */
  isPending(lead: Lead): boolean {
    return lead.status === 'SUBMITTED' || lead.status === 'REJECTED' || lead.status === 'CHARGED_BACK';
  }

  /** When the lead started waiting on the admin — a decline or charge-back starts the clock again. */
  waitingSince(lead: Lead): string {
    if (lead.status === 'CHARGED_BACK') return lead.chargeBacks[0]?.createdAt ?? lead.updatedAt;
    if (lead.status === 'REJECTED') return lead.updatedAt ?? lead.createdAt;
    // Leads submitted before submittedAt existed: a SUBMITTED lead was last touched when it was submitted.
    return lead.submittedAt ?? (lead.status === 'SUBMITTED' ? lead.updatedAt : lead.createdAt);
  }

  private readonly searchFields = (l: Lead) => [
    l.customerName,
    l.phone,
    l.state,
    l.dCode,
    l.juniorCloser?.name,
    l.client?.name,
    l.externalClient?.name,
  ];

  /** Which list is on screen: the assign queue or the history of leads with a client. */
  readonly tab = signal<'todo' | 'history'>('todo');

  // ─── To do ── its own search, status filter and sort; History's filters don't apply.
  readonly pendingSearch = signal('');
  readonly pendingKind = signal<'' | 'SUBMITTED' | 'REJECTED' | 'CHARGED_BACK'>('');
  readonly pendingKindTabs = [
    { value: '', label: 'All' },
    { value: 'SUBMITTED', label: 'Submitted' },
    { value: 'REJECTED', label: 'Rejected' },
    { value: 'CHARGED_BACK', label: 'Charged back' },
  ] as const;
  readonly pendingKindCounts = computed(() => {
    const all = this.leads().filter((l) => this.isPending(l));
    const n = (status: string) => all.filter((l) => l.status === status).length;
    return { '': all.length, SUBMITTED: n('SUBMITTED'), REJECTED: n('REJECTED'), CHARGED_BACK: n('CHARGED_BACK') };
  });

  /** Default is newest submission on top; "Chargebacks first" pins charge-backs above the rest. */
  readonly pendingSort = signal<'priority' | 'oldest' | 'newest'>('newest');
  readonly pendingSortOptions = [
    { value: 'newest', label: 'Sort: Newest first' },
    { value: 'priority', label: 'Sort: Chargebacks first' },
    { value: 'oldest', label: 'Sort: Longest waiting' },
  ];

  readonly pendingLeads = computed(() => {
    const term = this.pendingSearch().trim().toLowerCase();
    const kind = this.pendingKind();
    const sort = this.pendingSort();
    const since = (l: Lead) => new Date(this.waitingSince(l)).getTime();
    return this.leads()
      .filter((l) => this.isPending(l))
      .filter((l) => !kind || l.status === kind)
      .filter((l) => !term || this.searchFields(l).some((f) => f != null && String(f).toLowerCase().includes(term)))
      .sort((a, b) => {
        if (sort === 'priority') {
          const cb = Number(b.status === 'CHARGED_BACK') - Number(a.status === 'CHARGED_BACK');
          if (cb) return cb;
        }
        return sort === 'oldest' ? since(a) - since(b) : since(b) - since(a);
      });
  });

  // ─── History ── only leads that have reached a client (offered, approved, or external).
  private readonly logged = computed(() =>
    this.byFilters().filter((l) => l.status === 'ASSIGNED' || l.status === 'ACCEPTED' || l.status === 'ASSIGNED_EXTERNAL'),
  );
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

  readonly summary = computed(() => {
    const rows = this.byDay();
    return {
      total: rows.length,
      withClients: rows.filter((l) => l.status === 'ASSIGNED' || l.status === 'ASSIGNED_EXTERNAL').length,
      accepted: rows.filter((l) => l.status === 'ACCEPTED').length,
      unpaid: rows.filter((l) => this.isEligibleForBatchPaid(l)).length,
    };
  });

  /** Page title: the period being viewed, so it never repeats the topbar's page title. */
  readonly periodTitle = computed(() => {
    const iso = this.day();
    if (!iso) return 'All dates';
    if (this.dayTo()) return rangeLabel(iso, this.dayTo());
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
    });
  });

  /** "Logged today" / "Logged yesterday" / "Logged Oct 26" / "Logged Oct 1 – Oct 7" / "All leads". */
  readonly periodLabel = computed(() => {
    const iso = this.day();
    if (!this.dayMode()) return 'All leads';
    if (this.dayTo()) return `Logged ${rangeLabel(iso, this.dayTo())}`;
    const today = pacificIsoDate();
    if (iso === today) return 'Logged today';
    if (iso === shiftIsoDay(today, -1)) return 'Logged yesterday';
    const [y, m, d] = iso.split('-').map(Number);
    const short = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `Logged ${short}`;
  });

  /** The tile row under the title — one number per question the admin asks of the period. */
  readonly tiles = computed<{ label: string; value: number; sub: string; tone: '' | 'bad' | 'good' | 'warn' }[]>(() => {
    const s = this.summary();
    const pending = this.pendingLeads();
    const stale = pending.filter((l) => this.waitDays(l) >= 5).length;
    const rejected = pending.filter((l) => l.status === 'REJECTED').length;
    const iso = this.day();
    const prev = this.singleDay() ? (this.dayCounts()[shiftIsoDay(iso, -1)] ?? 0) : null;
    const prevLabel = iso === pacificIsoDate() ? 'yesterday' : 'the day before';
    return [
      { label: this.periodLabel(), value: s.total, sub: prev === null ? 'in this period' : `${prev} ${prevLabel}`, tone: '' },
      { label: 'Needs action', value: pending.length, sub: stale ? `${stale} waiting 5+ days` : 'none waiting long', tone: stale ? 'warn' : '' },
      { label: 'Rejected', value: rejected, sub: 'to reassign', tone: rejected ? 'bad' : '' },
      { label: 'Approved', value: s.accepted, sub: `with client: ${s.withClients}`, tone: 'good' },
      { label: 'Unpaid', value: s.unpaid, sub: s.unpaid ? 'to collect' : 'all settled', tone: s.unpaid ? 'warn' : '' },
    ];
  });

  /** Why a queued lead is waiting — the charge-back reason, the client's decline, or the notes. */
  reasonFor(lead: Lead): string {
    if (lead.status === 'CHARGED_BACK') return lead.chargeBacks[0]?.reason ?? '';
    if (lead.status === 'REJECTED') return lead.rejectionReason ?? '';
    return lead.closerNotes ?? '';
  }

  readonly hasFilters = computed(
    () => !!(this.view.search().trim() || this.dCodeFilter() || this.juniorFilter() || this.view.status()),
  );

  clearFilters(): void {
    this.view.setSearch('');
    this.dCodeFilter.set('');
    this.juniorFilter.set('');
    this.view.setStatus('');
    this.view.page.set(1);
  }

  /** Whole days a lead has been waiting on the admin. */
  waitDays(lead: Lead): number {
    return Math.max(0, Math.floor((Date.now() - new Date(this.waitingSince(lead)).getTime()) / 86_400_000));
  }

  waitLabel(lead: Lead): string {
    const d = this.waitDays(lead);
    return d === 0 ? 'Today' : d === 1 ? '1 day' : `${d} days`;
  }

  /** Set after a successful assignment so the admin sees the assigned lead (with its copy action). */
  readonly assignedLead = signal<{ lead: Lead; to: string } | null>(null);

  /** Row briefly highlighted in History after an assignment. */
  readonly highlightId = signal<string | null>(null);

  /** Lead a notification link points at (`?highlight=`): switch to the tab holding it, then flash it. */
  readonly linkHighlightId = highlightFromQuery(() => this.leads(), (lead) => {
    if (this.pendingLeads().some((l) => l.id === lead.id)) {
      this.tab.set('todo');
      return;
    }
    this.clearFilters();
    this.day.set('');
    this.dayTo.set('');
    this.tab.set('history');
    this.view.reveal((l) => l.id === lead.id);
  });

  /** Closing the "Lead assigned" popup takes the admin to the History tab, on the lead. */
  closeAssigned(): void {
    const done = this.assignedLead();
    this.assignedLead.set(null);
    if (!done) return;
    this.clearFilters();
    this.day.set(pacificIsoDate());
    this.dayTo.set('');
    this.tab.set('history');
    this.highlightId.set(done.lead.id);
    setTimeout(() => document.getElementById('hl-' + done.lead.id)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    setTimeout(() => this.highlightId.set(null), 6000);
  }


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
      label: f.value ? `Status: ${f.label} (${counts[f.value]})` : `Status: All (${counts['']})`,
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
    if (this.readOnly()) return this.refresh();
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

  // ─── Edit (rejected or charged-back leads) ─────────────────
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
