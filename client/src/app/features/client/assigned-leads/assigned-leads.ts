import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideCircleCheck,
  LucideCircleX,
  LucideClock,
  LucideInbox,
  LucideLock,
  LucideMapPin,
  LucideThumbsDown,
  LucideThumbsUp,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { Lead } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import { getAvatarTone, getInitials, humanizeEnum, isToday, timeAgo } from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import { LeadDetail } from '../../../shared/lead-detail';
import { Detail, EmptyState, Pagination, SearchBox, SkeletonRows, StatTile } from '../../../shared/ui/ui';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';

@Component({
  selector: 'app-assigned-leads',
  imports: [
    FormsModule,
    Modal,
    LeadDetail,
    Detail,
    StatTile,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideInbox,
    LucideClock,
    LucideCircleCheck,
    LucideCircleX,
    LucideThumbsUp,
    LucideThumbsDown,
    LucideLock,
    LucideMapPin,
  ],
  templateUrl: './assigned-leads.html',
})
export class AssignedLeads implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.refresh());
  private readonly leadService = inject(LeadService);

  readonly leads = signal<Lead[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);

  readonly selected = signal<Lead | null>(null);
  /** Non-null while the reject dialog is collecting a reason. */
  readonly rejecting = signal<Lead | null>(null);
  rejectReason = '';

  readonly humanizeEnum = humanizeEnum;
  readonly timeAgo = timeAgo;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  readonly view = createListView<Lead>({
    source: this.leads,
    searchFields: (l) => [l.customerName, l.state, l.zipcode, l.need, l.closer?.name],
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
    const states = new Set(rows.map((l) => l.state).filter(Boolean));
    return {
      total: rows.length,
      today: rows.filter((l) => isToday(l.createdAt)).length,
      states: states.size,
    };
  });

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      this.leads.set(await this.leadService.assignedPreviews());
    } catch {
      this.error.set('Could not load your new leads. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }

  async accept(lead: Lead, event?: Event): Promise<void> {
    event?.stopPropagation();
    this.error.set(null);
    this.busyId.set(lead.id);
    try {
      await this.leadService.acceptLead(lead.id);
      // Accepting moves the lead to Lead History, so drop it from this list.
      this.leads.update((rows) => rows.filter((l) => l.id !== lead.id));
      this.selected.set(null);
      this.notice.set(`Accepted ${lead.customerName}. Full contact details are now in Lead History.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not accept the lead.');
    } finally {
      this.busyId.set(null);
    }
  }

  openReject(lead: Lead, event?: Event): void {
    event?.stopPropagation();
    this.error.set(null);
    this.rejectReason = '';
    this.rejecting.set(lead);
  }

  async confirmReject(): Promise<void> {
    const lead = this.rejecting();
    if (!lead) return;

    this.error.set(null);
    this.busyId.set(lead.id);
    try {
      await this.leadService.rejectLead(lead.id, this.rejectReason.trim() || undefined);
      this.leads.update((rows) => rows.filter((l) => l.id !== lead.id));
      this.rejecting.set(null);
      this.selected.set(null);
      this.notice.set(`Rejected ${lead.customerName}. It's gone back to the admin team.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not reject the lead.');
    } finally {
      this.busyId.set(null);
    }
  }
}
