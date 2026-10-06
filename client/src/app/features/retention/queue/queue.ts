import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideClock, LucideSend, LucideSquarePen, LucideUsers } from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { AuthService } from '../../../core/services/auth.service';
import { Lead } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import { formatPhone, getAvatarTone, getInitials, timeAgo } from '../../../core/format-utils';
import { EmptyState, Pagination, SearchBox, SkeletonRows, StatTile, StatusBadge } from '../../../shared/ui/ui';
import { Select } from '../../../shared/ui/select';

/**
 * The whole Retention team's shared queue — every AI-sourced lead Admin has handed out and
 * not yet submitted. Deliberately not scoped to "my leads": any Retention person can filter
 * to a teammate and open, edit, and submit their lead too — team coverage, not individual
 * ownership. Defaults to "Assigned to me" since that's the common case, but "All" and any
 * specific teammate are one click away.
 */
@Component({
  selector: 'app-retention-queue',
  imports: [
    FormsModule,
    RouterLink,
    Select,
    StatTile,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    StatusBadge,
    LucideSend,
    LucideClock,
    LucideSquarePen,
    LucideUsers,
  ],
  templateUrl: './queue.html',
})
export class RetentionQueue implements OnInit {
  private readonly leadService = inject(LeadService);
  private readonly auth = inject(AuthService);

  readonly leads = signal<Lead[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly currentUserId = computed(() => this.auth.user()?.id ?? null);
  /** '' = everyone, otherwise a specific teammate's user id — defaults to "me". */
  readonly teammateFilter = signal('');

  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly formatPhone = formatPhone;
  readonly timeAgo = timeAgo;

  /** Teammates that actually appear in the queue — drives the filter dropdown. */
  private readonly teammates = computed(() => {
    const seen = new Map<string, string>();
    for (const lead of this.leads()) {
      if (lead.retention) seen.set(lead.retention.id, lead.retention.name);
    }
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });

  readonly teammateOptions = computed(() => [
    { value: '', label: 'All teammates' },
    ...this.teammates().map((t) => ({
      value: t.id,
      label: t.id === this.currentUserId() ? `${t.name} (me)` : t.name,
    })),
  ]);

  private readonly byTeammate = computed(() => {
    const filter = this.teammateFilter();
    const rows = this.leads();
    return filter ? rows.filter((l) => l.retention?.id === filter) : rows;
  });

  readonly view = createListView<Lead>({
    source: this.byTeammate,
    searchFields: (l) => [l.customerName, l.phone, l.state, l.carrierName, l.retention?.name],
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
    const mine = this.currentUserId();
    return {
      total: rows.length,
      mine: rows.filter((l) => l.retention?.id === mine).length,
      teammates: this.teammates().length,
    };
  });

  async ngOnInit(): Promise<void> {
    // Default the filter to "assigned to me" once we know who's logged in.
    if (this.currentUserId()) this.teammateFilter.set(this.currentUserId()!);
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.leads.set(await this.leadService.retentionQueue());
    } catch {
      this.error.set('Could not load the retention queue. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }
}
