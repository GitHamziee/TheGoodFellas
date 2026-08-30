import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideBuilding2, LucideCircleCheck, LucideMapPin, LucideUserPlus, LucideX } from '@lucide/angular';
import { ExternalClientService } from '../../../core/services/external-client.service';
import { ExternalClient } from '../../../core/models/external-client.model';
import { createListView } from '../../../core/list-view';
import { formatDate, getAvatarTone, getInitials } from '../../../core/format-utils';
import { US_STATES } from '../../../core/us-states';
import { Modal } from '../../../shared/ui/modal';
import { EmptyState, Pagination, SearchBox, SkeletonRows, StatTile } from '../../../shared/ui/ui';

interface Draft {
  name: string;
  company: string;
  email: string;
  phone: string;
  notes: string;
}

/** Mirrors the Clients page's pricing/coverage fields (see admin/clients/clients.ts) — an
 * external client is priced and licensed the same way a real CLIENT account is, it just has
 * no login. Unlike that page there's no per-field auto-save here: everything (profile,
 * pricing, coverage) saves together through one "Create"/"Save changes" button, matching this
 * page's existing simpler edit flow. */
@Component({
  selector: 'app-admin-external-clients',
  imports: [
    FormsModule,
    Modal,
    StatTile,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideBuilding2,
    LucideUserPlus,
    LucideCircleCheck,
    LucideMapPin,
    LucideX,
  ],
  templateUrl: './external-clients.html',
})
export class AdminExternalClients implements OnInit {
  private readonly externalClientService = inject(ExternalClientService);

  readonly externalClients = signal<ExternalClient[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly creating = signal(false);
  readonly saving = signal(false);

  readonly showCreate = signal(false);
  readonly selected = signal<ExternalClient | null>(null);
  readonly draft = signal<Draft | null>(null);

  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly formatDate = formatDate;

  name = '';
  company = '';
  email = '';
  phone = '';
  notes = '';
  levelCost: number | null = null;
  gradedCost: number | null = null;
  modifiedCost: number | null = null;
  giCost: number | null = null;
  /** Lowest monthly premium (USD) this external client will accept — same split as the four
   * plan costs above. */
  minimumPremium: number | null = null;
  /** Whether this external client can take payment via online bank transfer. */
  acceptsOnlineBankPayment = false;

  /** Licensed states. */
  readonly usStates = US_STATES;
  selectedStates: string[] = [];

  /** Which carriers this external client writes business through in each selected state —
   * same shape as the Clients page (see clients.ts for the full rationale). */
  stateCarriers: Record<string, string[]> = {};
  /** Which licensed state(s) the "Carriers by state" editor is currently showing/targeting —
   * checked states share whatever carrier gets typed next, so one carrier can be added to
   * several states at once. */
  carrierEditStates: string[] = [];
  carrierEditStateInput = '';

  readonly view = createListView<ExternalClient>({
    source: this.externalClients,
    searchFields: (c) => [c.name, c.company, c.email, c.phone],
    sorters: {
      name: (c) => c.name,
      company: (c) => c.company ?? '',
      createdAt: (c) => new Date(c.createdAt).getTime(),
    },
    initialSort: { key: 'name', dir: 'asc' },
    pageSize: 12,
  });

  readonly stats = computed(() => ({ total: this.externalClients().length }));

  canSubmitCreate(): boolean {
    return this.name.trim() !== '';
  }

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.externalClients.set(await this.externalClientService.list());
    } catch {
      this.error.set('Could not load external clients. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }

  private resetCoverageDraft(): void {
    this.minimumPremium = null;
    this.acceptsOnlineBankPayment = false;
    this.selectedStates = [];
    this.stateCarriers = {};
    this.carrierEditStates = [];
    this.carrierEditStateInput = '';
  }

  openCreate(): void {
    this.error.set(null);
    this.name = '';
    this.company = '';
    this.email = '';
    this.phone = '';
    this.notes = '';
    this.levelCost = null;
    this.gradedCost = null;
    this.modifiedCost = null;
    this.giCost = null;
    this.resetCoverageDraft();
    this.showCreate.set(true);
  }

  /** Toggles a state in/out of `selectedStates` — dropping a state also drops whatever
   * carriers were entered for it and unchecks it in the carrier editor if it was checked. */
  toggleState(state: string): void {
    const adding = !this.selectedStates.includes(state);
    this.selectedStates = adding ? [...this.selectedStates, state] : this.selectedStates.filter((s) => s !== state);
    if (!adding) {
      const { [state]: _removed, ...rest } = this.stateCarriers;
      this.stateCarriers = rest;
      this.carrierEditStates = this.carrierEditStates.filter((s) => s !== state);
    }
  }

  /** The client's overall carrier roster — derived, not typed directly: the union of
   * whatever carriers are entered across all its licensed states. */
  get carriers(): string[] {
    return [...new Set(Object.values(this.stateCarriers).flat())].sort((a, b) => a.localeCompare(b));
  }

  /** Licensed states in display order — used by the "Carriers by state" browse list. */
  get sortedSelectedStates(): string[] {
    return this.usStates.filter((s) => this.selectedStates.includes(s));
  }

  /** Checks/unchecks a state in the "Carriers by state" panel — multiple states can be
   * checked at once so a carrier typed next gets added to all of them in one go. */
  toggleCarrierEditState(state: string): void {
    this.carrierEditStates = this.carrierEditStates.includes(state)
      ? this.carrierEditStates.filter((s) => s !== state)
      : [...this.carrierEditStates, state];
    this.carrierEditStateInput = '';
  }

  carrierCountLabel(state: string): string {
    const count = (this.stateCarriers[state] ?? []).length;
    if (count === 0) return 'No carriers';
    return count === 1 ? '1 carrier' : `${count} carriers`;
  }

  addStateCarrier(): void {
    this.addStateCarrierValue(this.carrierEditStateInput);
    this.carrierEditStateInput = '';
  }

  /** Adds one carrier to every checked state, skipping states that already have it (a
   * case-insensitive match). */
  private addStateCarrierValue(raw: string): void {
    const states = this.carrierEditStates;
    if (!states.length) return;
    const value = raw.trim();
    if (!value) return;
    const next = { ...this.stateCarriers };
    for (const state of states) {
      const current = next[state] ?? [];
      if (current.some((c) => c.toLowerCase() === value.toLowerCase())) continue;
      next[state] = [...current, value];
    }
    this.stateCarriers = next;
  }

  onCarrierEditStateInputChange(value: string): void {
    if (!value.includes(',')) {
      this.carrierEditStateInput = value;
      return;
    }
    const segments = value.split(',');
    this.carrierEditStateInput = segments.pop() ?? '';
    for (const segment of segments) this.addStateCarrierValue(segment);
  }

  /** Only available when exactly one state is checked — with more than one checked, their
   * carrier sets aren't necessarily the same, so no single tag list is shown to remove from. */
  removeStateCarrier(carrier: string): void {
    if (this.carrierEditStates.length !== 1) return;
    const state = this.carrierEditStates[0];
    this.stateCarriers = { ...this.stateCarriers, [state]: (this.stateCarriers[state] ?? []).filter((c) => c !== carrier) };
  }

  async createExternalClient(): Promise<void> {
    this.error.set(null);
    this.creating.set(true);
    try {
      const created = await this.externalClientService.create({
        name: this.name.trim(),
        company: this.company.trim() || undefined,
        email: this.email.trim() || undefined,
        phone: this.phone.trim() || undefined,
        notes: this.notes.trim() || undefined,
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
      this.externalClients.update((rows) => [...rows, created]);
      this.showCreate.set(false);
      this.notice.set(`Created ${created.name}.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not create the external client.');
    } finally {
      this.creating.set(false);
    }
  }

  openDetail(client: ExternalClient): void {
    this.error.set(null);
    this.draft.set({
      name: client.name,
      company: client.company ?? '',
      email: client.email ?? '',
      phone: client.phone ?? '',
      notes: client.notes ?? '',
    });
    this.levelCost = client.levelCost ?? null;
    this.gradedCost = client.gradedCost ?? null;
    this.modifiedCost = client.modifiedCost ?? null;
    this.giCost = client.giCost ?? null;
    this.minimumPremium = client.minimumPremium ?? null;
    this.acceptsOnlineBankPayment = client.acceptsOnlineBankPayment ?? false;
    this.selectedStates = client.states ?? [];
    this.stateCarriers = Object.fromEntries((client.stateCarriers ?? []).map((sc) => [sc.state, sc.carriers]));
    this.carrierEditStates = [];
    this.carrierEditStateInput = '';
    this.selected.set(client);
  }

  updateDraft<K extends keyof Draft>(key: K, value: string): void {
    this.draft.update((d) => (d ? { ...d, [key]: value } : d));
  }

  async saveEdit(): Promise<void> {
    const client = this.selected();
    const draft = this.draft();
    if (!client || !draft) return;

    this.error.set(null);
    this.saving.set(true);
    try {
      const updated = await this.externalClientService.update(client.id, {
        name: draft.name.trim(),
        company: draft.company.trim(),
        email: draft.email.trim(),
        phone: draft.phone.trim(),
        notes: draft.notes.trim(),
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
      this.externalClients.update((rows) => rows.map((c) => (c.id === client.id ? updated : c)));
      this.selected.set(null);
      this.notice.set(`Saved changes to ${updated.name}.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not save changes.');
    } finally {
      this.saving.set(false);
    }
  }
}
