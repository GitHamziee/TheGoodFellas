import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideBanknoteX,
  LucideBuilding2,
  LucideCircleCheck,
  LucideClock,
  LucideSquarePen,
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
import { EmptyState, Pagination, SearchBox, SkeletonRows, StatTile } from '../../../shared/ui/ui';
import { LeadDetail } from '../../../shared/lead-detail';

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

@Component({
  selector: 'app-admin-charge-backs',
  imports: [
    FormsModule,
    Modal,
    LeadDetail,
    StatTile,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideBanknoteX,
    LucideBuilding2,
    LucideCircleCheck,
    LucideUserCheck,
    LucideSquarePen,
    LucideClock,
  ],
  templateUrl: './charge-backs.html',
})
export class AdminChargeBacks implements OnInit {
  private readonly leadService = inject(LeadService);
  private readonly userService = inject(UserService);
  private readonly externalClientService = inject(ExternalClientService);

  readonly leads = signal<Lead[]>([]);
  readonly clients = signal<LookupUser[]>([]);
  readonly externalClients = signal<ExternalClient[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);

  /** Which lead each modal is acting on — only one is ever open at a time. */
  readonly detailLead = signal<Lead | null>(null);
  readonly assignLead = signal<Lead | null>(null);
  readonly assignExternalLead = signal<Lead | null>(null);
  readonly editLead = signal<Lead | null>(null);

  readonly clientSearch = signal('');
  readonly chosenClientId = signal('');
  readonly externalClientSearch = signal('');
  readonly chosenExternalClientId = signal('');
  readonly draft = signal<EditDraft | null>(null);

  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly formatPhone = formatPhone;
  readonly formatPkr = formatPkr;
  readonly timeAgo = timeAgo;

  readonly view = createListView<Lead>({
    source: this.leads,
    searchFields: (l) => [l.customerName, l.phone, l.state, l.closer?.name, l.chargeBacks[0]?.client?.name],
    sorters: {
      customerName: (l) => l.customerName,
      createdAt: (l) => new Date(l.updatedAt).getTime(),
    },
    initialSort: { key: 'createdAt', dir: 'desc' },
    pageSize: 10,
  });

  readonly stats = computed(() => {
    const rows = this.leads();
    return {
      total: rows.length,
      totalPkrAmount: rows.reduce((sum, l) => sum + (l.chargeBacks[0]?.pkrAmount ?? 0), 0),
    };
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
    const [clients, externalClients] = await Promise.all([
      this.userService.listClients(),
      this.externalClientService.list(),
      this.refresh(),
    ]);
    this.clients.set(clients);
    this.externalClients.set(externalClients);
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.leads.set(await this.leadService.chargeBacks());
    } catch {
      this.error.set('Could not load charged-back leads. Refresh to try again.');
    } finally {
      this.loading.set(false);
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
      // Reassigning moves the lead out of the charge-backs queue entirely.
      this.leads.update((rows) => rows.filter((l) => l.id !== lead.id));
      this.assignLead.set(null);
      this.notice.set(`${lead.customerName} reassigned to ${client?.name ?? 'client'}.`);
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
      await this.leadService.assignLeadExternal(lead.id, externalClientId);
      const externalClient = this.externalClients().find((c) => c.id === externalClientId);
      this.leads.update((rows) => rows.filter((l) => l.id !== lead.id));
      this.assignExternalLead.set(null);
      this.notice.set(`${lead.customerName} reassigned to ${externalClient?.name ?? 'external client'}.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not assign the lead.');
    } finally {
      this.busyId.set(null);
    }
  }

  // ─── Edit (charged-back leads only) ────────────────────────
  openEdit(lead: Lead, event?: Event): void {
    event?.stopPropagation();
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
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not save changes.');
    } finally {
      this.busyId.set(null);
    }
  }

  updateDraft<K extends keyof EditDraft>(key: K, value: string): void {
    this.draft.update((d) => (d ? { ...d, [key]: value } : d));
  }
}
