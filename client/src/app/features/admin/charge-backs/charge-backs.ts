import { Router } from '@angular/router';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideBanknoteX,
  LucideBuilding2,
  LucideCircleCheck,
  LucideClock,
  LucideSquarePen,
  LucideSend,
  LucideUserCheck,
  LucideUsers,
  LucideX,
} from '@lucide/angular';
import { AuthService } from '../../../core/services/auth.service';
import { LeadService } from '../../../core/services/lead.service';
import { UserService } from '../../../core/services/user.service';
import { ExternalClientService } from '../../../core/services/external-client.service';
import { AnalyticsService, ChargeBackAnalytics, ChargeBackRecent } from '../../../core/services/analytics.service';
import { ExternalClient } from '../../../core/models/external-client.model';
import { Lead } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import {
  formatDate,
  formatPhone,
  formatPkr,
  getAvatarTone,
  getInitials,
  pacificIsoDate,
  pluralize,
  timeAgo,
} from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import { NotePeek } from '../../../shared/ui/lead-notes';
import { PageHero, EmptyState, Pagination, SearchBox, SkeletonRows, StatTile, StatusBadge } from '../../../shared/ui/ui';
import { LeadDetail } from '../../../shared/lead-detail';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';
import { Select } from '../../../shared/ui/select';
import { CHARGE_BACK_REASON_OPTIONS, PLAN_TYPE_LABEL, PLAN_TYPE_OPTIONS, US_STATE_OPTIONS } from '../../../core/lead-options';
import { PhoneInput } from '../../../shared/ui/phone-input';
import { ZipInput } from '../../../shared/ui/zip-input';
import { apiErrorMessage } from '../../../core/api';
import { toastNotice } from '../../../core/toast-notice';

interface LookupUser {
  id: string;
  name: string;
  email: string;
}

/** Fields an admin may correct on a charged-back lead before reassigning it. */
interface EditDraft {
  customerName: string;
  phone: string;
  state: string;
  zipcode: string;
  maritalStatus: string;
  healthConditions: string;
  closerNotes: string;
}

const PLAN_COLORS: Record<string, string> = {
  LEVEL: '#c9a227',
  GRADED: '#2563eb',
  MODIFIED: '#dc2626',
  GI: '#16a34a',
  NONE: '#9ca3af',
};

@Component({
  selector: 'app-admin-charge-backs',
  imports: [PageHero, 
    Select,
    PhoneInput,
    ZipInput,
    FormsModule,
    Modal,
    LeadDetail,
    StatTile,
    StatusBadge,
    NotePeek,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideBanknoteX,
    LucideBuilding2,
    LucideCircleCheck,
    LucideSend,
    LucideUserCheck,
    LucideSquarePen,
    LucideClock,
    LucideUsers,
    LucideX,
  ],
  templateUrl: './charge-backs.html',
  styles: `
    .filters { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; margin-bottom: 1rem; }
    .filters app-select { min-width: 180px; }
    .dash-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; margin-bottom: 1rem; }
    .dash-grid .wide { grid-column: 1 / -1; }

    .cols { display: flex; align-items: flex-end; gap: 0.5rem; height: 170px; padding-top: 0.5rem; }
    .col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%;
      gap: 4px; background: none; border: 0; cursor: pointer; padding: 0; min-width: 0; }
    .col .val { font-size: 11px; font-weight: 600; color: var(--gray-600); white-space: nowrap; }
    .col .bar { width: 100%; max-width: 44px; border-radius: 6px 6px 2px 2px;
      background: linear-gradient(180deg, var(--gold-400, #d4b24c), var(--gold-700, #a8841a)); transition: opacity .15s; }
    .col .lbl { font-size: 11px; color: var(--gray-500); }
    .cols:has(.on) .col:not(.on) .bar { opacity: 0.35; }
    .col:hover .bar { opacity: 1; }
    .col.on .lbl { color: var(--gold-800); font-weight: 700; }

    .pickable { cursor: pointer; border-radius: 6px; }
    .pickable.on .chart-key { font-weight: 700; color: var(--gold-800); }
    .rank { display: flex; flex-direction: column; gap: 0.55rem; }
    .rank-row { display: grid; grid-template-columns: 110px 1fr auto; gap: 0.6rem; align-items: center; background: none;
      border: 0; padding: 0; cursor: pointer; text-align: left; font: inherit; }
    .rank-row .nm { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rank-row .track { height: 10px; border-radius: 999px; background: var(--gray-100); overflow: hidden; }
    .rank-row .fill { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #f87171, #dc2626); }
    .rank-row.on .nm { font-weight: 700; color: var(--gold-800); }
    .rank-row .amt { font-size: 12px; font-weight: 600; color: var(--gray-700); }

    .donut-wrap { display: flex; align-items: center; gap: 1.2rem; flex-wrap: wrap; }
    .donut { width: 130px; height: 130px; border-radius: 50%; position: relative; flex: none; }
    .donut::after { content: ''; position: absolute; inset: 24px; border-radius: 50%; background: var(--card-bg, #fff); }
    .donut-mid { position: absolute; inset: 0; display: grid; place-items: center; z-index: 1; font-weight: 700; font-size: 20px; }
    .legend { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
    .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; }

    .plan-pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600;
      background: var(--gold-100); color: var(--gold-800); }
    .reason-quote { margin-top: 4px; padding-left: 8px; border-left: 3px solid var(--danger-600, #dc2626);
      font-style: italic; color: var(--gray-600); max-width: 280px; }
    .wait { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px;
      font-size: 12px; font-weight: 600; }
    .wait--fresh { background: var(--success-50); color: var(--success-700); }
    .wait--aging { background: var(--warning-50); color: var(--warning-700); }
    .wait--stale { background: var(--danger-50); color: var(--danger-700); }
    .done { background: var(--gray-100); color: var(--gray-600); }
    .amount-hit { color: var(--danger-700); font-weight: 700; }
    tr.row--stale td:first-child { box-shadow: inset 3px 0 0 var(--danger-600, #dc2626); }
  `,
})
export class AdminChargeBacks implements OnInit {
  readonly stateOptions = US_STATE_OPTIONS;
  private readonly liveReload = reloadOnChange(() => this.refresh());
  private readonly leadService = inject(LeadService);
  private readonly userService = inject(UserService);
  private readonly externalClientService = inject(ExternalClientService);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** PKR amounts are ADMIN-only (the server omits them for MANAGER) — charts fall back to counts. */
  /** Retention Manager works charged-back leads (edit / assign) but has no closers to show; the server limits him to charged-back Retention leads. */
  readonly readOnly = computed(() => this.auth.role() === 'RETENTION_MANAGER');
  readonly showPkr = computed(() => this.auth.user()?.role === 'ADMIN');

  /** Charged-back leads still awaiting reassignment — the only ones actions apply to. */
  readonly leads = signal<Lead[]>([]);
  readonly analytics = signal<ChargeBackAnalytics | null>(null);
  readonly clients = signal<LookupUser[]>([]);
  readonly externalClients = signal<ExternalClient[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = toastNotice();
  readonly busyId = signal<string | null>(null);

  /** Which lead each modal is acting on — only one is ever open at a time. */
  readonly detailLead = signal<Lead | null>(null);
  readonly assignLead = signal<Lead | null>(null);
  readonly assignExternalLead = signal<Lead | null>(null);
  readonly editLead = signal<Lead | null>(null);
  /** True when the open detail modal is a past charge-back — read-only, no actions. */
  readonly detailIsHistory = signal(false);

  readonly clientSearch = signal('');
  readonly chosenClientId = signal('');
  readonly externalClientSearch = signal('');
  readonly chosenExternalClientId = signal('');
  readonly draft = signal<EditDraft | null>(null);

  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly formatPhone = formatPhone;
  readonly formatPkr = formatPkr;
  readonly formatDate = formatDate;
  readonly timeAgo = timeAgo;
  readonly pluralize = pluralize;
  readonly planLabelOf = (p: ChargeBackRecent['planType']): string => (p ? PLAN_TYPE_LABEL[p] : '—');

  // ─── Filters ────────────────────────────────────────────────
  readonly clientFilter = signal('');
  readonly monthFilter = signal('');
  readonly planFilter = signal('');
  readonly statusFilter = signal('');
  readonly reasonFilter = signal('');

  readonly planOptions = [{ value: '', label: 'All plans' }, ...PLAN_TYPE_OPTIONS];
  readonly statusOptions = [
    { value: '', label: 'All statuses' },
    { value: 'AWAITING', label: 'Waiting for a new client' },
    { value: 'SENT_BACK', label: 'Sent back for correction' },
    { value: 'REASSIGNED', label: 'Given to a new client' },
  ];

  private readonly allRows = computed<ChargeBackRecent[]>(() => this.analytics()?.recent ?? []);

  /** Preset label if the reason is one of ours, otherwise the 'OTHER' bucket (typed/legacy). */
  private reasonBucket(r: ChargeBackRecent): string {
    return CHARGE_BACK_REASON_OPTIONS.some((o) => o.value !== 'OTHER' && o.value === r.reason) ? r.reason : 'OTHER';
  }

  readonly reasonOptions = [{ value: '', label: 'All reasons' }, ...CHARGE_BACK_REASON_OPTIONS];

  /** Bucket for the status filter — where the lead went after this charge-back. */
  private stateOf(r: ChargeBackRecent): 'AWAITING' | 'SENT_BACK' | 'REASSIGNED' {
    if (this.leadFor(r)) return 'AWAITING';
    return r.leadStatus.startsWith('RETURNED_TO_') ? 'SENT_BACK' : 'REASSIGNED';
  }

  isSentBack(r: ChargeBackRecent): boolean {
    return r.leadStatus.startsWith('RETURNED_TO_');
  }

  private monthOf(r: ChargeBackRecent): string {
    return pacificIsoDate(r.createdAt).slice(0, 7);
  }

  private monthDate(key: string): Date {
    return new Date(Number(key.slice(0, 4)), Number(key.slice(5)) - 1, 1);
  }

  /** The still-open Lead for a row — only a lead's latest charge-back can be awaiting. */
  leadFor(r: ChargeBackRecent): Lead | undefined {
    return this.leads().find((l) => l.id === r.leadId && l.chargeBacks[0]?.id === r.id);
  }

  readonly clientOptions = computed(() => {
    const seen = new Map<string, string>();
    for (const r of this.allRows()) seen.set(r.client.id, r.client.name);
    return [
      { value: '', label: 'All clients' },
      ...[...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
    ];
  });

  readonly monthOptions = computed(() => {
    const keys = [...new Set(this.allRows().map((r) => this.monthOf(r)))].sort().reverse();
    return [
      { value: '', label: 'All time' },
      ...keys.map((k) => ({
        value: k,
        label: this.monthDate(k).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      })),
    ];
  });

  /** Everything except the month filter — the trend chart needs the other months to draw. */
  private readonly beforeMonth = computed(() => {
    const client = this.clientFilter();
    const plan = this.planFilter();
    const status = this.statusFilter();
    const reason = this.reasonFilter();
    return this.allRows().filter(
      (r) =>
        (!client || r.client.id === client) &&
        (!reason || this.reasonBucket(r) === reason) &&
        (!plan || r.planType === plan) &&
        (!status || this.stateOf(r) === status),
    );
  });

  readonly filtered = computed(() => {
    const month = this.monthFilter();
    return month ? this.beforeMonth().filter((r) => this.monthOf(r) === month) : this.beforeMonth();
  });

  readonly hasFilters = computed(
    () => !!(this.clientFilter() || this.monthFilter() || this.planFilter() || this.statusFilter() || this.reasonFilter()),
  );

  clearFilters(): void {
    this.clientFilter.set('');
    this.monthFilter.set('');
    this.planFilter.set('');
    this.statusFilter.set('');
    this.reasonFilter.set('');
  }

  /** Charts double as filter controls: clicking a bar toggles it into/out of the filter. */
  pick(kind: 'client' | 'month' | 'reason', value: string): void {
    const sig = kind === 'client' ? this.clientFilter : kind === 'month' ? this.monthFilter : this.reasonFilter;
    sig.set(sig() === value ? '' : value);
  }

  // ─── Charts ─────────────────────────────────────────────────
  readonly trend = computed(() => {
    const byMonth = new Map<string, { count: number; pkr: number }>();
    for (const r of this.beforeMonth()) {
      const k = this.monthOf(r);
      const e = byMonth.get(k) ?? { count: 0, pkr: 0 };
      e.count++;
      e.pkr += r.pkrAmount ?? 0;
      byMonth.set(k, e);
    }
    const keys = [...byMonth.keys()].sort().slice(-12);
    const size = (e: { count: number; pkr: number }) => (this.showPkr() ? e.pkr : e.count);
    const max = Math.max(1, ...keys.map((k) => size(byMonth.get(k)!)));
    return keys.map((k) => {
      const e = byMonth.get(k)!;
      return {
        key: k,
        label: this.monthDate(k).toLocaleDateString('en-US', { month: 'short' }),
        ...e,
        pct: Math.max(6, Math.round((size(e) / max) * 100)),
      };
    });
  });

  private rank(keyOf: (r: ChargeBackRecent) => { id: string; name: string } | null) {
    const m = new Map<string, { id: string; name: string; count: number; pkr: number }>();
    for (const r of this.filtered()) {
      const k = keyOf(r);
      if (!k) continue;
      const e = m.get(k.id) ?? { id: k.id, name: k.name, count: 0, pkr: 0 };
      e.count++;
      e.pkr += r.pkrAmount ?? 0;
      m.set(k.id, e);
    }
    const size = (e: { count: number; pkr: number }) => (this.showPkr() ? e.pkr : e.count);
    const rows = [...m.values()].sort((a, b) => size(b) - size(a)).slice(0, 6);
    const max = Math.max(1, ...rows.map(size));
    return rows.map((r) => ({ ...r, pct: Math.max(4, Math.round((size(r) / max) * 100)) }));
  }

  readonly byClient = computed(() => this.rank((r) => r.client));
  readonly byCloser = computed(() => this.rank((r) => r.closer));

  /** Why the chargebacks happened — same buckets as the reason filter. */
  readonly byReason = computed(() => {
    const m = new Map<string, { key: string; label: string; count: number }>();
    for (const r of this.beforeMonth()) {
      const key = this.reasonBucket(r);
      const label = CHARGE_BACK_REASON_OPTIONS.find((o) => o.value === key)?.label ?? key;
      const e = m.get(key) ?? { key, label, count: 0 };
      e.count++;
      m.set(key, e);
    }
    const rows = [...m.values()].sort((a, b) => b.count - a.count);
    const max = Math.max(1, ...rows.map((r) => r.count));
    return rows.map((r) => ({ ...r, pct: Math.max(4, Math.round((r.count / max) * 100)) }));
  });

  readonly byPlan = computed(() => {
    const m = new Map<string, { label: string; count: number; color: string }>();
    for (const r of this.filtered()) {
      const k = r.planType ?? 'NONE';
      const e = m.get(k) ?? { label: r.planType ? PLAN_TYPE_LABEL[r.planType] : 'No plan', count: 0, color: PLAN_COLORS[k] };
      e.count++;
      m.set(k, e);
    }
    const rows = [...m.values()].sort((a, b) => b.count - a.count);
    const total = rows.reduce((s, r) => s + r.count, 0) || 1;
    let acc = 0;
    const stops = rows.map((r) => {
      const from = (acc / total) * 100;
      acc += r.count;
      return `${r.color} ${from}% ${(acc / total) * 100}%`;
    });
    return {
      rows: rows.map((r) => ({ ...r, pct: Math.round((r.count / total) * 100) })),
      gradient: rows.length ? `conic-gradient(${stops.join(', ')})` : 'conic-gradient(#e5e7eb 0 100%)',
    };
  });

  readonly stats = computed(() => {
    const rows = this.filtered();
    const pkr = rows.reduce((s, r) => s + (r.pkrAmount ?? 0), 0);
    return {
      total: rows.length,
      pkr,
      avg: rows.length ? Math.round(pkr / rows.length) : 0,
      awaiting: rows.filter((r) => this.leadFor(r)).length,
      longestWait: rows.reduce((max, r) => (this.leadFor(r) ? Math.max(max, this.waitingDays(r)) : max), 0),
      worstClient: this.byClient()[0] ?? null,
    };
  });

  /** Whole days since the charge-back — drives the "waiting" urgency chip. */
  waitingDays(r: ChargeBackRecent): number {
    return Math.max(0, Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 86_400_000));
  }

  /** 'fresh' < 3 days, 'aging' < 7, 'stale' after — the longer a lead sits, the louder it gets. */
  urgency(r: ChargeBackRecent): 'fresh' | 'aging' | 'stale' {
    const d = this.waitingDays(r);
    return d < 3 ? 'fresh' : d < 7 ? 'aging' : 'stale';
  }

  readonly view = createListView<ChargeBackRecent>({
    source: this.filtered,
    searchFields: (r) => [r.customerName, r.phone, r.state, r.client.name, r.closer?.name, r.juniorCloser?.name, r.reason],
    sorters: {
      customerName: (r) => r.customerName,
      createdAt: (r) => new Date(r.createdAt).getTime(),
      pkrAmount: (r) => r.pkrAmount ?? 0,
    },
    initialSort: { key: 'createdAt', dir: 'desc' },
    pageSize: 10,
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
    // Retention Manager never assigns, so he has no use for (or access to) the client lists.
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
      const [leads, analytics] = await Promise.all([
        this.leadService.chargeBacks(),
        this.analyticsService.chargeBacks(),
      ]);
      this.leads.set(leads);
      this.analytics.set(analytics);
    } catch {
      this.error.set('Could not load charge-backs. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Open any row — a still-waiting lead is already loaded; a handled one is fetched. */
  async openRow(r: ChargeBackRecent): Promise<void> {
    const open = this.leadFor(r);
    if (open) {
      this.detailIsHistory.set(false);
      this.detailLead.set(open);
      return;
    }
    this.error.set(null);
    try {
      const lead = await this.leadService.getLead(r.leadId);
      this.detailIsHistory.set(true);
      this.detailLead.set(lead);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not open the lead.'));
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
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
      await this.leadService.assignLead(lead.id, clientId);
      const client = this.clients().find((c) => c.id === clientId);
      // Reassigning moves the lead out of the awaiting queue; its history row stays.
      this.leads.update((rows) => rows.filter((l) => l.id !== lead.id));
      this.assignLead.set(null);
      this.notice.set(`${lead.customerName} reassigned to ${client?.name ?? 'client'}.`);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not assign the lead.'));
    } finally {
      this.busyId.set(null);
    }
  }

  /** Retention Manager is done working the lead — it moves to the admin queue, where only Admin assigns it. */
  async submitToAdmin(lead: Lead, event?: Event): Promise<void> {
    event?.stopPropagation();
    this.error.set(null);
    this.busyId.set(lead.id);
    try {
      await this.leadService.submitToAdmin(lead.id);
      this.leads.update((rows) => rows.filter((l) => l.id !== lead.id));
      this.notice.set(`${lead.customerName} sent to admin.`);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not send the lead to admin.'));
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
      await this.leadService.assignLeadExternal(lead.id, externalClientId);
      const externalClient = this.externalClients().find((c) => c.id === externalClientId);
      this.leads.update((rows) => rows.filter((l) => l.id !== lead.id));
      this.assignExternalLead.set(null);
      this.notice.set(`${lead.customerName} reassigned to ${externalClient?.name ?? 'external client'}.`);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not assign the lead.'));
    } finally {
      this.busyId.set(null);
    }
  }

  // ─── Edit (charged-back leads only) ────────────────────────
  openEdit(lead: Lead, event?: Event): void {
    event?.stopPropagation();
    if (this.auth.role() === 'RETENTION_MANAGER') {
      void this.router.navigate(['/retention-manager/leads', lead.id]);
      return;
    }
    this.error.set(null);
    this.draft.set({
      customerName: lead.customerName,
      phone: lead.phone,
      state: lead.state,
      zipcode: lead.zipcode ?? '',
      maritalStatus: lead.maritalStatus ?? '',
      healthConditions: lead.healthConditions ?? '',
      closerNotes: lead.closerNotes ?? '',
    });
    this.editLead.set(lead);
  }

  async saveEdit(): Promise<void> {
    const lead = this.editLead();
    const draft = this.draft();
    if (!lead || !draft) return;

    this.error.set(null);
    this.busyId.set(lead.id);
    try {
      const updated = await this.leadService.editLead(lead.id, {
        customerName: draft.customerName,
        phone: draft.phone,
        state: draft.state,
        zipcode: draft.zipcode || undefined,
        maritalStatus: draft.maritalStatus || undefined,
        healthConditions: draft.healthConditions || undefined,
        closerNotes: draft.closerNotes || undefined,
      });
      this.leads.update((rows) => rows.map((l) => (l.id === lead.id ? updated : l)));
      this.editLead.set(null);
      this.notice.set(`Saved changes to ${updated.customerName}.`);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not save changes.'));
    } finally {
      this.busyId.set(null);
    }
  }

  updateDraft<K extends keyof EditDraft>(key: K, value: string): void {
    this.draft.update((d) => (d ? { ...d, [key]: value } : d));
  }
}
