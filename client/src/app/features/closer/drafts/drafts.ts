import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideArrowRight,
  LucideClock,
  LucideFileText,
  LucideMapPin,
  LucideNotebookPen,
  LucideSquarePen,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { Lead } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import { formatPhone, getAvatarTone, getInitials, timeAgo } from '../../../core/format-utils';
import { DRAFT_REASON_LABEL } from '../../../core/lead-options';
import { Modal } from '../../../shared/ui/modal';
import { EmptyState, Pagination, SearchBox, SkeletonRows, StatTile } from '../../../shared/ui/ui';
import { LeadDetail } from '../../../shared/lead-detail';

@Component({
  selector: 'app-closer-drafts',
  imports: [
    RouterLink,
    Modal,
    LeadDetail,
    StatTile,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideFileText,
    LucideClock,
    LucideMapPin,
    LucideSquarePen,
    LucideArrowRight,
    LucideNotebookPen,
  ],
  templateUrl: './drafts.html',
})
export class CloserDrafts implements OnInit {
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
    searchFields: (l) => [l.customerName, l.phone, l.state, l.draftReason],
    sorters: {
      customerName: (l) => l.customerName,
      updatedAt: (l) => new Date(l.updatedAt).getTime(),
    },
    initialSort: { key: 'updatedAt', dir: 'desc' },
    pageSize: 10,
  });

  readonly stats = computed(() => {
    const rows = this.leads();
    return {
      total: rows.length,
      states: new Set(rows.map((l) => l.state).filter(Boolean)).size,
    };
  });

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    try {
      this.leads.set(await this.leadService.drafts());
    } catch {
      this.error.set('Could not load your drafts. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }
}
