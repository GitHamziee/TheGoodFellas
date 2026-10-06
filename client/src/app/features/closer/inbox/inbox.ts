import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideArrowRight,
  LucideClock,
  LucideInbox,
  LucideMapPin,
  LucideNotebookPen,
  LucideSquarePen,
  LucideTriangleAlert,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { LeadInboxPreview } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import { getAvatarTone, getInitials, humanizeEnum, isToday, timeAgo } from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import { Detail, EmptyState, Pagination, SearchBox, SkeletonRows, StatTile } from '../../../shared/ui/ui';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';

/** A lead sitting in the inbox longer than this is flagged as ageing. */
const STALE_AFTER_DAYS = 3;

@Component({
  selector: 'app-closer-inbox',
  imports: [
    RouterLink,
    Modal,
    Detail,
    StatTile,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideInbox,
    LucideClock,
    LucideTriangleAlert,
    LucideMapPin,
    LucideSquarePen,
    LucideArrowRight,
    LucideNotebookPen,
  ],
  templateUrl: './inbox.html',
})
export class CloserInbox implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly leadService = inject(LeadService);

  readonly leads = signal<LeadInboxPreview[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selected = signal<LeadInboxPreview | null>(null);

  readonly humanizeEnum = humanizeEnum;
  readonly timeAgo = timeAgo;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  readonly view = createListView<LeadInboxPreview>({
    source: this.leads,
    searchFields: (l) => [l.customerName, l.state, l.need, l.juniorCloser?.name],
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
      today: rows.filter((l) => isToday(l.createdAt)).length,
      stale: rows.filter((l) => this.ageInDays(l) >= STALE_AFTER_DAYS).length,
      states: new Set(rows.map((l) => l.state).filter(Boolean)).size,
    };
  });

  async ngOnInit(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      this.leads.set(await this.leadService.inbox());
    } catch {
      this.error.set('Could not load your inbox. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  ageInDays(lead: LeadInboxPreview): number {
    return Math.floor((Date.now() - new Date(lead.createdAt).getTime()) / 86400000);
  }

  isStale(lead: LeadInboxPreview): boolean {
    return this.ageInDays(lead) >= STALE_AFTER_DAYS;
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }
}
