import { AdminStatusBadge } from '../../../shared/ui/admin-status';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  LucideBanknoteArrowUp,
  LucideCircleCheck,
  LucideCircleX,
  LucideClock,
  LucideSend,
  LucideTarget,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { Lead } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import { getAvatarTone, getInitials, pacificIsoDate, pacificToday, timeAgo } from '../../../core/format-utils';
import { EmptyState, Pagination, SearchBox, SkeletonRows, StatTile, StatusBadge } from '../../../shared/ui/ui';
import { Period, PeriodFilter, inPeriod } from '../../../shared/ui/period-filter';
import { NoCopy } from '../../../shared/no-copy.directive';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';

/**
 * What the Retention team has already sent onward, by period — the team's outcome view.
 * Masked like the Closer's history: customer, who worked it, client and outcome only.
 */
@Component({
  selector: 'app-retention-history',
  imports: [AdminStatusBadge, 
    PeriodFilter,
    NoCopy,
    StatTile,
    StatusBadge,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideSend,
    LucideClock,
    LucideCircleCheck,
    LucideCircleX,
    LucideTarget,
    LucideBanknoteArrowUp,
  ],
  templateUrl: './history.html',
  styleUrl: './history.css',
})
export class RetentionHistory implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.refresh());
  private readonly leadService = inject(LeadService);

  readonly allPast = signal<Lead[]>([]);
  readonly period = signal<Period>('day');
  readonly anchor = signal(pacificIsoDate(pacificToday()));
  /** Charge-backs toggle: only leads that have ever been charged back, placed in the period
   *  by their latest charge-back date rather than when they were last worked. */
  readonly chargeBacksOnly = signal(false);
  readonly highlightId = signal<string | null>(inject(ActivatedRoute).snapshot.queryParamMap.get('highlight'));
  readonly past = computed(() =>
    this.chargeBacksOnly()
      ? inPeriod(
          this.allPast().filter((l) => l.chargeBacks?.length),
          this.period(),
          this.anchor(),
          (l) => l.chargeBacks[0].createdAt,
        )
      : inPeriod(this.allPast(), this.period(), this.anchor(), (l) => l.updatedAt ?? l.createdAt),
  );
  readonly chargeBackCount = computed(() =>
    inPeriod(
      this.allPast().filter((l) => l.chargeBacks?.length),
      this.period(),
      this.anchor(),
      (l) => l.chargeBacks[0].createdAt,
    ).length,
  );
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
  ];

  readonly view = createListView<Lead>({
    source: this.past,
    searchFields: (l) => [l.customerName, l.retention?.name, l.client?.name],
    statusOf: (l) => l.status,
    sorters: {
      customerName: (l) => l.customerName,
      status: (l) => l.status,
      createdAt: (l) => new Date(l.createdAt).getTime(),
      updatedAt: (l) => new Date(l.updatedAt ?? l.createdAt).getTime(),
    },
    initialSort: { key: 'updatedAt', dir: 'desc' },
    pageSize: 10,
  });

  readonly statusCounts = computed(() => {
    const rows = this.past();
    const counts: Record<string, number> = { '': rows.length };
    for (const f of this.statusFilters) if (f.value) counts[f.value] = 0;
    for (const l of rows) counts[l.status] = (counts[l.status] ?? 0) + 1;
    return counts;
  });

  readonly stats = computed(() => {
    const past = this.past();
    const accepted = past.filter((l) => l.status === 'ACCEPTED').length;
    const rejected = past.filter((l) => l.status === 'REJECTED').length;
    const decided = accepted + rejected;
    return {
      submitted: past.length,
      accepted,
      rejected,
      acceptRate: decided ? Math.round((accepted / decided) * 100) : null,
      chargedBack: past.filter((l) => l.status === 'CHARGED_BACK').length,
    };
  });

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      this.allPast.set(await this.leadService.retentionHistory());
      if (this.highlightId()) {
        setTimeout(() => document.getElementById('hl-' + this.highlightId())?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
        setTimeout(() => this.highlightId.set(null), 6000);
      }
    } catch {
      this.error.set('Could not load the history. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }
}
