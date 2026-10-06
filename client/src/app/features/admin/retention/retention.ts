import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideCircleCheck, LucideInbox, LucideUserCheck } from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { UserService } from '../../../core/services/user.service';
import { Lead } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import { formatDateTime, formatPhone, getAvatarTone, getInitials } from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import { EmptyState, Pagination, SearchBox, SkeletonRows, StatTile } from '../../../shared/ui/ui';
import { LeadDetail } from '../../../shared/lead-detail';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';

interface LookupUser {
  id: string;
  name: string;
  email: string;
}

/** Admin's landing spot for AI-sourced leads: whoever worked the call submits it through the
 * public retention intake form, unassigned, then admin hands each one to a Retention person
 * here. Once assigned, it moves into that person's Retention Queue — this page never shows
 * assigned leads again. */
@Component({
  selector: 'app-admin-retention',
  imports: [
    FormsModule,
    Modal,
    LeadDetail,
    StatTile,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideInbox,
    LucideCircleCheck,
    LucideUserCheck,
  ],
  templateUrl: './retention.html',
})
export class AdminRetention implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.refresh());
  private readonly leadService = inject(LeadService);
  private readonly userService = inject(UserService);

  readonly leads = signal<Lead[]>([]);
  readonly retentionPeople = signal<LookupUser[]>([]);
  readonly loading = signal(true);
  readonly busyId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);

  readonly detailLead = signal<Lead | null>(null);
  readonly assignLead = signal<Lead | null>(null);
  readonly personSearch = signal('');
  readonly chosenRetentionId = signal('');

  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly formatPhone = formatPhone;
  readonly formatDateTime = formatDateTime;

  readonly view = createListView<Lead>({
    source: this.leads,
    searchFields: (l) => [l.customerName, l.phone, l.state, l.carrierName],
    sorters: {
      customerName: (l) => l.customerName,
      createdAt: (l) => new Date(l.createdAt).getTime(),
      updatedAt: (l) => new Date(l.updatedAt ?? l.createdAt).getTime(),
    },
    initialSort: { key: 'updatedAt', dir: 'desc' },
    pageSize: 12,
  });

  readonly stats = computed(() => ({ total: this.leads().length }));

  readonly filteredPeople = computed(() => {
    const term = this.personSearch().trim().toLowerCase();
    if (!term) return this.retentionPeople();
    return this.retentionPeople().filter(
      (p) => p.name.toLowerCase().includes(term) || p.email.toLowerCase().includes(term)
    );
  });

  async ngOnInit(): Promise<void> {
    const [people] = await Promise.all([this.userService.listRetention(), this.refresh()]);
    this.retentionPeople.set(people);
  }

  async refresh(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      this.leads.set(await this.leadService.retentionUnassigned());
    } catch {
      this.error.set('Could not load unassigned retention leads. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }

  openAssign(lead: Lead, event?: Event): void {
    event?.stopPropagation();
    this.error.set(null);
    this.personSearch.set('');
    this.chosenRetentionId.set('');
    this.assignLead.set(lead);
  }

  async confirmAssign(): Promise<void> {
    const lead = this.assignLead();
    const retentionId = this.chosenRetentionId();
    if (!lead || !retentionId) return;

    this.error.set(null);
    this.busyId.set(lead.id);
    try {
      await this.leadService.assignRetention(lead.id, retentionId);
      const person = this.retentionPeople().find((p) => p.id === retentionId);
      // Assigning moves the lead into that person's Retention Queue — it leaves this page.
      this.leads.update((rows) => rows.filter((l) => l.id !== lead.id));
      this.assignLead.set(null);
      this.notice.set(`${lead.customerName} assigned to ${person?.name ?? 'retention'}.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not assign the lead.');
    } finally {
      this.busyId.set(null);
    }
  }
}
