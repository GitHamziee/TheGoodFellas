import { LowerCasePipe } from '@angular/common';
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
    LowerCasePipe,
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
          <p class="sub">{{ subtitle() }}</p>
        </div>
      </div>

      <div class="stats-row">
        <app-stat-tile [value]="totals().people" [label]="peopleLabel()" tone="tone-gold">
          <svg lucideUsers></svg>
        </app-stat-tile>
        <app-stat-tile [value]="totals().total" [label]="totalLabel()" tone="tone-c">
          <svg lucideLayers></svg>
        </app-stat-tile>
        <app-stat-tile [value]="totals().accepted" [label]="goodLabel()" tone="tone-success">
          <svg lucideCircleCheck></svg>
        </app-stat-tile>
        <app-stat-tile [value]="totals().rejected" [label]="badLabel()" tone="tone-danger">
          <svg lucideCircleX></svg>
        </app-stat-tile>
        <app-stat-tile
          [value]="totals().rate === null ? '—' : totals().rate + '%'"
          [label]="rateLabel()"
          tone="tone-a"
        >
          <svg lucideTarget></svg>
        </app-stat-tile>
      </div>

      @if (!loading() && chart().length > 0) {
        <div class="card">
          <div class="inline-head">
            <h2>{{ goodLabel() }} vs {{ badLabel() | lowercase }}</h2>
            <span class="count">Top {{ chart().length }} by decided {{ unitLabel() }}</span>
          </div>

          <div class="chart">
            @for (row of chart(); track row.id) {
              <div
                class="chart-row"
                [title]="row.name + ' — ' + row.accepted + ' ' + goodLabel() + ', ' + row.rejected + ' ' + badLabel()"
              >
                <span class="chart-key">{{ row.name }}</span>
                <span class="chart-track">
                  @if (row.accepted > 0) {
                    <span class="chart-bar chart-bar--good" [style.width.%]="row.acceptedPct"></span>
                  }
                  @if (row.rejected > 0) {
                    <span class="chart-bar chart-bar--bad" [style.width.%]="row.rejectedPct"></span>
                  }
                </span>
                <span class="chart-val">{{ row.decided }}</span>
              </div>
            }
          </div>

          <div class="chart-legend">
            <span><i class="sw--good"></i> {{ goodLabel() }}</span>
            <span><i class="sw--bad"></i> {{ badLabel() }}</span>
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
                    {{ goodLabel() }} <span class="arrow">{{ arrow('accepted') }}</span>
                  </th>
                  <th class="sortable right" (click)="toggleSort('rejected')">
                    {{ badLabel() }} <span class="arrow">{{ arrow('rejected') }}</span>
                  </th>
                  <th class="hide-sm">Split</th>
                  <th class="sortable right" (click)="toggleSort('rate')">
                    {{ rateLabel() }} <span class="arrow">{{ arrow('rate') }}</span>
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
                        <span class="who">
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
                        <span class="empty">{{ noneLabel() }}</span>
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
  readonly subtitle = input('');
  readonly peopleLabel = input('People');
  readonly emptyTitle = input('Nothing to report yet');
  readonly emptyHint = input('');
  readonly source = input<UserOutcomeRow[]>([]);
  readonly loading = input(false);

  // Text for what `accepted`/`rejected` mean in this instance — defaults match the
  // original accepted/rejected lead-outcome usage; QA Reports pass PASS/FAIL wording.
  readonly totalLabel = input('Leads handled');
  readonly goodLabel = input('Accepted');
  readonly badLabel = input('Rejected');
  readonly rateLabel = input('Accept rate');
  readonly noneLabel = input('No decisions yet');
  readonly unitLabel = input('leads');

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

  /**
   * The handful with the most decided leads, scaled against the largest decided
   * count so the two segments of a row always sum to that row's share of the max.
   * People with nothing decided yet are left out — an empty bar says nothing.
   */
  readonly chart = computed(() => {
    const top = [...this.rows()]
      .filter((r) => r.decided > 0)
      .sort((a, b) => b.decided - a.decided)
      .slice(0, 8);
    const max = Math.max(1, ...top.map((r) => r.decided));
    return top.map((r) => ({
      ...r,
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
