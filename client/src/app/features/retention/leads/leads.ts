import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  LucideClock,
  LucidePhoneCall,
  LucideSend,
  LucideSquarePen,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { AuthService } from '../../../core/services/auth.service';
import { ZoomPhoneService } from '../../../core/services/zoom-phone.service';
import { Lead } from '../../../core/models/lead.model';
import { ListView, createListView } from '../../../core/list-view';
import { getAvatarTone, getInitials, pacificIsoDate, pacificToday, timeAgo } from '../../../core/format-utils';
import { DRAFT_REASON_LABEL } from '../../../core/lead-options';
import { EmptyState, Pagination, SearchBox, SkeletonRows, StatusBadge } from '../../../shared/ui/ui';
import { Select } from '../../../shared/ui/select';
import { Period, PeriodFilter, inPeriod } from '../../../shared/ui/period-filter';
import { NoCopy } from '../../../shared/no-copy.directive';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';
import { apiErrorMessage } from '../../../core/api';

/**
 * One page for the Retention team's leads: what still needs working on top (queue, drafts,
 * sent-back), what has already gone onward below. Both lists are the whole team's — any
 * Retention person can open and submit a teammate's lead — and both are masked like the
 * Closer's: no phone or carrier, only the customer, who worked it, and the outcome.
 */
type PendingTab = 'new' | 'drafts' | 'callbacks';

@Component({
  selector: 'app-retention-leads',
  imports: [
    FormsModule,
    RouterLink,
    Select,
    PeriodFilter,
    NoCopy,
    StatusBadge,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideSend,
    LucideClock,
    LucideSquarePen,
    LucidePhoneCall,
  ],
  templateUrl: './leads.html',
  styleUrl: './leads.css',
})
export class RetentionLeads implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.refresh());
  private readonly leadService = inject(LeadService);
  private readonly auth = inject(AuthService);
  private readonly zoom = inject(ZoomPhoneService);

  readonly pending = signal<Lead[]>([]);
  readonly allPast = signal<Lead[]>([]);
  readonly period = signal<Period>('day');
  readonly anchor = signal(pacificIsoDate(pacificToday()));
  /** History submitted inside the selected period; the pending backlog is never filtered. */
  readonly past = computed(() => inPeriod(this.allPast(), this.period(), this.anchor()));
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly currentUserId = computed(() => this.auth.user()?.id ?? null);
  /** '' = everyone, otherwise a specific teammate's user id — defaults to "me". */
  readonly teammateFilter = signal('');

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

  private readonly teammates = computed(() => {
    const seen = new Map<string, string>();
    for (const lead of this.pending()) {
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

  readonly pendingTabs = [
    { label: 'New Leads', value: 'new' },
    { label: 'Drafts', value: 'drafts' },
    { label: 'Callbacks', value: 'callbacks' },
  ] as const;
  readonly pendingTab = signal<PendingTab>('new');

  /** The server only returns callbacks the caller marked, so any callbackById here is "mine". */
  readonly pendingSplit = computed(() => {
    const filter = this.teammateFilter();
    const split: Record<PendingTab, Lead[]> = { new: [], drafts: [], callbacks: [] };
    for (const l of this.pending()) {
      if (l.callbackById) {
        // Callbacks ignore the teammate filter — they can sit on anyone's assignment.
        split.callbacks.push(l);
      } else if (!filter || l.retention?.id === filter) {
        split[l.status === 'DRAFT' ? 'drafts' : 'new'].push(l);
      }
    }
    return split;
  });

  private readonly pendingRows = computed(() => this.pendingSplit()[this.pendingTab()]);

  setPendingTab(tab: PendingTab): void {
    this.pendingTab.set(tab);
    this.pendingView.page.set(1);
  }

  readonly pendingView = createListView<Lead>({
    source: this.pendingRows,
    searchFields: (l) => [l.customerName, l.state, l.retention?.name],
    sorters: {
      customerName: (l) => l.customerName,
      createdAt: (l) => new Date(l.createdAt).getTime(),
      updatedAt: (l) => new Date(l.updatedAt ?? l.createdAt).getTime(),
    },
    initialSort: { key: 'updatedAt', dir: 'desc' },
    pageSize: 8,
  });

  readonly historyView = createListView<Lead>({
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

  async ngOnInit(): Promise<void> {
    // Default the filter to "assigned to me" once we know who's logged in.
    if (this.currentUserId()) this.teammateFilter.set(this.currentUserId()!);
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      const [pending, past] = await Promise.all([
        this.leadService.retentionQueue(),
        this.leadService.retentionHistory(),
      ]);
      this.pending.set(pending);
      this.allPast.set(past);
    } catch {
      this.error.set('Could not load the leads. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  readonly dialingId = signal<string | null>(null);

  /** The queue list is masked (no phone), so fetch the lead and hand the number straight to
   *  the dialer — it's never rendered on this page. */
  async dialLead(id: string): Promise<void> {
    this.dialingId.set(id);
    this.error.set(null);
    try {
      const lead = await this.leadService.getLead(id);
      if (!this.zoom.dial(lead.phone)) this.error.set(`${lead.customerName}'s phone number cannot be dialed.`);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not dial this lead.'));
    } finally {
      this.dialingId.set(null);
    }
  }

  /** One search box drives both lists. */
  setSearch(value: string): void {
    this.pendingView.setSearch(value);
    this.historyView.setSearch(value);
  }

  /** Why a draft was parked — the picked reason, or the typed note when the reason is "Other". */
  draftReasonText(lead: Lead): string | null {
    if (!lead.draftReason) return null;
    const label = DRAFT_REASON_LABEL[lead.draftReason];
    return lead.draftReasonNote ? `${label} — ${lead.draftReasonNote}` : label;
  }

  sortArrow(view: ListView<Lead>, key: string): string {
    if (view.sortKey() !== key) return '';
    return view.sortDir() === 'asc' ? '↑' : '↓';
  }
}
