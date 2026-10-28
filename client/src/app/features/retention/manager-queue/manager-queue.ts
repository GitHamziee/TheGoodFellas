import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LucideBanknoteX, LucideClock, LucideSend, LucideSquarePen } from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { Lead } from '../../../core/models/lead.model';
import { highlightFromQuery } from '../../../core/highlight';
import { createListView } from '../../../core/list-view';
import { formatPhone, getAvatarTone, getInitials, timeAgo } from '../../../core/format-utils';
import { EmptyState, PageHero, Pagination, SearchBox, SkeletonRows, StatTile } from '../../../shared/ui/ui';
import { NotePeek } from '../../../shared/ui/lead-notes';
import { DialButton } from '../../../shared/ui/dial-button';
import { LeadDetail } from '../../../shared/lead-detail';
import { Modal } from '../../../shared/ui/modal';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';
import { apiErrorMessage } from '../../../core/api';
import { toastNotice } from '../../../core/toast-notice';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The Retention Manager's work queue: every Retention lead charged back on a 2nd draft or
 * later (1st-draft ones go straight back to the retention person). He edits it, annotates it
 * and submits it to the admin, who is the only one who reassigns it. The server only returns
 * charged-back Retention leads to this role.
 */
@Component({
  selector: 'app-retention-manager-queue',
  imports: [
    PageHero,
    StatTile,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    NotePeek,
    DialButton,
    LeadDetail,
    Modal,
    LucideBanknoteX,
    LucideClock,
    LucideSend,
    LucideSquarePen,
  ],
  templateUrl: './manager-queue.html',
  styles: `
    .toolbar { margin-bottom: 1.25rem; }
    .name-row { display: flex; align-items: center; gap: 0.6rem; }
    .reason-quote { margin-top: 4px; padding-left: 8px; border-left: 3px solid var(--danger-600, #dc2626);
      font-style: italic; color: var(--gray-600); max-width: 280px; }
    .wait { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px;
      font-size: 12px; font-weight: 600; }
    .wait--fresh { background: var(--success-50); color: var(--success-700); }
    .wait--aging { background: var(--warning-50); color: var(--warning-700); }
    .wait--stale { background: var(--danger-50); color: var(--danger-700); }
    tr.row--stale td:first-child { box-shadow: inset 3px 0 0 var(--danger-600, #dc2626); }
  `,
})
export class RetentionManagerQueue implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.refresh());
  private readonly leadService = inject(LeadService);
  private readonly router = inject(Router);

  readonly leads = signal<Lead[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = toastNotice();
  readonly busyId = signal<string | null>(null);
  readonly detailLead = signal<Lead | null>(null);

  readonly formatPhone = formatPhone;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly timeAgo = timeAgo;

  readonly view = createListView<Lead>({
    source: this.leads,
    searchFields: (l) => [l.customerName, l.phone, l.state, l.chargeBacks[0]?.client.name, l.chargeBacks[0]?.reason],
    sorters: {
      customerName: (l) => l.customerName,
      chargedAt: (l) => new Date(l.chargeBacks[0]?.createdAt ?? l.updatedAt ?? l.createdAt).getTime(),
    },
    initialSort: { key: 'chargedAt', dir: 'asc' },
    pageSize: 10,
  });

  readonly highlightId = highlightFromQuery(() => this.leads(), (lead) => this.view.reveal((l) => l.id === lead.id));

  readonly stats = computed(() => {
    const rows = this.leads();
    const untouched = rows.filter((l) => !(l._count?.notes ?? 0)).length;
    const oldest = rows.reduce((max, l) => Math.max(max, this.waitingDays(l)), 0);
    return { total: rows.length, untouched, oldest };
  });

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      this.leads.set(await this.leadService.chargeBacks());
    } catch {
      this.error.set('Could not load your queue. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  chargedAt(lead: Lead): string {
    return lead.chargeBacks[0]?.createdAt ?? lead.updatedAt ?? lead.createdAt;
  }

  waitingDays(lead: Lead): number {
    return Math.max(0, Math.floor((Date.now() - new Date(this.chargedAt(lead)).getTime()) / DAY_MS));
  }

  urgency(lead: Lead): 'fresh' | 'aging' | 'stale' {
    const d = this.waitingDays(lead);
    return d < 3 ? 'fresh' : d < 7 ? 'aging' : 'stale';
  }

  draftLabel(lead: Lead): string {
    const m = lead.chargeBacks[0]?.chargeMonth;
    return m ? `Draft ${m}` : '—';
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }

  edit(lead: Lead, event?: Event): void {
    event?.stopPropagation();
    void this.router.navigate(['/retention-manager/leads', lead.id]);
  }

  async submitToAdmin(lead: Lead, event?: Event): Promise<void> {
    event?.stopPropagation();
    this.error.set(null);
    this.busyId.set(lead.id);
    try {
      await this.leadService.submitToAdmin(lead.id);
      this.detailLead.set(null);
      void this.router.navigate(['/retention-manager/retention-history'], { queryParams: { highlight: lead.id } });
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not send the lead to admin.'));
    } finally {
      this.busyId.set(null);
    }
  }
}
