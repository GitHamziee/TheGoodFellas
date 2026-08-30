import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideBanknote,
  LucideBriefcase,
  LucideBuilding2,
  LucideCircleCheck,
  LucideKeyRound,
  LucideMapPin,
  LucideSave,
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
import { EmptyState, Pagination, SearchBox, SkeletonRows, StatTile } from '../../../shared/ui/ui';

const ROLE_TONE: Record<Role, string> = {
  ADMIN: 'tone-b',
  CLOSER: 'tone-c',
  JUNIOR_CLOSER: 'tone-d',
  CLIENT: 'tone-f',
  TEAM_LEAD: 'tone-e',
  QA_JUNIOR_CLOSER: 'tone-info',
  QA_CLOSER: 'tone-neutral',
  RETENTION: 'tone-a',
};

/** Admin's roster of CLIENT accounts — pricing, licensed states, and carrier availability
 * only ever apply to this role, so this page owns that whole editor. Internal staff accounts
 * (Junior Closer/Closer/Admin/Team Lead) live on the separate Team page instead. */
@Component({
  selector: 'app-admin-clients',
  imports: [
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
    LucideMapPin,
    LucideSave,
    LucideCircleCheck,
    LucideKeyRound,
    LucideBuilding2,
    LucideX,
  ],
  templateUrl: './clients.html',
})
export class AdminClients implements OnInit {
  private readonly userService = inject(UserService);
  private readonly auth = inject(AuthService);

  readonly clients = signal<AppUser[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly creating = signal(false);
  readonly resettingPassword = signal(false);
  readonly savingPricing = signal(false);
  readonly savingProfile = signal(false);
  /** Licensed states + carriers auto-save on every change while the detail modal is open
   * (see toggleState/addCarrier/removeCarrier) — no separate "Save coverage" button to
   * remember to click. This just reflects that in-flight/settled state near the fields. */
  readonly coverageStatus = signal<'idle' | 'saving' | 'saved'>('idle');
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
  phone = '';
  newPassword = '';

  /** Per-plan lead cost (USD), on both the create form and the detail modal's pricing editor. */
  levelCost: number | null = null;
  gradedCost: number | null = null;
  modifiedCost: number | null = null;
  giCost: number | null = null;
  /** Lowest monthly premium (USD) this client will accept — same pricing-editor split. */
  minimumPremium: number | null = null;

  /** Whether this client can take payment via online bank transfer. Auto-saves through the
   * coverage editor on the detail modal, same as states/carriers below. */
  acceptsOnlineBankPayment = false;

  /** Licensed states. Same create-form / detail-modal split as the pricing fields above. */
  readonly usStates = US_STATES;
  selectedStates: string[] = [];

  /** Which carriers this client writes business through in each selected state — e.g.
   * Sunrise writes NRG in Alaska but MPG in Alabama. Keyed by state; each state's list is
   * independent freehand text, entered only for whichever state(s) are currently checked
   * (`carrierEditStates`) — carriers typed for one state never leak into another unless
   * multiple states are checked at once. On the detail modal, edits auto-save per state via
   * a small debounce (see addStateCarrierValue/removeStateCarrier). */
  stateCarriers: Record<string, string[]> = {};
  /** Which licensed state(s) the "Carrier availability by state" editor is currently
   * showing/targeting — checked states share whatever carrier gets typed next, so one
   * carrier (e.g. a carrier newly licensed region-wide) can be added to several states in
   * one go instead of repeating the same entry per state. The existing-carriers tag list
   * only renders when exactly one state is checked, since with more than one selected their
   * carrier sets aren't necessarily the same and showing one would be misleading. */
  carrierEditStates: string[] = [];
  carrierEditStateInput = '';
  /** States with unsaved carrier changes, flushed together on the debounce timer. */
  private dirtyStateCarriers = new Set<string>();
  private stateCarrierSaveTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.loading.set(true);
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
    this.phone = '';
    this.levelCost = null;
    this.gradedCost = null;
    this.modifiedCost = null;
    this.giCost = null;
    this.minimumPremium = null;
    this.acceptsOnlineBankPayment = false;
    this.selectedStates = [];
    this.stateCarriers = {};
    this.carrierEditStates = [];
    this.carrierEditStateInput = '';
    this.dirtyStateCarriers.clear();
    if (this.stateCarrierSaveTimer) clearTimeout(this.stateCarrierSaveTimer);
    this.stateCarrierSaveTimer = null;
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
      const { [state]: _removed, ...rest } = this.stateCarriers;
      this.stateCarriers = rest;
      this.carrierEditStates = this.carrierEditStates.filter((s) => s !== state);
    }
    this.queueCoverageAutoSave();
  }

  /** The client's overall carrier roster — derived, not typed directly: the union of
   * whatever carriers are entered across all its licensed states. Sent to the server so
   * `User.carriers` stays in sync, but there is no standalone "type a carrier" field for it
   * any more — that used to be a second, disconnected place to enter the same kind of data
   * and was a source of confusion. */
  get carriers(): string[] {
    return [...new Set(Object.values(this.stateCarriers).flat())].sort((a, b) => a.localeCompare(b));
  }

  /** Licensed states in display order (alphabetical, matching `usStates`) — used by the
   * "Carriers by state" browse list so row order doesn't jump around as states are added. */
  get sortedSelectedStates(): string[] {
    return this.usStates.filter((s) => this.selectedStates.includes(s));
  }

  /** Checks/unchecks a state in the "Carriers by state" panel — pure navigation, never a
   * data change. Multiple states can be checked at once so a carrier typed next gets added
   * to all of them in one go, instead of repeating the same entry per state. */
  toggleCarrierEditState(state: string): void {
    this.carrierEditStates = this.carrierEditStates.includes(state)
      ? this.carrierEditStates.filter((s) => s !== state)
      : [...this.carrierEditStates, state];
    this.carrierEditStateInput = '';
  }

  /** Human label for a state's carrier count, e.g. "2 carriers" / "No carriers" — used by
   * the browse list on the left of the "Carriers by state" panel. */
  carrierCountLabel(state: string): string {
    const count = (this.stateCarriers[state] ?? []).length;
    if (count === 0) return 'No carriers';
    return count === 1 ? '1 carrier' : `${count} carriers`;
  }

  /** Carriers for the currently checked state(s) (`carrierEditStates`) — has no fixed list,
   * typed manually the same way the general roster above does. */
  addStateCarrier(): void {
    this.addStateCarrierValue(this.carrierEditStateInput);
    this.carrierEditStateInput = '';
  }

  /** Adds one carrier to every checked state, skipping states that already have it (a
   * case-insensitive match) rather than erroring — the common case is broadening a carrier
   * to a few more states, not renaming one that's already there. */
  private addStateCarrierValue(raw: string): void {
    const states = this.carrierEditStates;
    if (!states.length) return;
    const value = raw.trim();
    if (!value) return;
    const next = { ...this.stateCarriers };
    let changed = false;
    for (const state of states) {
      const current = next[state] ?? [];
      if (current.some((c) => c.toLowerCase() === value.toLowerCase())) continue;
      next[state] = [...current, value];
      this.dirtyStateCarriers.add(state);
      changed = true;
    }
    if (!changed) return;
    this.stateCarriers = next;
    this.scheduleStateCarrierAutoSave();
  }

  /** Same comma-splitting UX as the general roster's onCarrierInputChange. */
  onCarrierEditStateInputChange(value: string): void {
    if (!value.includes(',')) {
      this.carrierEditStateInput = value;
      return;
    }
    const segments = value.split(',');
    this.carrierEditStateInput = segments.pop() ?? '';
    for (const segment of segments) this.addStateCarrierValue(segment);
  }

  /** Only available when exactly one state is checked — see the `carrierEditStates` doc for
   * why the tag list (and so its remove button) doesn't render otherwise. */
  removeStateCarrier(carrier: string): void {
    if (this.carrierEditStates.length !== 1) return;
    const state = this.carrierEditStates[0];
    this.stateCarriers = { ...this.stateCarriers, [state]: (this.stateCarriers[state] ?? []).filter((c) => c !== carrier) };
    this.dirtyStateCarriers.add(state);
    this.scheduleStateCarrierAutoSave();
  }

  /** Debounced auto-save for whatever states are in `dirtyStateCarriers` — only while an
   * existing account is open (`selected()`); the create form saves everything together on
   * submit. One shared debounce rather than one per state, so adding a carrier to several
   * checked states at once flushes them together instead of firing a request per state. */
  private scheduleStateCarrierAutoSave(): void {
    if (!this.selected()) return;
    this.coverageStatus.set('idle');
    if (this.stateCarrierSaveTimer) clearTimeout(this.stateCarrierSaveTimer);
    this.stateCarrierSaveTimer = setTimeout(() => this.flushStateCarrierSaves(), 700);
  }

  private async flushStateCarrierSaves(): Promise<void> {
    const user = this.selected();
    if (!user || this.dirtyStateCarriers.size === 0) return;

    const states = [...this.dirtyStateCarriers];
    this.dirtyStateCarriers.clear();
    this.coverageStatus.set('saving');
    try {
      let updated = user;
      for (const state of states) {
        updated = await this.userService.updateStateCarriers(user.id, state, this.stateCarriers[state] ?? []);
      }
      this.clients.update((rows) => rows.map((u) => (u.id === user.id ? updated : u)));
      this.selected.set(updated);
      this.coverageStatus.set('saved');
      setTimeout(() => {
        if (this.coverageStatus() === 'saved') this.coverageStatus.set('idle');
      }, 2500);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not update carrier availability.');
      this.coverageStatus.set('idle');
    }
  }

  /** Debounced auto-save for the detail modal's coverage editor — only while an existing
   * account is open (`selected()`); the create form saves everything together on submit.
   * Not private: also bound directly from the template on the online-bank-payment checkbox. */
  queueCoverageAutoSave(): void {
    if (!this.selected()) return;
    this.coverageStatus.set('idle');
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
        phone: this.phone.trim() || undefined,
        levelCost: this.levelCost,
        gradedCost: this.gradedCost,
        modifiedCost: this.modifiedCost,
        giCost: this.giCost,
        minimumPremium: this.minimumPremium,
        acceptsOnlineBankPayment: this.acceptsOnlineBankPayment,
        states: this.selectedStates,
        carriers: this.carriers,
        stateCarriers: Object.entries(this.stateCarriers).map(([state, carriers]) => ({ state, carriers })),
      });
      this.clients.update((rows) => [...rows, created]);
      this.showCreate.set(false);
      this.notice.set(`Created ${created.name} as a client.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not create the client.');
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
    this.phone = user.phone ?? '';
    this.levelCost = user.levelCost ?? null;
    this.gradedCost = user.gradedCost ?? null;
    this.modifiedCost = user.modifiedCost ?? null;
    this.giCost = user.giCost ?? null;
    this.minimumPremium = user.minimumPremium ?? null;
    this.acceptsOnlineBankPayment = user.acceptsOnlineBankPayment ?? false;
    this.selectedStates = user.states ?? [];
    this.stateCarriers = Object.fromEntries((user.stateCarriers ?? []).map((sc) => [sc.state, sc.carriers]));
    this.carrierEditStates = [];
    this.carrierEditStateInput = '';
    this.dirtyStateCarriers.clear();
    if (this.stateCarrierSaveTimer) clearTimeout(this.stateCarrierSaveTimer);
    this.stateCarrierSaveTimer = null;
    if (this.coverageSaveTimer) clearTimeout(this.coverageSaveTimer);
    this.coverageSaveTimer = null;
    this.coverageStatus.set('idle');
    this.selected.set(user);
  }

  /** Saves name/email/phone from the detail modal — the client has no self-service way to
   * fix these (Settings is password-change only), so this is the only edit path. */
  async saveProfile(): Promise<void> {
    const user = this.selected();
    if (!user) return;

    this.error.set(null);
    this.savingProfile.set(true);
    try {
      const updated = await this.userService.updateProfile(user.id, {
        name: this.name.trim(),
        email: this.email.trim(),
        phone: this.phone.trim() || null,
      });
      this.clients.update((rows) => rows.map((u) => (u.id === user.id ? updated : u)));
      this.selected.set(updated);
      this.notice.set(`Updated details for ${updated.name}.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not update account details.');
    } finally {
      this.savingProfile.set(false);
    }
  }

  /** Saves the per-plan lead cost + minimum premium from the detail modal. */
  async savePricing(): Promise<void> {
    const user = this.selected();
    if (!user) return;

    this.error.set(null);
    this.savingPricing.set(true);
    try {
      const updated = await this.userService.updatePricing(user.id, {
        levelCost: this.levelCost,
        gradedCost: this.gradedCost,
        modifiedCost: this.modifiedCost,
        giCost: this.giCost,
        minimumPremium: this.minimumPremium,
      });
      this.clients.update((rows) => rows.map((u) => (u.id === user.id ? updated : u)));
      this.selected.set(updated);
      this.notice.set(`Updated plan pricing for ${updated.name}.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not update plan pricing.');
    } finally {
      this.savingPricing.set(false);
    }
  }

  /** Auto-saves licensed states + carrier roster + online-bank-payment acceptance from the
   * detail modal, debounced via queueCoverageAutoSave() so every toggle/add/remove doesn't
   * fire its own request. */
  private async autoSaveCoverage(): Promise<void> {
    const user = this.selected();
    if (!user) return;

    this.error.set(null);
    this.coverageStatus.set('saving');
    try {
      const updated = await this.userService.updateCoverage(user.id, {
        states: this.selectedStates,
        carriers: this.carriers,
        acceptsOnlineBankPayment: this.acceptsOnlineBankPayment,
      });
      this.clients.update((rows) => rows.map((u) => (u.id === user.id ? updated : u)));
      this.selected.set(updated);
      this.coverageStatus.set('saved');
      setTimeout(() => {
        if (this.coverageStatus() === 'saved') this.coverageStatus.set('idle');
      }, 2500);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not update coverage.');
      this.coverageStatus.set('idle');
    }
  }

  /** Flushes any pending debounced coverage / carrier-availability saves before the detail
   * modal closes, so a quick edit-then-close doesn't get dropped by the 700ms debounce
   * window. */
  async closeDetail(): Promise<void> {
    if (this.coverageSaveTimer) {
      clearTimeout(this.coverageSaveTimer);
      this.coverageSaveTimer = null;
      await this.autoSaveCoverage();
    }
    if (this.stateCarrierSaveTimer) {
      clearTimeout(this.stateCarrierSaveTimer);
      this.stateCarrierSaveTimer = null;
      await this.flushStateCarrierSaves();
    }
    this.selected.set(null);
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
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not reset the password.');
    } finally {
      this.resettingPassword.set(false);
    }
  }
}
