import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideCircleCheck, LucideClock, LucideSquarePen, LucideUndo2 } from '@lucide/angular';
import { LeadIntakeEdit } from '../../../core/models/lead.model';
import { LeadService } from '../../../core/services/lead.service';
import { createListView } from '../../../core/list-view';
import { formatPhone, timeAgo } from '../../../core/format-utils';
import { EmptyState, Pagination, SearchBox, SkeletonRows } from '../../../shared/ui/ui';
import { reloadOnChange } from '../../../core/live-reload';

/**
 * Leads the admin sent back to this junior closer to correct. Editing reuses the intake
 * form at /junior/leads/:id/edit, which switches into correction mode when it has an :id.
 */
@Component({
  selector: 'app-junior-returned',
  imports: [
    RouterLink,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideUndo2,
    LucideSquarePen,
    LucideCircleCheck,
    LucideClock,
  ],
  templateUrl: './returned.html',
})
export class JuniorReturned implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly leadService = inject(LeadService);

  readonly leads = signal<LeadIntakeEdit[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly formatPhone = formatPhone;
  readonly timeAgo = timeAgo;

  readonly view = createListView<LeadIntakeEdit>({
    source: this.leads,
    searchFields: (l) => [l.customerName, l.phone, l.state, l.returnReason],
    sorters: {
      customerName: (l) => l.customerName,
      createdAt: (l) => new Date(l.createdAt).getTime(),
      updatedAt: (l) => new Date(l.updatedAt ?? l.createdAt).getTime(),
    },
    initialSort: { key: 'updatedAt', dir: 'desc' },
    pageSize: 10,
  });

  async ngOnInit(): Promise<void> {
    try {
      this.leads.set(await this.leadService.myReturnedLeads());
    } catch {
      this.error.set('Could not load these leads. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }
}
