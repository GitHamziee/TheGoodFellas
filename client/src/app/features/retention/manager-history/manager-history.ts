import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LucideBanknoteX, LucideCircleCheck, LucideClock, LucideSend, LucideSquarePen } from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { ManagerAction, ManagerHistoryRow } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import { getAvatarTone, getInitials, pacificIsoDate, pacificToday, timeAgo } from '../../../core/format-utils';
import { EmptyState, Pagination, SearchBox, SkeletonRows, StatTile, StatusBadge } from '../../../shared/ui/ui';
import { AdminStatusBadge } from '../../../shared/ui/admin-status';
import { Period, PeriodFilter, inPeriod } from '../../../shared/ui/period-filter';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';

const ACTION_LABEL: Record<ManagerAction, string> = {
  SUBMITTED: 'Sent to admin',
  EDITED: 'Edited',
  NOTED: 'Noted',
};

/**
 * The Retention Manager's own history: every Retention lead he has worked (sent to the admin,
 * edited, or left a note on), by the day he last acted, with what became of it since. The server
 * derives "his" leads from the audit trail — there is no per-lead manager column.
 */
@Component({
  selector: 'app-retention-manager-history',
  imports: [
    AdminStatusBadge,
    PeriodFilter,
    StatTile,
    StatusBadge,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideSend,
    LucideClock,
    LucideCircleCheck,
    LucideBanknoteX,
    LucideSquarePen,
  ],
  templateUrl: './manager-history.html',
  styleUrl: '../history/history.css',
})
export class RetentionManagerHistory implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.refresh());
  private readonly leadService = inject(LeadService);

  readonly allWorked = signal<ManagerHistoryRow[]>([]);
  readonly period = signal<Period>('day');
  readonly anchor = signal(pacificIsoDate(pacificToday()));
  readonly highlightId = signal<string | null>(inject(ActivatedRoute).snapshot.queryParamMap.get('highlight'));
  readonly worked = computed(() => inPeriod(this.allWorked(), this.period(), this.anchor(), (l) => l.workedAt));
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly timeAgo = timeAgo;

  readonly statusFilters = [
    { label: 'All', value: '' },
    { label: 'Submitted', value: 'SUBMITTED' },
    { label: 'Assigned', value: 'ASSIGNED' },
    { label: 'Approved', value: 'ACCEPTED' },
    { label: 'Declined', value: 'REJECTED' },
    { label: 'Charged back', value: 'CHARGED_BACK' },
  ];

  readonly view = createListView<ManagerHistoryRow>({
    source: this.worked,
    searchFields: (l) => [l.customerName, l.retention?.name, l.client?.name],
    statusOf: (l) => l.status,
    sorters: {
      customerName: (l) => l.customerName,
      status: (l) => l.status,
      workedAt: (l) => new Date(l.workedAt).getTime(),
    },
    initialSort: { key: 'workedAt', dir: 'desc' },
    pageSize: 10,
  });

  readonly statusCounts = computed(() => {
    const rows = this.worked();
    const counts: Record<string, number> = { '': rows.length };
    for (const f of this.statusFilters) if (f.value) counts[f.value] = 0;
    for (const l of rows) counts[l.status] = (counts[l.status] ?? 0) + 1;
    return counts;
  });

  readonly stats = computed(() => {
    const rows = this.worked();
    return {
      worked: rows.length,
      sent: rows.filter((l) => l.managerActions.includes('SUBMITTED')).length,
      accepted: rows.filter((l) => l.status === 'ACCEPTED').length,
      chargedBack: rows.filter((l) => l.status === 'CHARGED_BACK').length,
    };
  });

  actionLabel(action: ManagerAction): string {
    return ACTION_LABEL[action];
  }

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      this.allWorked.set(await this.leadService.retentionManagerHistory());
      if (this.highlightId()) {
        setTimeout(() => document.getElementById('hl-' + this.highlightId())?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
        setTimeout(() => this.highlightId.set(null), 6000);
      }
    } catch {
      this.error.set('Could not load your history. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }
}
