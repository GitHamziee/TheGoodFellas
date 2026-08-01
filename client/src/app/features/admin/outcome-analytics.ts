import { Component, computed, input, signal } from '@angular/core';
import {
  LucideCircleCheck,
  LucideCircleX,
  LucideLayers,
  LucideTarget,
  LucideUsers,
} from '@lucide/angular';
import { UserOutcomeRow } from '../../core/services/analytics.service';
import { getAvatarTone, getInitials } from '../../core/format-utils';
import { EmptyState, SearchBox, SkeletonRows, StatTile } from '../../shared/ui/ui';

type SortKey = 'name' | 'total' | 'accepted' | 'rejected' | 'rate';

interface Row extends UserOutcomeRow {
  /** Accepted as a share of decided leads; null when nothing is decided yet. */
  rate: number | null;
  decided: number;
  pending: number;
}

/**
 * Per-person accepted/rejected breakdown, shared by the Junior Closer and
 * Closer analytics pages — same data shape, different source endpoint.
 */
@Component({
  selector: 'app-outcome-analytics',
  imports: [
    StatTile,
    SearchBox,
    EmptyState,
    SkeletonRows,
    LucideLayers,
    LucideCircleCheck,
    LucideCircleX,
    LucideTarget,
    LucideUsers,
  ],
  template: `
    <div class="page">
      <div class="page-head">
        <div>
          <h1>{{ title() }}</h1>
          <p class="sub">{{ subtitle() }}</p>
        </div>
      </div>

      <div class="stats-row">
        <app-stat-tile [value]="totals().people" [label]="peopleLabel()" tone="tone-gold">
          <svg lucideUsers></svg>
        </app-stat-tile>
        <app-stat-tile [value]="totals().total" label="Leads handled" tone="tone-c">
          <svg lucideLayers></svg>
        </app-stat-tile>
        <app-stat-tile [value]="totals().accepted" label="Accepted" tone="tone-success">
          <svg lucideCircleCheck></svg>
        </app-stat-tile>
        <app-stat-tile [value]="totals().rejected" label="Rejected" tone="tone-danger">
          <svg lucideCircleX></svg>
        </app-stat-tile>
        <app-stat-tile
          [value]="totals().rate === null ? '—' : totals().rate + '%'"
          label="Team accept rate"
          tone="tone-a"
        >
          <svg lucideTarget></svg>
        </app-stat-tile>
      </div>

      @if (!loading() && rows().length > 0) {
        <div class="card">
          <div class="inline-head">
            <h2>Accepted vs rejected</h2>
            <span class="count">Top {{ chart().length }} by volume</span>
          </div>

          <div class="chart">
            @for (row of chart(); track row.id) {
              <div class="bar-col" [title]="row.name + ' — ' + row.accepted + ' accepted, ' + row.rejected + ' rejected'">
                <div class="bar-track">
                  <span class="bar bar--rejected" [style.height.%]="row.rejectedPct"></span>
                  <span class="bar bar--accepted" [style.height.%]="row.acceptedPct"></span>
                </div>
                <span class="bar-label">{{ row.short }}</span>
              </div>
            }
          </div>

          <div class="legend">
            <span><i style="background: var(--success-600)"></i> Accepted</span>
            <span><i style="background: var(--danger-600)"></i> Rejected</span>
          </div>
        </div>
      }

      <div class="toolbar">
        <app-search-box
          [value]="search()"
          placeholder="Search by name or email…"
          (valueChange)="search.set($event)"
        />
      </div>

      <div class="card card--flush">
        @if (loading()) {
          <app-skeleton-rows [count]="5" />
        } @else if (visible().length === 0) {
          <app-empty-state [title]="emptyTitle()" [hint]="emptyHint()">
            <svg lucideUsers></svg>
          </app-empty-state>
        } @else {
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th class="sortable" (click)="toggleSort('name')">
                    Name <span class="arrow">{{ arrow('name') }}</span>
                  </th>
                  <th class="sortable right" (click)="toggleSort('total')">
                    Total <span class="arrow">{{ arrow('total') }}</span>
                  </th>
                  <th class="sortable right" (click)="toggleSort('accepted')">
                    Accepted <span class="arrow">{{ arrow('accepted') }}</span>
                  </th>
                  <th class="sortable right" (click)="toggleSort('rejected')">
                    Rejected <span class="arrow">{{ arrow('rejected') }}</span>
                  </th>
                  <th class="hide-sm">Split</th>
                  <th class="sortable right" (click)="toggleSort('rate')">
                    Accept rate <span class="arrow">{{ arrow('rate') }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (row of visible(); track row.id) {
                  <tr>
                    <td>
                      <div class="person">
                        <span class="avatar-sm" [class]="getAvatarTone(row.id)">
                          {{ getInitials(row.name) }}
                        </span>
                        <span>
                          <span class="cell-main">{{ row.name }}</span>
                          <span class="cell-sub">{{ row.email }}</span>
                        </span>
                      </div>
                    </td>
                    <td class="right num">{{ row.total }}</td>
                    <td class="right num">{{ row.accepted }}</td>
                    <td class="right num">{{ row.rejected }}</td>
                    <td class="hide-sm">
                      @if (row.decided > 0) {
                        <span class="meter">
                          <i class="ok" [style.width.%]="(row.accepted / row.decided) * 100"></i>
                          <i class="bad" [style.width.%]="(row.rejected / row.decided) * 100"></i>
                        </span>
                      } @else {
                        <span class="empty">No decisions yet</span>
                      }
                    </td>
                    <td class="right num">
                      @if (row.rate === null) {
                        <span class="empty">—</span>
                      } @else {
                        <strong>{{ row.rate }}%</strong>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    </div>
  `,
})
export class OutcomeAnalytics {
  readonly title = input('Analytics');
  readonly subtitle = input('');
  readonly peopleLabel = input('People');
  readonly emptyTitle = input('Nothing to report yet');
  readonly emptyHint = input('');
  readonly source = input<UserOutcomeRow[]>([]);
  readonly loading = input(false);

  readonly search = signal('');
  readonly sortKey = signal<SortKey>('total');
  readonly sortDir = signal<'asc' | 'desc'>('desc');

  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  readonly rows = computed<Row[]>(() =>
    this.source().map((r) => {
      const decided = r.accepted + r.rejected;
      return {
        ...r,
        decided,
        pending: Math.max(0, r.total - decided),
        rate: decided ? Math.round((r.accepted / decided) * 100) : null,
      };
    }),
  );

  readonly totals = computed(() => {
    const rows = this.rows();
    const accepted = rows.reduce((s, r) => s + r.accepted, 0);
    const rejected = rows.reduce((s, r) => s + r.rejected, 0);
    const decided = accepted + rejected;
    return {
      people: rows.length,
      total: rows.reduce((s, r) => s + r.total, 0),
      accepted,
      rejected,
      rate: decided ? Math.round((accepted / decided) * 100) : null,
    };
  });

  readonly visible = computed(() => {
    const term = this.search().trim().toLowerCase();
    let rows = this.rows();
    if (term) {
      rows = rows.filter(
        (r) => r.name.toLowerCase().includes(term) || r.email.toLowerCase().includes(term),
      );
    }
    const key = this.sortKey();
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (key === 'name') return a.name.localeCompare(b.name) * dir;
      // Nulls (no decisions yet) always sort last regardless of direction.
      const av = a[key];
      const bv = b[key];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return ((av as number) - (bv as number)) * dir;
    });
  });

  /** Busiest handful, scaled against the largest total so bars stay comparable. */
  readonly chart = computed(() => {
    const top = [...this.rows()].sort((a, b) => b.total - a.total).slice(0, 8);
    const max = Math.max(1, ...top.map((r) => r.total));
    return top.map((r) => ({
      ...r,
      short: r.name.split(' ')[0],
      acceptedPct: (r.accepted / max) * 100,
      rejectedPct: (r.rejected / max) * 100,
    }));
  });

  toggleSort(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      this.sortDir.set(key === 'name' ? 'asc' : 'desc');
    }
  }

  arrow(key: SortKey): string {
    if (this.sortKey() !== key) return '';
    return this.sortDir() === 'asc' ? '↑' : '↓';
  }
}
