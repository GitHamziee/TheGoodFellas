import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideCircleCheck, LucideInbox, LucideRefreshCw, LucideUserCheck } from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { UserService } from '../../../core/services/user.service';
import { Lead } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import { formatDateTime, formatPhone, getAvatarTone, getInitials } from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import { PageHero, EmptyState, Pagination, SearchBox, SkeletonRows } from '../../../shared/ui/ui';
import { LeadDetail } from '../../../shared/lead-detail';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';
import { apiErrorMessage } from '../../../core/api';

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
  imports: [PageHero, 
    FormsModule,
    Modal,
    LeadDetail,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideInbox,
    LucideRefreshCw,
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
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);

  readonly syncing = signal(false);

  readonly detailLead = signal<Lead | null>(null);
  /** Leads the assign modal is open for — one from a row button, or the ticked batch. */
  readonly assignLeads = signal<Lead[]>([]);
  readonly assigning = signal(false);
  readonly selectedIds = signal<Set<string>>(new Set());
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

  readonly selectedCount = computed(() => this.selectedIds().size);

  readonly allVisibleSelected = computed(() => {
    const rows = this.view.rows();
    return rows.length > 0 && rows.every((l) => this.selectedIds().has(l.id));
  });

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

  async syncSheet(): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    this.syncing.set(true);
    try {
      const r = await this.leadService.syncRetentionSheet();
      const skipped = r.invalid.length ? ` · ${r.invalid.length} skipped (rows ${r.invalid.slice(0, 10).map((i) => i.row).join(', ')}${r.invalid.length > 10 ? '…' : ''})` : '';
      this.notice.set(`${r.imported} new ${r.imported === 1 ? 'lead' : 'leads'} imported${skipped}`);
      await this.refresh();
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not sync the sheet.'));
    } finally {
      this.syncing.set(false);
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }

  isSelected(lead: Lead): boolean {
    return this.selectedIds().has(lead.id);
  }

  toggleSelect(lead: Lead): void {
    this.selectedIds.update((ids) => {
      const next = new Set(ids);
      if (next.has(lead.id)) next.delete(lead.id);
      else next.add(lead.id);
      return next;
    });
  }

  toggleSelectAllVisible(): void {
    const rows = this.view.rows();
    const allSelected = this.allVisibleSelected();
    this.selectedIds.update((ids) => {
      const next = new Set(ids);
      for (const lead of rows) {
        if (allSelected) next.delete(lead.id);
        else next.add(lead.id);
      }
      return next;
    });
  }

  clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  openAssign(lead: Lead, event?: Event): void {
    event?.stopPropagation();
    this.openAssignFor([lead]);
  }

  openBatchAssign(): void {
    const ids = this.selectedIds();
    this.openAssignFor(this.leads().filter((l) => ids.has(l.id)));
  }

  private openAssignFor(leads: Lead[]): void {
    if (leads.length === 0) return;
    this.error.set(null);
    this.personSearch.set('');
    this.chosenRetentionId.set('');
    this.assignLeads.set(leads);
  }

  async confirmAssign(): Promise<void> {
    const leads = this.assignLeads();
    const retentionId = this.chosenRetentionId();
    if (leads.length === 0 || !retentionId) return;

    this.error.set(null);
    this.assigning.set(true);
    try {
      const { count } = await this.leadService.batchAssignRetention(leads.map((l) => l.id), retentionId);
      const person = this.retentionPeople().find((p) => p.id === retentionId);
      // Assigning moves the leads into that person's Retention Queue — they leave this page.
      const assignedIds = new Set(leads.map((l) => l.id));
      this.leads.update((rows) => rows.filter((l) => !assignedIds.has(l.id)));
      this.selectedIds.update((ids) => new Set([...ids].filter((id) => !assignedIds.has(id))));
      this.assignLeads.set([]);
      const what = leads.length === 1 ? leads[0].customerName : `${count} ${count === 1 ? 'lead' : 'leads'}`;
      this.notice.set(`${what} assigned to ${person?.name ?? 'retention'}.`);
      // Anything skipped server-side (already assigned elsewhere) drops off on the reload.
      if (count < leads.length) await this.refresh();
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not assign the leads.'));
    } finally {
      this.assigning.set(false);
    }
  }
}
