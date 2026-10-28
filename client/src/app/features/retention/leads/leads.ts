import { AdminStatusBadge } from '../../../shared/ui/admin-status';
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
import { getAvatarTone, getInitials, timeAgo } from '../../../core/format-utils';
import { DRAFT_REASON_LABEL } from '../../../core/lead-options';
import { EmptyState, SearchBox, SkeletonRows, StatusBadge } from '../../../shared/ui/ui';
import { Select } from '../../../shared/ui/select';
import { NoCopy } from '../../../shared/no-copy.directive';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';
import { apiErrorMessage } from '../../../core/api';

/**
 * The Retention team's work queue — new, drafts (incl. sent-back) and the caller's callbacks.
 * The whole team's list, since any Retention person can open and submit a teammate's lead;
 * masked like the Closer's (no phone or carrier). Shown in full, no pagination. What has
 * already gone onward lives on the History page.
 */
type PendingTab = 'new' | 'drafts' | 'callbacks';

@Component({
  selector: 'app-retention-leads',
  imports: [AdminStatusBadge, 
    FormsModule,
    RouterLink,
    Select,
    NoCopy,
    StatusBadge,
    SearchBox,
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
  /** Charge-backs toggle: this person's own leads that have ever been charged back (from the
   *  history feed — they've left the work queue, so there's nothing to open or dial). */
  readonly chargeBacksOnly = signal(false);
  private readonly chargeBackLeads = signal<Lead[]>([]);
  readonly chargeBackCount = computed(() => this.chargeBackLeads().length);
  /** Declined toggle: this person's leads a client turned down (also from the history feed). */
  readonly declinedOnly = signal(false);
  private readonly declinedLeads = signal<Lead[]>([]);
  readonly declinedCount = computed(() => this.declinedLeads().length);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly currentUserId = computed(() => this.auth.user()?.id ?? null);
  /** '' = everyone, otherwise a specific teammate's user id — defaults to "me". */
  readonly teammateFilter = signal('');

  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly timeAgo = timeAgo;

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

  private readonly pendingRows = computed(() =>
    this.chargeBacksOnly()
      ? this.chargeBackLeads()
      : this.declinedOnly()
        ? this.declinedLeads()
        : this.pendingSplit()[this.pendingTab()],
  );

  toggleChargeBacks(): void {
    this.chargeBacksOnly.update((v) => !v);
    this.declinedOnly.set(false);
    this.pendingView.page.set(1);
  }

  toggleDeclined(): void {
    this.declinedOnly.update((v) => !v);
    this.chargeBacksOnly.set(false);
    this.pendingView.page.set(1);
  }

  setPendingTab(tab: PendingTab): void {
    this.chargeBacksOnly.set(false);
    this.declinedOnly.set(false);
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
  });

  async ngOnInit(): Promise<void> {
    // Default the filter to "assigned to me" once we know who's logged in.
    if (this.currentUserId()) this.teammateFilter.set(this.currentUserId()!);
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      const [queue, history] = await Promise.all([this.leadService.retentionQueue(), this.leadService.retentionHistory()]);
      this.pending.set(queue);
      this.chargeBackLeads.set(history.filter((l) => l.chargeBacks?.length));
      this.declinedLeads.set(history.filter((l) => l.status === 'REJECTED'));
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
