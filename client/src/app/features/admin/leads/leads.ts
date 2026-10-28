import { Router } from '@angular/router';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideBanknote,
  LucideBanknoteX,
  LucideBuilding2,
  LucideCircleCheck,
  LucideFileText,
  LucideHeadset,
  LucideSquarePen,
  LucideUndo2,
  LucideUserCheck,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { UserService } from '../../../core/services/user.service';
import { ExternalClientService } from '../../../core/services/external-client.service';
import { ExternalClient } from '../../../core/models/external-client.model';
import { Lead, LeadStatus } from '../../../core/models/lead.model';
import { highlightFromQuery } from '../../../core/highlight';
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
  SearchBox,
  SkeletonRows,
  StatusBadge,
} from '../../../shared/ui/ui';
import { DayBar, rangeBounds, rangeLabel, shiftIsoDay } from '../../../shared/ui/day-bar';
import { LeadQuickEdit } from '../../../shared/lead-quick-edit';
import { Select } from '../../../shared/ui/select';
import { CHARGE_BACK_MONTH_OPTIONS, CHARGE_BACK_REASON_OPTIONS, MONEY_STATUSES, TRACKABLE_STATUSES } from '../../../core/lead-options';
import { LeadDetail } from '../../../shared/lead-detail';
import { RowMenu } from '../../../shared/ui/row-menu';
import { AdminStatusControl } from '../../../shared/ui/admin-status';
import { LifecycleButton } from '../../../shared/ui/lifecycle-button';
import { DialButton } from '../../../shared/ui/dial-button';
import { NotePeek } from '../../../shared/ui/lead-notes';
import { AuthService } from '../../../core/services/auth.service';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';
import { apiErrorMessage } from '../../../core/api';
import { toastNotice } from '../../../core/toast-notice';

const STATUS_FILTERS: { label: string; value: string }[] = [
  { label: 'All', value: '' },
  { label: 'New', value: 'NEW' },
  { label: 'Assigned', value: 'ASSIGNED' },
  { label: 'Approved', value: 'ACCEPTED' },
  { label: 'Declined', value: 'REJECTED' },
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
    DialButton,
    NotePeek,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideCircleCheck,
    LucideBanknote,
    LucideBanknoteX,
    LucideFileText,
    LucideHeadset,
    LucideUndo2,
    LucideBuilding2,
    LucideUserCheck,
    LucideSquarePen,
  ],
  templateUrl: './leads.html',
  styleUrl: './leads.css',
})
export class AdminLeads implements OnInit {
  protected readonly MONEY_STATUSES = MONEY_STATUSES;
  protected readonly TRACKABLE_STATUSES = TRACKABLE_STATUSES;
  private readonly liveReload = reloadOnChange(() => this.refresh());
  private readonly leadService = inject(LeadService);
  private readonly userService = inject(UserService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  /** Retention Manager browses and annotates; every pipeline action is hidden (and 403s server-side). */
  readonly readOnly = computed(() => this.auth.role() === 'RETENTION_MANAGER');
  private readonly externalClientService = inject(ExternalClientService);

  readonly leads = signal<Lead[]>([]);
  readonly clients = signal<LookupUser[]>([]);
  readonly externalClients = signal<ExternalClient[]>([]);
  readonly loading = signal(true);
  readonly busyId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly notice = toastNotice();
  readonly selected = signal<Lead | null>(null);
  readonly closerFilter = signal('');
  readonly sourceFilter = signal('');

  /** Which lead each queue-style modal is acting on — only one is ever open at a time. */
  readonly assignLead = signal<Lead | null>(null);
  readonly assignExternalLead = signal<Lead | null>(null);
  readonly returnLead = signal<Lead | null>(null);
  readonly editLead = signal<Lead | null>(null);

  /** Day shown in the log below — Pacific yyyy-MM-dd, '' for every day. Starts on today. */
  // Retention Manager works charged-back leads whenever they happened, so no day pre-selected.
  readonly day = signal(this.readOnly() ? '' : pacificIsoDate());
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


  /** Lead being charged back — single-record action, mirrors the batch "Mark Paid" modal. */
  readonly chargeBackModalOpen = signal(false);
  readonly chargeBackSubmitting = signal(false);
  chargeBackPkrAmount: number | null = null;
  chargeBackMonth: number | null = null;
  readonly chargeBackMonthOptions = CHARGE_BACK_MONTH_OPTIONS;
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
    { value: '', label: 'Closer: All' },
    ...this.closers().map((c) => ({ value: c.id, label: `Closer: ${c.name}` })),
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
    { value: '', label: 'Source: All' },
    { value: 'CPA', label: 'Source: CPA' },
    { value: 'RETENTION', label: 'Source: Retention' },
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
    // Charged back = waiting for a new client, so it needs assigning too. The Retention Manager
    // has no "Needs your action" card, so for him charged-back leads stay in the log below.
    return (
      lead.status === 'SUBMITTED' ||
      lead.status === 'REJECTED' ||
      (lead.status === 'CHARGED_BACK' && !this.readOnly())
    );
  }

  /** When the lead started waiting on the admin — a charge-back starts the clock again. */
  waitingSince(lead: Lead): string {
    if (lead.status === 'CHARGED_BACK') return lead.chargeBacks[0]?.createdAt ?? lead.updatedAt;
    return lead.createdAt;
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

  /** Order of the "Needs your action" queue. Default puts charge-backs (money already clawed
   * back) on top, then the longest-waiting leads. */
  readonly pendingSort = signal<'priority' | 'oldest' | 'newest'>('priority');
  readonly pendingSortOptions = [
    { value: 'priority', label: 'Sort: Chargebacks first' },
    { value: 'oldest', label: 'Sort: Longest waiting' },
    { value: 'newest', label: 'Sort: Newest first' },
  ];

  /** The queue's own CPA / Retention filter — independent of the log's filters below. */
  readonly pendingSource = signal<'' | 'CPA' | 'RETENTION'>('');
  readonly pendingSourceCounts = computed(() => {
    const all = this.cpaLeads().filter((l) => this.isPending(l));
    return {
      '': all.length,
      CPA: all.filter((l) => l.leadType === 'CPA').length,
      RETENTION: all.filter((l) => l.leadType === 'RETENTION').length,
    };
  });
  readonly pendingSourceTabs = [
    { value: '', label: 'All' },
    { value: 'CPA', label: 'CPA' },
    { value: 'RETENTION', label: 'Retention' },
  ] as const;

  /** The To do list — its own search and source filter apply; History's filters don't. */
  /** To do's own search — separate from History's, so one tab never silently filters the other. */
  readonly pendingSearch = signal('');

  readonly pendingLeads = computed(() => {
    const term = this.pendingSearch().trim().toLowerCase();
    const sort = this.pendingSort();
    const source = this.pendingSource();
    const since = (l: Lead) => new Date(this.waitingSince(l)).getTime();
    return this.cpaLeads()
      .filter((l) => this.isPending(l))
      .filter((l) => !source || l.leadType === source)
      .filter((l) => !term || this.searchFields(l).some((f) => f != null && String(f).toLowerCase().includes(term)))
      .sort((a, b) => {
        if (sort === 'priority') {
          const cb = Number(b.status === 'CHARGED_BACK') - Number(a.status === 'CHARGED_BACK');
          if (cb) return cb;
        }
        return sort === 'newest' ? since(b) - since(a) : since(a) - since(b);
      });
  });

  /** The day-by-day log: only leads that have reached a client (offered, approved, or handed to
   * an external client). Leads still with a closer (New, sent back) aren't the admin's to track
   * here, and everything waiting to be assigned is in "Needs your action". The Retention
   * Manager has no queue card, so his log keeps every Retention lead. */
  private readonly logged = computed(() =>
    this.byCloser().filter((l) =>
      this.readOnly() ? true : l.status === 'ASSIGNED' ||
        l.status === 'ACCEPTED' ||
        l.status === 'ASSIGNED_EXTERNAL' ||
        l.status === 'CHARGED_BACK',
    ),
  );

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

  /** Retention Manager's at-a-glance numbers over the loaded (Retention-only) leads. */
  readonly rmStats = computed(() => {
    const rows = this.leads();
    const chargedBack = rows.filter((l) => l.status === 'CHARGED_BACK');
    return {
      total: rows.length,
      chargedBack: chargedBack.length,
      unworked: chargedBack.filter((l) => !(l._count?.notes ?? 0)).length,
      // Charged back at some point, since reassigned or re-approved.
      wonBack: rows.filter(
        (l) => (l.chargeBacks?.length ?? 0) > 0 && ['ASSIGNED', 'ACCEPTED', 'ASSIGNED_EXTERNAL'].includes(l.status),
      ).length,
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
    if (this.readOnly()) {
      const r = this.rmStats();
      return [
        { label: 'Retention leads', value: r.total, sub: 'on record', tone: '' },
        { label: 'Charged back', value: r.chargedBack, sub: 'in play', tone: r.chargedBack ? 'bad' : '' },
        { label: 'No notes yet', value: r.unworked, sub: 'charged back, untouched', tone: r.unworked ? 'warn' : '' },
        { label: 'Won back', value: r.wonBack, sub: 'back with a client', tone: 'good' },
      ];
    }
    const s = this.summary();
    const pending = this.pendingLeads();
    const stale = pending.filter((l) => this.waitDays(l) >= 5).length;
    const chargedBack = pending.filter((l) => l.status === 'CHARGED_BACK');
    const chargedToday = chargedBack.filter((l) => this.waitDays(l) === 0).length;
    const iso = this.day();
    const prev = this.singleDay() ? (this.dayCounts()[shiftIsoDay(iso, -1)] ?? 0) : null;
    const prevLabel = iso === pacificIsoDate() ? 'yesterday' : 'the day before';
    return [
      { label: this.periodLabel(), value: s.total, sub: prev === null ? 'in this period' : `${prev} ${prevLabel}`, tone: '' },
      { label: 'Needs action', value: pending.length, sub: stale ? `${stale} waiting 5+ days` : 'none waiting long', tone: stale ? 'warn' : '' },
      { label: 'Charged back', value: chargedBack.length, sub: chargedToday ? `${chargedToday} today` : 'waiting for a client', tone: chargedBack.length ? 'bad' : '' },
      { label: 'Approved', value: s.accepted, sub: `with client: ${s.withClients}`, tone: 'good' },
      { label: 'Unpaid', value: s.unpaid, sub: s.unpaid ? 'to collect' : 'all settled', tone: s.unpaid ? 'warn' : '' },
    ];
  });

  /** Why a queued lead is waiting — the charge-back reason, the client's decline, or the closer's notes. */
  reasonFor(lead: Lead): string {
    if (lead.status === 'CHARGED_BACK') return lead.chargeBacks[0]?.reason ?? '';
    if (lead.status === 'REJECTED') return lead.rejectionReason ?? '';
    return lead.closerNotes ?? '';
  }

  readonly hasFilters = computed(
    () => !!(this.view.search().trim() || this.sourceFilter() || this.closerFilter() || this.view.status()),
  );

  clearFilters(): void {
    this.view.setSearch('');
    this.sourceFilter.set('');
    this.closerFilter.set('');
    this.view.setStatus('');
    this.view.page.set(1);
  }

  /** Which list is on screen: the assign queue or the history of leads with a client. */
  readonly tab = signal<'todo' | 'history'>('todo');

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
      label: f.value ? `Status: ${f.label} (${counts[f.value]})` : `Status: All (${counts['']})`,
    }));
  });

  readonly selectedCount = computed(() => this.selectedIds().size);

  /** Only unpaid assigned leads can be batch-marked paid. */
  isEligibleForBatchPaid(lead: Lead): boolean {
    return lead.paymentStatus === 'UNPAID' && MONEY_STATUSES.includes(lead.status);
  }

  /** Only assigned, PAID leads can be batch-charged back. */
  isEligibleForBatchChargeBack(lead: Lead): boolean {
    return lead.paymentStatus === 'PAID' && MONEY_STATUSES.includes(lead.status);
  }

  /** A row is selectable if any batch action (Mark Paid / Charge Back) applies to it. */
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

  /** Detail-popup shortcut: narrows the selection to this one lead and runs the same batch flow. */
  actOnLead(lead: Lead, action: 'paid' | 'chargeBack'): void {
    this.selected.set(null);
    this.selectedIds.set(new Set([lead.id]));
    if (action === 'paid') this.openBatchModal();
    else this.openChargeBackModal();
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
    // The Retention Manager edits through the full retention form, not the quick-fix popup.
    if (this.readOnly()) {
      void this.router.navigate(['/retention-manager/leads', lead.id]);
      return;
    }
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

  onAdminStatusChanged(updated: Lead): void {
    this.leads.update((rows) => rows.map((l) => (l.id === updated.id ? updated : l)));
    if (this.selected()?.id === updated.id) this.selected.set(updated);
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
    this.chargeBackMonth = null;
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
    if (!this.chargeBackMonth) {
      this.error.set('Pick the month of the charge-back.');
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
      const { count } = await this.leadService.batchChargeBack(leadIds, this.chargeBackPkrAmount, reason, this.chargeBackMonth);
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
