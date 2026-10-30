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
import { highlightFromQuery } from '../../../core/highlight';
import { ListView, createListView } from '../../../core/list-view';
import { getAvatarTone, getInitials, timeAgo } from '../../../core/format-utils';
import { DRAFT_REASON_LABEL } from '../../../core/lead-options';
import { EmptyState, SearchBox, SkeletonRows, StatusBadge } from '../../../shared/ui/ui';
import { Select } from '../../../shared/ui/select';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';
import { apiErrorMessage } from '../../../core/api';

/**
 * The Retention team's work queue — new, drafts (incl. sent-back) and the caller's callbacks.
 * The whole team's list, since any Retention person can open and submit a teammate's lead;
 * masked like the Closer's (no phone or carrier). Shown in full, no pagination. What has
 * already gone onward lives on the History page.
 */
type PendingTab = 'new' | 'drafts' | 'callbacks';

/** An admin/client rejection sends a Retention lead back to the queue as RETURNED_TO_RETENTION
 *  with a rejectionReason (cleared on resubmit) — that is what separates it from a sent-back
 *  or charge-back return, and it belongs under Declined, not New Leads. */
const isRejected = (l: Lead): boolean => l.status === 'RETURNED_TO_RETENTION' && !!l.rejectionReason;

@Component({
  selector: 'app-retention-leads',
  imports: [AdminStatusBadge, 
    FormsModule,
    RouterLink,
    Select,
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
  private readonly ownChargeBacks = signal<Lead[]>([]);
  /** Teammates' draft-1 charge-backs (shared with the whole team) — only those still to rework. */
  private readonly sharedChargeBacks = signal<Lead[]>([]);
  /** Follows the teammate filter like New Leads / Drafts / Declined: "me" = own, a teammate or
   *  "All teammates" brings in the shared ones too. */
  private readonly chargeBackLeads = computed(() => {
    const filter = this.teammateFilter();
    const seen = new Set<string>();
    return [...this.ownChargeBacks(), ...this.sharedChargeBacks()].filter((l) => {
      if (seen.has(l.id) || (filter && l.retention?.id !== filter)) return false;
      seen.add(l.id);
      return true;
    });
  });
  readonly chargeBackCount = computed(() => this.chargeBackLeads().length);
  /** Declined toggle: leads an admin/client turned down, back in the queue for a re-write.
   *  Follows the teammate filter like New Leads and Drafts. */
  readonly declinedOnly = signal(false);
  readonly declinedCount = computed(() => this.pendingSplit().declined.length);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly currentUserId = computed(() => this.auth.user()?.id ?? null);
  /** '' = everyone, otherwise a specific teammate's user id — defaults to "me". */
  readonly teammateFilter = signal('');

  readonly isRejected = isRejected;
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
    const split: Record<PendingTab | 'declined', Lead[]> = { new: [], drafts: [], callbacks: [], declined: [] };
    for (const l of this.pending()) {
      if (l.callbackById) {
        // Callbacks ignore the teammate filter — they can sit on anyone's assignment.
        split.callbacks.push(l);
      } else if (!filter || l.retention?.id === filter) {
        split[isRejected(l) ? 'declined' : l.status === 'DRAFT' ? 'drafts' : 'new'].push(l);
      }
    }
    return split;
  });

  private readonly pendingRows = computed(() =>
    this.chargeBacksOnly()
      ? this.chargeBackLeads()
      : this.declinedOnly()
        ? this.pendingSplit().declined
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
    // The team's queue is shown in full — no pager on this page.
    pageSize: 1000,
  });

  readonly highlightId = highlightFromQuery(() => this.pending(), (lead) => {
    this.chargeBacksOnly.set(false);
    this.declinedOnly.set(false);
    this.teammateFilter.set('');
    this.declinedOnly.set(isRejected(lead) && !lead.callbackById);
    this.pendingTab.set(lead.callbackById ? 'callbacks' : lead.status === 'DRAFT' ? 'drafts' : 'new');
    this.pendingView.reveal((l) => l.id === lead.id);
  });

  async ngOnInit(): Promise<void> {
    // Default the filter to "assigned to me" once we know who's logged in.
    if (this.currentUserId()) this.teammateFilter.set(this.currentUserId()!);
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      const [queue, history, shared] = await Promise.all([
        this.leadService.retentionQueue(),
        this.leadService.retentionHistory(),
        this.leadService.retentionSharedHistory(),
      ]);
      this.pending.set(queue);
      this.ownChargeBacks.set(history.filter((l) => l.chargeBacks?.length));
      this.sharedChargeBacks.set(shared.filter((l) => l.chargeBacks?.length));
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
