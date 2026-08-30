import { Component, computed, input, signal } from '@angular/core';
import { LucideFlag, LucideLayers, LucideUsers } from '@lucide/angular';
import { CallReviewAnalytics } from '../../core/models/review.model';
import { formatDateTime, getAvatarTone, getInitials, timeAgo } from '../../core/format-utils';
import { EmptyState, SearchBox, SkeletonRows, StatTile } from '../../shared/ui/ui';

type SortKey = 'name' | 'count';

/**
 * Per-person flagged-issue counts, shared by the Live Call Report — Junior Closers and
 * — Closers pages (same data shape, different source endpoint). Unlike OutcomeAnalytics
 * (accepted/rejected), there's no "good" side here: CallReview only exists to log a
 * problem, so this shows a count and a recent-issues feed, not a pass rate.
 */
@Component({
  selector: 'app-issue-analytics',
  imports: [StatTile, SearchBox, EmptyState, SkeletonRows, LucideLayers, LucideFlag, LucideUsers],
  template: `
    <div class="page">
      <div class="page-head">
        <div>
          <p class="sub">{{ subtitle() }}</p>
        </div>
      </div>

      <div class="stats-row">
        <app-stat-tile [value]="source().byPerson.length" [label]="peopleLabel()" tone="tone-gold">
          <svg lucideUsers></svg>
        </app-stat-tile>
        <app-stat-tile [value]="source().total" label="Issues flagged" tone="tone-danger">
          <svg lucideFlag></svg>
        </app-stat-tile>
        <app-stat-tile [value]="flaggedCount()" label="With at least one issue" tone="tone-c">
          <svg lucideLayers></svg>
        </app-stat-tile>
      </div>

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
                  <th class="sortable right" (click)="toggleSort('count')">
                    Issues flagged <span class="arrow">{{ arrow('count') }}</span>
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
                    <td class="right num">
                      @if (row.count === 0) {
                        <span class="empty">None</span>
                      } @else {
                        <strong>{{ row.count }}</strong>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      @if (!loading() && source().recent.length > 0) {
        <div class="card">
          <div class="inline-head">
            <h2>Recently flagged</h2>
            <span class="count">Last {{ source().recent.length }}</span>
          </div>
          <div class="issue-feed">
            @for (issue of source().recent; track issue.id) {
              <div class="issue-row">
                <span class="avatar-sm" [class]="getAvatarTone(issue.reviewee.id)">
                  {{ getInitials(issue.reviewee.name) }}
                </span>
                <div class="issue-body">
                  <div class="issue-head">
                    <strong>{{ issue.reviewee.name }}</strong>
                    <span class="issue-meta" [title]="formatDateTime(issue.createdAt)">{{ timeAgo(issue.createdAt) }}</span>
                  </div>
                  <p class="issue-comment">{{ issue.comment }}</p>
                  <span class="issue-meta">Flagged by {{ issue.reviewer.name }}</span>
                </div>
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .issue-feed { display: flex; flex-direction: column; gap: 0.9rem; }
    .issue-row { display: flex; gap: 0.65rem; align-items: flex-start; }
    .issue-body { flex: 1; min-width: 0; }
    .issue-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
    .issue-meta { font-size: 0.72rem; color: var(--gray-500); white-space: nowrap; }
    .issue-comment { margin: 0.2rem 0 0.3rem; font-size: 0.84rem; color: var(--text); line-height: 1.45; }
  `,
})
export class IssueAnalytics {
  readonly subtitle = input('');
  readonly peopleLabel = input('People');
  readonly emptyTitle = input('Nothing to report yet');
  readonly emptyHint = input('');
  readonly source = input<CallReviewAnalytics>({ total: 0, byPerson: [], recent: [] });
  readonly loading = input(false);

  readonly search = signal('');
  readonly sortKey = signal<SortKey>('count');
  readonly sortDir = signal<'asc' | 'desc'>('desc');

  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly timeAgo = timeAgo;
  readonly formatDateTime = formatDateTime;

  readonly flaggedCount = computed(() => this.source().byPerson.filter((p) => p.count > 0).length);

  readonly visible = computed(() => {
    const term = this.search().trim().toLowerCase();
    let rows = this.source().byPerson;
    if (term) {
      rows = rows.filter((r) => r.name.toLowerCase().includes(term) || r.email.toLowerCase().includes(term));
    }
    const key = this.sortKey();
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (key === 'name') return a.name.localeCompare(b.name) * dir;
      return (a.count - b.count) * dir;
    });
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
