import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideClock,
  LucideFileText,
  LucideNotebookPen,
  LucideTriangleAlert,
  LucideUsers,
  LucideX,
} from '@lucide/angular';
import { LeadService } from '../../../core/services/lead.service';
import { Lead } from '../../../core/models/lead.model';
import { createListView } from '../../../core/list-view';
import {
  formatDate,
  formatPhone,
  getAvatarTone,
  getInitials,
  pluralize,
  timeAgo,
} from '../../../core/format-utils';
import { DRAFT_REASON_LABEL } from '../../../core/lead-options';
import { Modal } from '../../../shared/ui/modal';
import { Select } from '../../../shared/ui/select';
import { EmptyState, Pagination, SearchBox, SkeletonRows, StatTile } from '../../../shared/ui/ui';
import { LeadDetail } from '../../../shared/lead-detail';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';

/** A draft untouched this long is flagged — it is probably forgotten, not in progress. */
const STALE_DAYS = 3;

/** Stands in for "no junior closer" in the filter — kept out of the real id space. */
const NO_JUNIOR = '__none__';

@Component({
  selector: 'app-admin-drafts',
  imports: [
    FormsModule,
    Modal,
    Select,
    LeadDetail,
    StatTile,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideFileText,
    LucideClock,
    LucideUsers,
    LucideTriangleAlert,
    LucideNotebookPen,
    LucideX,
  ],
  templateUrl: './drafts.html',
  styles: `
    .filters { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; margin-bottom: 1rem; }
    .filters app-select { min-width: 170px; }
    .dash-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; margin-bottom: 1rem; }
    .pickable { cursor: pointer; border-radius: 6px; }
    .pickable.on .chart-key { font-weight: 700; color: var(--gold-800); }
    .age--stale { background: var(--danger-50); color: var(--danger-700); }
    .age--aging { background: var(--warning-50); color: var(--warning-700); }
    tr.row--stale td:first-child { box-shadow: inset 3px 0 0 var(--danger-600, #dc2626); }
  `,
})
export class AdminDrafts implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly leadService = inject(LeadService);

  readonly leads = signal<Lead[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selected = signal<Lead | null>(null);

  readonly formatPhone = formatPhone;
  readonly formatDate = formatDate;
  readonly pluralize = pluralize;
  readonly timeAgo = timeAgo;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly staleDays = STALE_DAYS;

  // ─── Filters ────────────────────────────────────────────────
  readonly closerFilter = signal('');
  readonly juniorFilter = signal('');
  readonly reasonFilter = signal('');
  readonly ageFilter = signal('');

  readonly ageOptions = [
    { value: '', label: 'Any age' },
    { value: 'stale', label: `Waiting ${STALE_DAYS}+ days` },
    { value: 'week', label: 'Waiting 7+ days' },
    { value: 'fresh', label: `Under ${STALE_DAYS} days` },
  ];

  reasonText(lead: Lead): string {
    if (!lead.draftReason) return '';
    return lead.draftReason === 'OTHER' && lead.draftReasonNote
      ? lead.draftReasonNote
      : DRAFT_REASON_LABEL[lead.draftReason];
  }

  ageOf(lead: Lead): number {
    return Math.max(0, Math.floor((Date.now() - new Date(lead.updatedAt).getTime()) / 86_400_000));
  }

  readonly closerOptions = computed(() => {
    const seen = new Map<string, string>();
    for (const l of this.leads()) if (l.closer) seen.set(l.closer.id, l.closer.name);
    return [
      { value: '', label: 'All closers' },
      ...[...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
    ];
  });

  readonly juniorOptions = computed(() => {
    const seen = new Map<string, string>();
    let hasSelfSourced = false;
    for (const l of this.leads()) {
      if (l.juniorCloser) seen.set(l.juniorCloser.id, l.juniorCloser.name);
      else hasSelfSourced = true;
    }
    const options = [
      { value: '', label: 'All junior closers' },
      ...[...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
    ];
    if (hasSelfSourced) options.push({ value: NO_JUNIOR, label: 'No junior closer' });
    return options;
  });

  readonly reasonOptions = computed(() => {
    const present = new Set(this.leads().map((l) => l.draftReason).filter(Boolean));
    return [
      { value: '', label: 'All reasons' },
      ...[...present].map((r) => ({ value: r as string, label: DRAFT_REASON_LABEL[r!] })),
    ];
  });

  /** Everything except the reason filter — the reason breakdown needs the other reasons to draw. */
  private readonly beforeReason = computed(() => {
    const closer = this.closerFilter();
    const junior = this.juniorFilter();
    const age = this.ageFilter();
    return this.leads().filter((l) => {
      if (closer && l.closer?.id !== closer) return false;
      if (junior === NO_JUNIOR && l.juniorCloser) return false;
      if (junior && junior !== NO_JUNIOR && l.juniorCloser?.id !== junior) return false;
      const days = this.ageOf(l);
      if (age === 'stale' && days < STALE_DAYS) return false;
      if (age === 'week' && days < 7) return false;
      if (age === 'fresh' && days >= STALE_DAYS) return false;
      return true;
    });
  });

  readonly filtered = computed(() => {
    const reason = this.reasonFilter();
    return reason ? this.beforeReason().filter((l) => l.draftReason === reason) : this.beforeReason();
  });

  readonly hasFilters = computed(
    () => !!(this.closerFilter() || this.juniorFilter() || this.reasonFilter() || this.ageFilter()),
  );

  clearFilters(): void {
    this.closerFilter.set('');
    this.juniorFilter.set('');
    this.reasonFilter.set('');
    this.ageFilter.set('');
  }

  /** The breakdown lists double as filters: clicking a row toggles it. */
  pick(kind: 'reason' | 'closer', value: string): void {
    const sig = kind === 'reason' ? this.reasonFilter : this.closerFilter;
    sig.set(sig() === value ? '' : value);
  }

  // ─── Summary ────────────────────────────────────────────────
  readonly stats = computed(() => {
    const rows = this.filtered();
    const ages = rows.map((l) => this.ageOf(l));
    return {
      total: rows.length,
      stale: ages.filter((a) => a >= STALE_DAYS).length,
      oldest: ages.length ? Math.max(...ages) : 0,
      avg: ages.length ? Math.round(ages.reduce((s, n) => s + n, 0) / ages.length) : 0,
      closers: new Set(rows.map((l) => l.closer?.id).filter(Boolean)).size,
    };
  });

  private tally(rows: { key: string; label: string }[]) {
    const m = new Map<string, { key: string; label: string; count: number }>();
    for (const r of rows) {
      const e = m.get(r.key) ?? { ...r, count: 0 };
      e.count++;
      m.set(r.key, e);
    }
    const sorted = [...m.values()].sort((a, b) => b.count - a.count);
    const max = Math.max(1, ...sorted.map((r) => r.count));
    return sorted.map((r) => ({ ...r, pct: Math.max(4, Math.round((r.count / max) * 100)) }));
  }

  readonly byReason = computed(() =>
    this.tally(
      this.beforeReason()
        .filter((l) => l.draftReason)
        .map((l) => ({ key: l.draftReason as string, label: DRAFT_REASON_LABEL[l.draftReason!] })),
    ),
  );

  readonly byCloser = computed(() =>
    this.tally(
      this.filtered()
        .filter((l) => l.closer)
        .map((l) => ({ key: l.closer!.id, label: l.closer!.name })),
    ).slice(0, 8),
  );

  readonly view = createListView<Lead>({
    source: this.filtered,
    searchFields: (l) => [
      l.customerName,
      l.phone,
      l.state,
      this.reasonText(l),
      l.closer?.name,
      l.juniorCloser?.name,
    ],
    sorters: {
      customerName: (l) => l.customerName,
      createdAt: (l) => new Date(l.createdAt).getTime(),
      updatedAt: (l) => new Date(l.updatedAt).getTime(),
    },
    initialSort: { key: 'updatedAt', dir: 'asc' },
    pageSize: 10,
  });

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }

  async ngOnInit(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      this.leads.set(await this.leadService.adminDrafts());
    } catch {
      this.error.set('Could not load drafts. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
