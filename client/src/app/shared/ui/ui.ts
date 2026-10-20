import { Component, computed, input, output } from '@angular/core';
import { LucideChevronLeft, LucideChevronRight, LucideSearch } from '@lucide/angular';
import { LeadStatus, PaymentStatus } from '../../core/models/lead.model';

/** Icon + number + caption. The icon is projected: `<app-stat-tile ...><svg lucideUsers></svg></app-stat-tile>`. */
@Component({
  selector: 'app-stat-tile',
  template: `
    <div class="stat" [attr.data-tone]="tone()">
      <div class="ico" [class]="tone()"><ng-content /></div>
      <div>
        <div class="value">{{ value() }}</div>
        <div class="label">{{ label() }}</div>
      </div>
    </div>
  `,
})
export class StatTile {
  readonly value = input<string | number>(0);
  readonly label = input('');
  readonly tone = input('tone-gold');
}

/**
 * Dark page banner with a soft tinted glow — the admin pages' equivalent of the client dashboard hero.
 * The eyebrow icon is projected (`<svg lucideX>`); anything else projected becomes the action buttons.
 * `tone` only shifts the glow/accent hue so each section of the portal feels distinct.
 */
@Component({
  selector: 'app-page-hero',
  template: `
    <section class="phero" [class.bare]="!eyebrow()" [attr.data-tone]="tone()">
      <div class="phero-copy">
        <span class="phero-eyebrow"><ng-content select="svg" /> {{ eyebrow() }}</span>
        <h1>{{ title() }}</h1>
        @if (sub()) {
          <p>{{ sub() }}</p>
        }
        <div class="phero-actions"><ng-content /></div>
      </div>
      @if (count() !== null) {
        <div class="phero-count" aria-hidden="true">
          <span class="n">{{ count() }}</span>
          <span class="l">{{ countLabel() }}</span>
        </div>
      }
    </section>
  `,
})
export class PageHero {
  readonly eyebrow = input('');
  readonly title = input.required<string>();
  readonly sub = input('');
  readonly count = input<string | number | null>(null);
  readonly countLabel = input('');
  readonly tone = input<'gold' | 'bronze' | 'steel' | 'moss' | 'clay' | 'teal' | 'green' | 'red'>('gold');
}

/** Placeholder shown when a list has no rows. Icon is projected. */
@Component({
  selector: 'app-empty-state',
  template: `
    <div class="empty-state">
      <ng-content />
      <div class="t">{{ title() }}</div>
      @if (hint()) {
        <div class="h">{{ hint() }}</div>
      }
    </div>
  `,
})
export class EmptyState {
  readonly title = input('Nothing here yet');
  readonly hint = input('');
}

/** Shimmering placeholder rows while a list loads. */
@Component({
  selector: 'app-skeleton-rows',
  template: `
    @for (row of placeholders(); track $index) {
      <div class="skeleton-row">
        <div class="sk sk--avatar"></div>
        <div class="sk sk--grow"></div>
        <div class="sk sk--w-md hide-sm"></div>
        <div class="sk sk--w-sm"></div>
      </div>
    }
  `,
})
export class SkeletonRows {
  readonly count = input(5);
  readonly placeholders = computed(() => Array.from({ length: this.count() }));
}

/** Debounce-free search input with a leading magnifier. */
@Component({
  selector: 'app-search-box',
  imports: [LucideSearch],
  template: `
    <div class="search-box">
      <svg lucideSearch></svg>
      <input
        type="search"
        [placeholder]="placeholder()"
        [value]="value()"
        (input)="valueChange.emit($any($event.target).value)"
        [attr.aria-label]="placeholder()"
      />
    </div>
  `,
})
export class SearchBox {
  readonly value = input('');
  readonly placeholder = input('Search…');
  readonly valueChange = output<string>();
}

/** Page N of M (T total) with prev/next. Renders nothing on a single page. */
@Component({
  selector: 'app-pagination',
  imports: [LucideChevronLeft, LucideChevronRight],
  template: `
    @if (totalPages() > 1) {
      <div class="pagination">
        <p class="info">Page {{ page() }} of {{ totalPages() }} ({{ total() }} total)</p>
        <div class="pager">
          <button
            type="button"
            [disabled]="page() <= 1"
            (click)="pageChange.emit(page() - 1)"
            aria-label="Previous page"
          >
            <svg lucideChevronLeft></svg>
          </button>
          <button
            type="button"
            [disabled]="page() >= totalPages()"
            (click)="pageChange.emit(page() + 1)"
            aria-label="Next page"
          >
            <svg lucideChevronRight></svg>
          </button>
        </div>
      </div>
    }
  `,
})
export class Pagination {
  readonly page = input(1);
  readonly totalPages = input(1);
  readonly total = input(0);
  readonly pageChange = output<number>();
}

const STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: 'New',
  SUBMITTED: 'Submitted',
  ASSIGNED: 'Assigned',
  ACCEPTED: 'Approved',
  REJECTED: 'Declined',
  RETURNED_TO_JUNIOR: 'Sent back — Junior',
  RETURNED_TO_CLOSER: 'Sent back — Closer',
  RETURNED_TO_RETENTION: 'Sent back — Retention',
  ASSIGNED_EXTERNAL: 'Assigned — External',
  DRAFT: 'Draft',
  CHARGED_BACK: 'Charged Back',
};

@Component({
  selector: 'app-status-badge',
  template: `<span [class]="cls()">{{ text() }}</span>`,
})
export class StatusBadge {
  readonly status = input.required<LeadStatus>();
  readonly cls = computed(() => `badge badge--${this.status().toLowerCase()}`);
  readonly text = computed(() => STATUS_LABEL[this.status()] ?? this.status());
}

@Component({
  selector: 'app-payment-badge',
  template: `<span [class]="cls()">{{ paid() ? 'Paid' : 'Unpaid' }}</span>`,
})
export class PaymentBadge {
  readonly status = input.required<PaymentStatus>();
  readonly paid = computed(() => this.status() === 'PAID');
  readonly cls = computed(() => `badge badge--${this.paid() ? 'paid' : 'unpaid'}`);
}

/** One labelled value in a detail modal. Icon is projected. */
@Component({
  selector: 'app-detail',
  template: `
    <div class="detail">
      <ng-content />
      <div>
        <div class="k">{{ label() }}</div>
        <div class="v" [class.sensitive]="sensitive()">{{ value() || '—' }}</div>
      </div>
    </div>
  `,
})
export class Detail {
  readonly label = input('');
  readonly value = input<string | number | null | undefined>('');
  readonly sensitive = input(false);
}
