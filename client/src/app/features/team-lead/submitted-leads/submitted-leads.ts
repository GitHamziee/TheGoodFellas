import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { LucideClock, LucideLock, LucideSend } from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { TeamLeadLeadRow } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import {
  formatDateTime,
  getAvatarTone,
  getInitials,
  isThisMonth,
  isThisWeek,
  isToday,
  timeAgo,
} from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import { Detail, EmptyState, Pagination, SearchBox, SkeletonRows, StatTile } from '../../../shared/ui/ui';

type DateRange = '' | 'day' | 'week' | 'month';

@Component({
  selector: 'app-team-lead-submitted-leads',
  imports: [
    Modal,
    Detail,
    StatTile,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideSend,
    LucideClock,
    LucideLock,
  ],
  templateUrl: './submitted-leads.html',
})
export class TeamLeadSubmittedLeads implements OnInit {
  private readonly leadService = inject(LeadService);

  readonly leads = signal<TeamLeadLeadRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selected = signal<TeamLeadLeadRow | null>(null);

  readonly dateRange = signal<DateRange>('');

  readonly formatDateTime = formatDateTime;
  readonly timeAgo = timeAgo;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  readonly dateFilters: { label: string; value: DateRange }[] = [
    { label: 'All', value: '' },
    { label: 'Today', value: 'day' },
    { label: 'This week', value: 'week' },
    { label: 'This month', value: 'month' },
  ];

  /** Filtered by the day/week/month pill before search + pagination take over. */
  readonly dateFiltered = computed(() => {
    const range = this.dateRange();
    const rows = this.leads();
    if (range === 'day') return rows.filter((l) => isToday(l.createdAt));
    if (range === 'week') return rows.filter((l) => isThisWeek(l.createdAt));
    if (range === 'month') return rows.filter((l) => isThisMonth(l.createdAt));
    return rows;
  });

  readonly view = createListView<TeamLeadLeadRow>({
    source: this.dateFiltered,
    searchFields: (l) => [l.customerName, l.juniorCloser?.name, l.closer?.name],
    sorters: {
      customerName: (l) => l.customerName,
      createdAt: (l) => new Date(l.createdAt).getTime(),
      updatedAt: (l) => new Date(l.updatedAt ?? l.createdAt).getTime(),
    },
    initialSort: { key: 'updatedAt', dir: 'desc' },
    pageSize: 12,
  });

  readonly stats = computed(() => {
    const rows = this.leads();
    return {
      total: rows.length,
      today: rows.filter((l) => isToday(l.createdAt)).length,
      thisWeek: rows.filter((l) => isThisWeek(l.createdAt)).length,
      thisMonth: rows.filter((l) => isThisMonth(l.createdAt)).length,
    };
  });

  readonly dateCounts = computed(() => {
    const rows = this.leads();
    return {
      '': rows.length,
      day: rows.filter((l) => isToday(l.createdAt)).length,
      week: rows.filter((l) => isThisWeek(l.createdAt)).length,
      month: rows.filter((l) => isThisMonth(l.createdAt)).length,
    } as Record<string, number>;
  });

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    try {
      this.leads.set(await this.leadService.teamLeadSubmitted());
    } catch {
      this.error.set('Could not load submitted leads. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }
}
