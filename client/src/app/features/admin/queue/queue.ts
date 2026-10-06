import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideBuilding2,
  LucideCircleCheck,
  LucideCircleX,
  LucideClock,
  LucideListChecks,
  LucideSend,
  LucideSquarePen,
  LucideUndo2,
  LucideUserCheck,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { UserService } from '../../../core/services/user.service';
import { ExternalClientService } from '../../../core/services/external-client.service';
import { ExternalClient } from '../../../core/models/external-client.model';
import { Lead } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import { formatPhone, getAvatarTone, getInitials, timeAgo } from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import {
  EmptyState,
  Pagination,
  SearchBox,
  SkeletonRows,
  StatTile,
  StatusBadge,
} from '../../../shared/ui/ui';
import { LeadDetail } from '../../../shared/lead-detail';

interface LookupUser {
  id: string;
  name: string;
  email: string;
}

/** Fields an admin may correct on a rejected lead before reassigning it. */
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
  selector: 'app-admin-queue',
  imports: [
    FormsModule,
    Modal,
    LeadDetail,
    StatTile,
    StatusBadge,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideListChecks,
    LucideSend,
    LucideCircleX,
    LucideCircleCheck,
    LucideUserCheck,
    LucideSquarePen,
    LucideUndo2,
    LucideClock,
    LucideBuilding2,
  ],
  templateUrl: './queue.html',
})
export class AdminQueue implements OnInit {
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
  readonly returnLead = signal<Lead | null>(null);

  readonly clientSearch = signal('');
  readonly chosenClientId = signal('');
  readonly externalClientSearch = signal('');
  readonly chosenExternalClientId = signal('');
  readonly draft = signal<EditDraft | null>(null);

  /** Who to send the lead back to, and what they need to fix. Null only if a lead somehow
   *  has none of closer/junior closer/retention on it — the "Send back" action stays
   *  disabled in that case rather than guessing a target. A RETENTION lead only ever
   *  offers the RETENTION option (see queue.html) — it never has a closer or junior closer. */
  readonly returnTarget = signal<'JUNIOR_CLOSER' | 'CLOSER' | 'RETENTION' | null>(null);
  readonly returnReason = signal('');

  readonly statusFilters = [
    { label: 'All', value: '' },
    { label: 'Submitted', value: 'SUBMITTED' },
    { label: 'Rejected', value: 'REJECTED' },
  ];

  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly formatPhone = formatPhone;
  readonly timeAgo = timeAgo;

  readonly view = createListView<Lead>({
    source: this.leads,
    searchFields: (l) => [l.customerName, l.phone, l.state, l.closer?.name, l.juniorCloser?.name],
    statusOf: (l) => l.status,
    sorters: {
      customerName: (l) => l.customerName,
      createdAt: (l) => new Date(l.createdAt).getTime(),
      updatedAt: (l) => new Date(l.updatedAt ?? l.createdAt).getTime(),
    },
    initialSort: { key: 'updatedAt', dir: 'desc' },
    pageSize: 10,
  });

  readonly stats = computed(() => {
    const rows = this.leads();
    return {
      total: rows.length,
      submitted: rows.filter((l) => l.status === 'SUBMITTED').length,
      rejected: rows.filter((l) => l.status === 'REJECTED').length,
    };
  });

  readonly statusCounts = computed(() => {
    const rows = this.leads();
    return {
      '': rows.length,
      SUBMITTED: rows.filter((l) => l.status === 'SUBMITTED').length,
      REJECTED: rows.filter((l) => l.status === 'REJECTED').length,
    } as Record<string, number>;
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
      this.leads.set(await this.leadService.queue());
    } catch {
      this.error.set('Could not load the queue. Refresh to try again.');
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
    // Pre-select whoever the closer/retention person suggested — a convenience only, admin
    // can still pick someone else before confirming.
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
      await this.leadService.assignLead(lead.id, clientId);
      const client = this.clients().find((c) => c.id === clientId);
      // Assigning moves the lead out of the queue entirely.
      this.leads.update((rows) => rows.filter((l) => l.id !== lead.id));
      this.assignLead.set(null);
      this.notice.set(`${lead.customerName} assigned to ${client?.name ?? 'client'}.`);
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
      this.notice.set(`${lead.customerName} assigned to ${externalClient?.name ?? 'external client'}.`);
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
      await this.leadService.returnLead(lead.id, target, reason);
      // It's now with the junior closer or closer, so it leaves the admin queue.
      this.leads.update((rows) => rows.filter((l) => l.id !== lead.id));
      this.returnLead.set(null);
      const who =
        target === 'JUNIOR_CLOSER' ? lead.juniorCloser?.name
        : target === 'CLOSER' ? lead.closer?.name
        : lead.retention?.name;
      this.notice.set(`${lead.customerName} sent back to ${who ?? 'the team'} to fix.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not send the lead back.');
    } finally {
      this.busyId.set(null);
    }
  }

  // ─── Edit (rejected leads only) ────────────────────────────
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
