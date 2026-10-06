import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  LucideClock,
  LucideFileText,
  LucideNotebookPen,
  LucideTriangleAlert,
  LucideUsers,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { Lead } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import { formatPhone, getAvatarTone, getInitials, timeAgo } from '../../../core/format-utils';
import { DRAFT_REASON_LABEL } from '../../../core/lead-options';
import { Modal } from '../../../shared/ui/modal';
import { EmptyState, Pagination, SearchBox, SkeletonRows, StatTile } from '../../../shared/ui/ui';
import { LeadDetail } from '../../../shared/lead-detail';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';

@Component({
  selector: 'app-admin-drafts',
  imports: [
    Modal,
    LeadDetail,
    StatTile,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideFileText,
    LucideClock,
    LucideUsers,
    LucideTriangleAlert,
    LucideNotebookPen,
  ],
  templateUrl: './drafts.html',
})
export class AdminDrafts implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly leadService = inject(LeadService);

  readonly leads = signal<Lead[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selected = signal<Lead | null>(null);

  readonly formatPhone = formatPhone;
  readonly draftReasonLabel = DRAFT_REASON_LABEL;
  readonly timeAgo = timeAgo;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  readonly view = createListView<Lead>({
    source: this.leads,
    searchFields: (l) => [l.customerName, l.phone, l.state, l.draftReason, l.closer?.name],
    sorters: {
      customerName: (l) => l.customerName,
      updatedAt: (l) => new Date(l.updatedAt).getTime(),
    },
    initialSort: { key: 'updatedAt', dir: 'desc' },
    pageSize: 10,
  });

  readonly stats = computed(() => {
    const rows = this.leads();
    const closers = new Set(rows.map((l) => l.closer?.id).filter(Boolean));
    const oldest = rows.reduce((max, l) => Math.max(max, ageDays(l.updatedAt)), 0);
    return { total: rows.length, closers: closers.size, oldest };
  });

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }

  async ngOnInit(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      this.leads.set(await this.leadService.adminDrafts());
    } catch {
      this.error.set('Could not load drafts. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }
}

function ageDays(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24));
}
