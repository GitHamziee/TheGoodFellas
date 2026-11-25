import { NgTemplateOutlet } from '@angular/common';
import { Component, OnInit, computed, inject, signal, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideBanknote,
  LucideCreditCard,
  LucideBriefcase,
  LucideBuilding2,
  LucideCircleCheck,
  LucideKeyRound,
  LucideUserPlus,
  LucideX,
} from '@lucide/angular';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { AppUser, Role } from '../../../core/models/user.model';
import { ROLE_LABEL } from '../../../core/nav-config';
import { US_STATES } from '../../../core/us-states';
import { createListView } from '../../../core/list-view';
import { getAvatarTone, getInitials } from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import { Select, SelectOption } from '../../../shared/ui/select';
import { PageHero, EmptyState, Pagination, SearchBox, SkeletonRows, StatTile } from '../../../shared/ui/ui';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';
import { apiErrorMessage } from '../../../core/api';
import { PLAN_TYPE_OPTIONS } from '../../../core/lead-options';
import { PlanType } from '../../../core/models/lead.model';
import { toastNotice } from '../../../core/toast-notice';

const ROLE_TONE: Record<Role, string> = {
  ADMIN: 'tone-b',
  CLOSER: 'tone-c',
  JUNIOR_CLOSER: 'tone-d',
  CLIENT: 'tone-f',
  TEAM_LEAD: 'tone-e',
  QA_JUNIOR_CLOSER: 'tone-info',
  QA_CLOSER: 'tone-neutral',
  RETENTION: 'tone-a',
  MANAGER: 'tone-gold',
  RETENTION_MANAGER: 'tone-gold',
};

/** Admin's roster of CLIENT accounts — pricing, licensed states, and carrier availability
 * only ever apply to this role, so this page owns that whole editor. Internal staff accounts
 * (Junior Closer/Closer/Admin/Team Lead) live on the separate Team page instead. */
@Component({
  selector: 'app-admin-clients',
  imports: [PageHero, Select, NgTemplateOutlet, 
    FormsModule,
    Modal,
    StatTile,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideBriefcase,
    LucideUserPlus,
    LucideBanknote,
    LucideCreditCard,
    LucideCircleCheck,
    LucideKeyRound,
    LucideBuilding2,
    LucideX,
  ],
  templateUrl: './clients.html',
})
export class AdminClients implements OnInit, OnDestroy {
  private readonly liveReload = reloadOnChange(() => this.refresh());
  private readonly userService = inject(UserService);
  private readonly auth = inject(AuthService);

  readonly clients = signal<AppUser[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = toastNotice();
  readonly creating = signal(false);
  readonly resettingPassword = signal(false);
  /** Licensed states + carriers auto-save on every change while the detail modal is open
   * (see toggleState/addCarrier/removeCarrier) — no separate "Save coverage" button to
   * remember to click. This just reflects that in-flight/settled state near the fields. */
  /** One indicator for every auto-save in the detail modal (details, pricing, coverage). */
  readonly saveStatus = signal<'idle' | 'saving' | 'saved'>('idle');
  private inFlight = 0;
  private saveFailed = false;
  private detailSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private coverageSaveTimer: ReturnType<typeof setTimeout> | null = null;

  readonly showCreate = signal(false);
  readonly selected = signal<AppUser | null>(null);
  /** Whether the reset-password form is expanded in the detail modal. */
  readonly showResetPassword = signal(false);

  readonly roleLabel = ROLE_LABEL;
  readonly roleTone = ROLE_TONE;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  name = '';
  email = '';
  password = '';
  newPassword = '';

  /** Per-plan lead cost (USD), on both the create form and the detail modal's pricing editor. */
  levelCost: number | null = null;
  gradedCost: number | null = null;
  modifiedCost: number | null = null;
  giCost: number | null = null;
  /** Lowest monthly premium (USD) this client will accept — same pricing-editor split. */
  minimumPremium: number | null = null;
  maxAge: number | null = null;

  /** Whether this client can take payment via online bank transfer. Auto-saves through the
   * coverage editor on the detail modal, same as states/carriers below. */
  acceptsOnlineBankPayment = false;

  /** Card types this client accepts — multi-select, independent of online bank above. */
  readonly cardOptions = [
    { value: 'DIRECT_EXPRESS', label: 'Direct Express' },
    { value: 'DEBIT_CARD', label: 'Debit Card' },
    { value: 'CREDIT_CARD', label: 'Credit Card' },
  ];
  acceptedCards: string[] = [];

  toggleOnlineBank(): void {
    this.acceptsOnlineBankPayment = !this.acceptsOnlineBankPayment;
    this.queueCoverageAutoSave();
  }

  toggleCard(value: string, autoSave = false): void {
    this.acceptedCards = this.acceptedCards.includes(value)
      ? this.acceptedCards.filter((c) => c !== value)
      : [...this.acceptedCards, value];
    if (autoSave) this.queueCoverageAutoSave();
  }

  /** Licensed states. Same create-form / detail-modal split as the pricing fields above. */
  readonly usStates = US_STATES;
  selectedStates: string[] = [];

  /** Each licensed state has its own carriers, and each carrier in a state has its own plans —
   * keyed `state|carrier`. A key present means the carrier is available in that state (its
   * plan list may still be empty). The server derives the per-state carrier lists from this. */
  cellPlans: Record<string, PlanType[]> = {};
  /** True once the carriers/plans grid has been edited in the open detail modal. Only then does
   * auto-save send `statePlans`, so toggling a payment option never rewrites plan data. */
  private plansDirty = false;

  readonly planOptions = PLAN_TYPE_OPTIONS;
  /** What's typed in each "add a carrier" box, keyed by state (`__bulk__` = the multi-state bar). */
  private carrierDrafts: Record<string, string> = {};
  readonly statePicker = signal<string | null>(null);
  /** States ticked for adding one carrier to several at once. */
  checkedStates: string[] = [];
  /** The state whose carriers are open in the right-hand pane. */
  activeState: string | null = null;

  /** `activeState` if it's still licensed, otherwise the first licensed state. */
  get currentState(): string | null {
    return this.activeState && this.selectedStates.includes(this.activeState) ? this.activeState : (this.sortedSelectedStates[0] ?? null);
  }

  readonly currentUserId = computed(() => this.auth.user()?.id ?? null);

  readonly view = createListView<AppUser>({
    source: this.clients,
    searchFields: (u) => [u.name, u.email, u.phone],
    statusOf: (u) => (u.acceptsOnlineBankPayment ? 'YES' : 'NO'),
    sorters: {
      name: (u) => u.name,
      email: (u) => u.email,
      states: (u) => -(u.states?.length ?? 0),
    },
    initialSort: { key: 'name', dir: 'asc' },
    pageSize: 12,
  });

  readonly paymentFilters = [
    { label: 'All', value: '' },
    { label: 'Accepts online payment', value: 'YES' },
    { label: "Doesn't accept", value: 'NO' },
  ];

  readonly paymentCounts = computed(() => {
    const rows = this.clients();
    const accepts = rows.filter((u) => u.acceptsOnlineBankPayment).length;
    const counts: Record<string, number> = { '': rows.length, YES: accepts, NO: rows.length - accepts };
    return counts;
  });

  readonly stats = computed(() => {
    const rows = this.clients();
    return {
      total: rows.length,
      withPricing: rows.filter((u) => u.levelCost != null || u.gradedCost != null || u.modifiedCost != null || u.giCost != null).length,
      onlinePayment: rows.filter((u) => u.acceptsOnlineBankPayment).length,
    };
  });

  canSubmitCreate(): boolean {
    return this.name.trim() !== '' && this.email.trim() !== '' && this.password.length >= 8;
  }

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      this.clients.set(await this.userService.listUsers('CLIENT'));
    } catch {
      this.error.set('Could not load clients. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }

  openCreate(): void {
    this.error.set(null);
    this.name = '';
    this.email = '';
    this.password = '';
    this.levelCost = null;
    this.gradedCost = null;
    this.modifiedCost = null;
    this.giCost = null;
    this.minimumPremium = null;
    this.maxAge = null;
    this.acceptsOnlineBankPayment = false;
    this.acceptedCards = [];
    this.selectedStates = [];
    this.cellPlans = {};
    this.checkedStates = [];
    this.activeState = null;
    this.carrierDrafts = {};
    this.showCreate.set(true);
  }

  /** Toggles a state in/out of `selectedStates` — used by both the create form and the
   * detail modal's coverage editor. Removing a state drops whatever carriers were entered
   * for it (the server cleans up the saved assignment in the same coverage-update request)
   * and unchecks it in the carrier editor if it was checked there. */
  toggleState(state: string): void {
    const adding = !this.selectedStates.includes(state);
    this.selectedStates = adding ? [...this.selectedStates, state] : this.selectedStates.filter((s) => s !== state);
    if (!adding) {
      this.cellPlans = Object.fromEntries(Object.entries(this.cellPlans).filter(([key]) => !key.startsWith(`${state}|`)));
      this.checkedStates = this.checkedStates.filter((s) => s !== state);
    }
    this.queuePlansAutoSave();
  }

  /** The client's overall carrier roster — every carrier used in any state, sent so
   * `User.carriers` stays in sync. */
  get carriers(): string[] {
    return [...new Set(Object.keys(this.cellPlans).map((k) => k.slice(k.indexOf('|') + 1)))].sort((x, y) => x.localeCompare(y));
  }

  /** Every carrier in every state with its plans — what the server stores. */
  get statePlans(): { state: string; carrier: string; plans: PlanType[] }[] {
    return this.sortedSelectedStates.flatMap((state) =>
      this.carriersFor(state).map((c) => ({ state, carrier: c.name, plans: c.plans })),
    );
  }

  /** Licensed states in display order (alphabetical, matching `usStates`). */
  get sortedSelectedStates(): string[] {
    return this.usStates.filter((s) => this.selectedStates.includes(s));
  }

  /** The carriers available in one state, each with the plans taken through it there. */
  carriersFor(state: string): { name: string; plans: PlanType[] }[] {
    const prefix = `${state}|`;
    return Object.entries(this.cellPlans)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, plans]) => ({ name: key.slice(prefix.length), plans }))
      .sort((x, y) => x.name.localeCompare(y.name));
  }

  private draftKey(state: string | null): string {
    return state ?? '__bulk__';
  }

  draft(state: string | null): string {
    return this.carrierDrafts[this.draftKey(state)] ?? '';
  }

  /** A comma ends an entry, so several carriers can be typed in one go. */
  setDraft(state: string | null, value: string): void {
    if (!value.includes(',')) {
      this.carrierDrafts = { ...this.carrierDrafts, [this.draftKey(state)]: value };
      return;
    }
    const parts = value.split(',');
    const rest = parts.pop() ?? '';
    for (const part of parts) this.addCarrier(this.targetStates(state), this.canonicalCarrier(part));
    this.carrierDrafts = { ...this.carrierDrafts, [this.draftKey(state)]: rest };
  }

  addFromDraft(state: string | null): void {
    for (const part of this.draft(state).split(',')) {
      this.addCarrier(this.targetStates(state), this.canonicalCarrier(part));
    }
    this.carrierDrafts = { ...this.carrierDrafts, [this.draftKey(state)]: '' };
  }

  addSuggestion(state: string | null, name: string): void {
    this.addCarrier(this.targetStates(state), name);
    this.carrierDrafts = { ...this.carrierDrafts, [this.draftKey(state)]: '' };
  }

  private targetStates(state: string | null): string[] {
    return state ? [state] : this.checkedStates;
  }

  /** Carriers already entered on any client (plus any typed into this form), with how many
   * clients use each — the source for suggestions. Nothing is stored separately. */
  private get knownCarriers(): { name: string; uses: number }[] {
    const byKey = new Map<string, { name: string; uses: number }>();
    for (const u of this.clients()) {
      const own = new Map<string, string>();
      for (const n of [...(u.carriers ?? []), ...(u.stateCarriers ?? []).flatMap((sc) => sc.carriers)]) {
        const name = n.trim();
        if (name) own.set(name.toLowerCase(), name);
      }
      for (const [key, name] of own) {
        const hit = byKey.get(key);
        if (hit) hit.uses += 1;
        else byKey.set(key, { name, uses: 1 });
      }
    }
    for (const name of this.carriers) {
      if (!byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), { name, uses: 0 });
    }
    return [...byKey.values()];
  }

  /** Typed text matched, ignoring case, to a carrier spelled that way before — so "aig" becomes "AIG". */
  private canonicalCarrier(typed: string): string {
    const name = typed.trim();
    return this.knownCarriers.find((k) => k.name.toLowerCase() === name.toLowerCase())?.name ?? name;
  }

  /** Up to eight previously used carriers matching what's typed, most used first, skipping the
   * ones already in the state (for the multi-state bar: already in every ticked state). */
  suggestionsFor(state: string | null): string[] {
    const inState = (name: string, st: string) => this.carriersFor(st).some((c) => c.name.toLowerCase() === name.toLowerCase());
    const q = this.draft(state).split(',').pop()!.trim().toLowerCase();
    return this.knownCarriers
      .filter((k) => !(state ? inState(k.name, state) : this.checkedStates.length > 0 && this.checkedStates.every((st) => inState(k.name, st))))
      .filter((k) => !q || k.name.toLowerCase().includes(q))
      .sort((x, y) => y.uses - x.uses || x.name.localeCompare(y.name))
      .slice(0, 8)
      .map((k) => k.name);
  }

  get stateAddOptions(): SelectOption[] {
    return this.usStates.filter((s) => !this.selectedStates.includes(s)).map((s) => ({ value: s, label: s }));
  }

  pickState(state: string): void {
    this.statePicker.set(state);
    if (state && !this.selectedStates.includes(state)) {
      this.toggleState(state);
      this.activeState = state;
    }
    setTimeout(() => this.statePicker.set(null));
  }

  toggleCheckedState(state: string): void {
    this.checkedStates = this.checkedStates.includes(state)
      ? this.checkedStates.filter((s) => s !== state)
      : [...this.checkedStates, state];
  }

  private addCarrier(states: string[], name: string): void {
    if (!name || !states.length) return;
    const next = { ...this.cellPlans };
    for (const state of states) {
      const existing = Object.keys(next).find((k) => k.toLowerCase() === `${state}|${name}`.toLowerCase());
      if (!existing) next[`${state}|${name}`] = [];
    }
    this.cellPlans = next;
    this.queuePlansAutoSave();
  }

  /** Removes one carrier from one state only. */
  removeCarrier(state: string, name: string): void {
    const { [`${state}|${name}`]: _removed, ...rest } = this.cellPlans;
    this.cellPlans = rest;
    this.queuePlansAutoSave();
  }

  plansIn(state: string, carrier: string): PlanType[] {
    return this.cellPlans[`${state}|${carrier}`] ?? [];
  }

  private get allPlans(): PlanType[] {
    return this.planOptions.map((o) => o.value);
  }

  private setPlans(entries: { state: string; carrier: string }[], plans: PlanType[]): void {
    const next = { ...this.cellPlans };
    for (const { state, carrier } of entries) next[`${state}|${carrier}`] = plans;
    this.cellPlans = next;
    this.queuePlansAutoSave();
  }

  /** One plan chip on one carrier in one state. */
  togglePlan(state: string, carrier: string, plan: PlanType): void {
    const current = this.plansIn(state, carrier);
    this.setPlans([{ state, carrier }], current.includes(plan) ? current.filter((p) => p !== plan) : [...current, plan]);
  }

  hasAllPlans(state: string, carrier: string): boolean {
    return this.plansIn(state, carrier).length === this.allPlans.length;
  }

  /** "All" on a carrier: every plan, or none if it already has them all. */
  toggleCarrierAllPlans(state: string, carrier: string): void {
    this.setPlans([{ state, carrier }], this.hasAllPlans(state, carrier) ? [] : this.allPlans);
  }

  stateFull(state: string): boolean {
    const list = this.carriersFor(state);
    return list.length > 0 && list.every((c) => c.plans.length === this.allPlans.length);
  }

  /** "All plans" on a state: every plan on every carrier in it, or none if already full. */
  toggleStateAllPlans(state: string): void {
    const entries = this.carriersFor(state).map((c) => ({ state, carrier: c.name }));
    this.setPlans(entries, this.stateFull(state) ? [] : this.allPlans);
  }

  /** Copies this state's carriers and plans onto every other licensed state. */
  copyStateToAll(source: string): void {
    const list = this.carriersFor(source);
    const next = Object.fromEntries(Object.entries(this.cellPlans).filter(([key]) => key.startsWith(`${source}|`)));
    for (const state of this.selectedStates) {
      if (state === source) continue;
      for (const c of list) next[`${state}|${c.name}`] = [...c.plans];
    }
    // Other states keep any carrier they already had that the source doesn't list.
    this.cellPlans = { ...this.cellPlans, ...next };
    this.queuePlansAutoSave();
  }

  /** Short label for a plan chip. */
  planShort(plan: PlanType): string {
    return { LEVEL: 'Level', GRADED: 'Graded', MODIFIED: 'Mod', GI: 'GI' }[plan];
  }

  /** Debounced auto-save for the detail modal's coverage editor — only while an existing
   * account is open (`selected()`); the create form saves everything together on submit.
   * Not private: also bound directly from the template on the online-bank-payment checkbox. */
  private queuePlansAutoSave(): void {
    this.plansDirty = true;
    this.queueCoverageAutoSave();
  }

  queueCoverageAutoSave(): void {
    if (!this.selected()) return;
    this.saveStatus.set('saving');
    if (this.coverageSaveTimer) clearTimeout(this.coverageSaveTimer);
    this.coverageSaveTimer = setTimeout(() => this.autoSaveCoverage(), 700);
  }

  async createUser(): Promise<void> {
    this.error.set(null);
    this.creating.set(true);
    try {
      const created = await this.userService.createUser({
        name: this.name.trim(),
        email: this.email.trim(),
        password: this.password,
        role: 'CLIENT',
        levelCost: this.levelCost,
        gradedCost: this.gradedCost,
        modifiedCost: this.modifiedCost,
        giCost: this.giCost,
        minimumPremium: this.minimumPremium,
        maxAge: this.maxAge,
        acceptsOnlineBankPayment: this.acceptsOnlineBankPayment,
        acceptedCards: this.acceptedCards,
        states: this.selectedStates,
        carriers: this.carriers,
        statePlans: this.statePlans,
      });
      this.clients.update((rows) => [...rows, created]);
      this.showCreate.set(false);
      this.notice.set(`Created ${created.name} as a client.`);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not create the client.'));
    } finally {
      this.creating.set(false);
    }
  }

  openDetail(user: AppUser): void {
    this.error.set(null);
    this.showResetPassword.set(false);
    this.newPassword = '';
    this.name = user.name;
    this.email = user.email;
    this.levelCost = user.levelCost ?? null;
    this.gradedCost = user.gradedCost ?? null;
    this.modifiedCost = user.modifiedCost ?? null;
    this.giCost = user.giCost ?? null;
    this.minimumPremium = user.minimumPremium ?? null;
    this.maxAge = user.maxAge ?? null;
    this.acceptsOnlineBankPayment = user.acceptsOnlineBankPayment ?? false;
    this.acceptedCards = user.acceptedCards ?? [];
    this.selectedStates = user.states ?? [];
    const plansByCell = new Map((user.statePlans ?? []).map((p) => [`${p.state}|${p.carrier}`, p.plans]));
    // Accounts saved before per-state plans existed: carriers listed for a state load with no plans
    // ticked — nothing is assumed about what they take.
    for (const sc of user.stateCarriers ?? []) {
      for (const carrier of sc.carriers) {
        if (!plansByCell.has(`${sc.state}|${carrier}`)) plansByCell.set(`${sc.state}|${carrier}`, []);
      }
    }
    this.cellPlans = Object.fromEntries(plansByCell);
    this.plansDirty = false;
    this.checkedStates = [];
    this.activeState = null;
    this.carrierDrafts = {};
    if (this.coverageSaveTimer) clearTimeout(this.coverageSaveTimer);
    this.coverageSaveTimer = null;
    if (this.detailSaveTimer) clearTimeout(this.detailSaveTimer);
    this.detailSaveTimer = null;
    this.inFlight = 0;
    this.saveStatus.set('idle');
    this.selected.set(user);
  }

  private beginSave(): void {
    if (this.inFlight++ === 0) this.saveFailed = false;
    this.error.set(null);
    this.saveStatus.set('saving');
  }

  private endSave(ok: boolean): void {
    if (!ok) this.saveFailed = true;
    if (--this.inFlight > 0) return;
    if (this.saveFailed) {
      this.saveStatus.set('idle');
      return;
    }
    this.saveStatus.set('saved');
    setTimeout(() => {
      if (this.saveStatus() === 'saved' && this.inFlight === 0) this.saveStatus.set('idle');
    }, 2500);
  }

  private applyUpdated(updated: AppUser): void {
    this.clients.update((rows) => rows.map((u) => (u.id === updated.id ? updated : u)));
    this.selected.set(updated);
  }

  /** Debounced auto-save for the account details, pricing and limits in the detail modal. */
  queueDetailSave(): void {
    if (!this.selected()) return;
    this.saveStatus.set('saving');
    if (this.detailSaveTimer) clearTimeout(this.detailSaveTimer);
    this.detailSaveTimer = setTimeout(() => void this.autoSaveDetails(), 800);
  }

  private profileChanged(user: AppUser): boolean {
    return this.name.trim() !== user.name || this.email.trim() !== user.email;
  }

  /** A half-typed name or email isn't sent — it saves once it is valid. */
  private profileValid(): boolean {
    return this.name.trim().length > 0 && /^\S+@\S+\.\S+$/.test(this.email.trim());
  }

  private pricingChanged(user: AppUser): boolean {
    const pairs: [number | null, number | null | undefined][] = [
      [this.levelCost, user.levelCost],
      [this.gradedCost, user.gradedCost],
      [this.modifiedCost, user.modifiedCost],
      [this.giCost, user.giCost],
      [this.minimumPremium, user.minimumPremium],
      [this.maxAge, user.maxAge],
    ];
    return pairs.some(([now, saved]) => (now ?? null) !== (saved ?? null));
  }

  /** Sends only the groups that actually differ from what's saved. */
  private async autoSaveDetails(): Promise<void> {
    this.detailSaveTimer = null;
    const user = this.selected();
    if (!user) return;

    const sendProfile = this.profileChanged(user) && this.profileValid();
    const sendPricing = this.pricingChanged(user);
    if (!sendProfile && !sendPricing) {
      // Nothing differs from what's saved (or the email isn't valid yet): drop the spinner
      // unless another save is still pending.
      if (this.inFlight === 0 && !this.coverageSaveTimer) this.saveStatus.set('idle');
      return;
    }

    this.beginSave();
    try {
      if (sendProfile) {
        this.applyUpdated(
          await this.userService.updateProfile(user.id, { name: this.name.trim(), email: this.email.trim() }),
        );
      }
      if (sendPricing) {
        this.applyUpdated(
          await this.userService.updatePricing(user.id, {
            levelCost: this.levelCost,
            gradedCost: this.gradedCost,
            modifiedCost: this.modifiedCost,
            giCost: this.giCost,
            minimumPremium: this.minimumPremium,
            maxAge: this.maxAge,
          }),
        );
      }
      this.endSave(true);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not save changes.'));
      this.endSave(false);
    }
  }

  /** Auto-saves licensed states + carrier roster + online-bank-payment acceptance from the
   * detail modal, debounced via queueCoverageAutoSave() so every toggle/add/remove doesn't
   * fire its own request. */
  private async autoSaveCoverage(): Promise<void> {
    const user = this.selected();
    if (!user) return;

    this.beginSave();
    const sendPlans = this.plansDirty;
    this.plansDirty = false;
    try {
      const updated = await this.userService.updateCoverage(user.id, {
        states: this.selectedStates,
        carriers: this.carriers,
        ...(sendPlans ? { statePlans: this.statePlans } : {}),
        acceptsOnlineBankPayment: this.acceptsOnlineBankPayment,
        acceptedCards: this.acceptedCards,
      });
      this.applyUpdated(updated);
      this.endSave(true);
    } catch (err) {
      if (sendPlans) this.plansDirty = true;
      this.error.set(apiErrorMessage(err, 'Could not update coverage.'));
      this.endSave(false);
    }
  }

  /** Flushes any pending debounced coverage / carrier-availability saves before the detail
   * modal closes, so a quick edit-then-close doesn't get dropped by the 700ms debounce
   * window. */
  async closeDetail(): Promise<void> {
    if (this.detailSaveTimer) {
      clearTimeout(this.detailSaveTimer);
      this.detailSaveTimer = null;
      await this.autoSaveDetails();
    }
    if (this.coverageSaveTimer) {
      clearTimeout(this.coverageSaveTimer);
      this.coverageSaveTimer = null;
      await this.autoSaveCoverage();
    }
    this.selected.set(null);
  }

  /** Leaving the page mid-debounce sends the pending save now instead of letting the
   * timer fire against a destroyed component — the edit is still saved, just immediately. */
  ngOnDestroy(): void {
    if (this.selected()) void this.closeDetail();
  }

  /** Determines whether Settings (not this modal) owns the "change password" affordance. */
  isSelf(user: AppUser): boolean {
    return user.id === this.currentUserId();
  }

  async resetPassword(): Promise<void> {
    const user = this.selected();
    if (!user || this.newPassword.length < 8) return;

    this.error.set(null);
    this.resettingPassword.set(true);
    try {
      const updated = await this.userService.resetPassword(user.id, this.newPassword);
      this.selected.set(updated);
      this.showResetPassword.set(false);
      this.newPassword = '';
      this.notice.set(`Password reset for ${updated.name}. They'll need to sign in again.`);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not reset the password.'));
    } finally {
      this.resettingPassword.set(false);
    }
  }
}
