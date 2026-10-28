import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideClock, LucidePhoneCall, LucideUsers, LucideX } from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { Lead } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import { formatDate, formatPhone, getAvatarTone, getInitials, timeAgo } from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import { Select } from '../../../shared/ui/select';
import { EmptyState, Pagination, SearchBox, SkeletonRows, StatTile, StatusBadge } from '../../../shared/ui/ui';
import { LeadDetail } from '../../../shared/lead-detail';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';

/** Mirrors RETENTION_CALLBACK_HOURS on the server — after this a callback lapses to drafts. */
const CALLBACK_HOURS = 48;
/** Flagged as about to lapse once less than this is left. */
const SOON_HOURS = 1;

@Component({
  selector: 'app-admin-callbacks',
  imports: [
    FormsModule,
    Modal,
    Select,
    LeadDetail,
    StatTile,
    StatusBadge,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucidePhoneCall,
    LucideClock,
    LucideUsers,
    LucideX,
  ],
  templateUrl: './callbacks.html',
  styles: `
    .filters { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; margin-bottom: 1rem; }
    .filters app-select { min-width: 170px; }
    .left--soon { background: var(--danger-50); color: var(--danger-700); }
  `,
})
export class AdminCallbacks implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly leadService = inject(LeadService);

  readonly leads = signal<Lead[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selected = signal<Lead | null>(null);

  readonly formatPhone = formatPhone;
  readonly formatDate = formatDate;
  readonly timeAgo = timeAgo;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  readonly personFilter = signal('');

  /** Hours until the callback lapses back to its owner's drafts (never below 0). */
  hoursLeft(lead: Lead): number {
    const marked = lead.callbackAt ? new Date(lead.callbackAt).getTime() : Date.now();
    return Math.max(0, CALLBACK_HOURS - (Date.now() - marked) / 3_600_000);
  }

  leftText(lead: Lead): string {
    const h = this.hoursLeft(lead);
    return h < 1 ? `${Math.max(1, Math.round(h * 60))}m left` : `${Math.floor(h)}h left`;
  }

  isSoon(lead: Lead): boolean {
    return this.hoursLeft(lead) < SOON_HOURS;
  }

  readonly personOptions = computed(() => {
    const seen = new Map<string, string>();
    for (const l of this.leads()) if (l.callbackBy) seen.set(l.callbackBy.id, l.callbackBy.name);
    return [
      { value: '', label: 'All people' },
      ...[...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
    ];
  });

  readonly filtered = computed(() => {
    const person = this.personFilter();
    return person ? this.leads().filter((l) => l.callbackBy?.id === person) : this.leads();
  });

  readonly stats = computed(() => {
    const rows = this.filtered();
    return {
      total: rows.length,
      people: new Set(rows.map((l) => l.callbackBy?.id).filter(Boolean)).size,
    };
  });

  readonly view = createListView<Lead>({
    source: this.filtered,
    searchFields: (l) => [l.customerName, l.phone, l.state, l.callbackBy?.name],
    sorters: {
      customerName: (l) => l.customerName,
      callbackAt: (l) => (l.callbackAt ? new Date(l.callbackAt).getTime() : 0),
    },
    initialSort: { key: 'callbackAt', dir: 'asc' },
    pageSize: 10,
  });

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }

  async ngOnInit(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      this.leads.set(await this.leadService.adminCallbacks());
    } catch {
      this.error.set('Could not load callbacks. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
