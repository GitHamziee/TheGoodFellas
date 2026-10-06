import { NgTemplateOutlet } from '@angular/common';
import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { LucideLock } from '@lucide/angular';
import { Lead } from '../../core/models/lead.model';
import { QaLeadSummary, QaPerson, ReviewOutcome } from '../../core/models/review.model';
import { AuthService } from '../../core/services/auth.service';
import { LeadService } from '../../core/services/lead.service';
import { formatDateTime, humanizeEnum } from '../../core/format-utils';
import { LeadDetail } from '../../shared/lead-detail';
import { Modal } from '../../shared/ui/modal';
import { Detail, SkeletonRows } from '../../shared/ui/ui';

export interface QaVerdict {
  outcome: ReviewOutcome;
  comment: string | null;
  reviewer: QaPerson;
  createdAt: string;
}

/**
 * Drill-down from a QA report row to the lead behind it. ADMIN gets the full lead; MANAGER
 * gets it too unless a Junior Closer originated the lead (getLeadById 403s that case — those
 * belong to Team Lead); TEAM_LEAD only ever sees the masked summary. Whenever the full fetch
 * isn't allowed or fails, the summary built from the report row is shown instead.
 */
@Component({
  selector: 'app-qa-lead-peek',
  imports: [NgTemplateOutlet, Modal, Detail, LeadDetail, SkeletonRows, LucideLock],
  template: `
    <app-modal title="Lead" [subtitle]="lead().customerName" [wide]="!!full()" (close)="close.emit()">
      @if (verdict(); as v) {
        <div class="verdict" [class.verdict--fail]="v.outcome === 'FAIL'">
          <div class="verdict-head">
            <span [class]="v.outcome === 'PASS' ? 'badge badge--accepted' : 'badge badge--rejected'">
              {{ v.outcome === 'PASS' ? 'Pass' : 'Fail' }}
            </span>
            <span class="verdict-meta">{{ v.reviewer.name }} · {{ formatDateTime(v.createdAt) }}</span>
          </div>
          <p class="verdict-comment">{{ v.comment || 'No comment left.' }}</p>
        </div>
      }

      @if (full()) {
        @if (loading()) {
          <app-skeleton-rows [count]="4" />
        } @else if (detail(); as d) {
          <app-lead-detail [lead]="d" />
        } @else {
          <div class="error">Could not load the full lead — showing the summary instead.</div>
          <ng-container *ngTemplateOutlet="summary" />
        }
      } @else {
        <div class="locked">
          <svg lucideLock></svg>
          <span>Restricted view — only the summary is visible for your role.</span>
        </div>
        <ng-container *ngTemplateOutlet="summary" />
      }
    </app-modal>

    <ng-template #summary>
      <div class="detail-grid stack-top">
        <app-detail label="Customer" [value]="lead().customerName" />
        <app-detail label="Status" [value]="humanizeEnum(lead().status)" />
        <app-detail label="Lead type" [value]="lead().leadType" />
        <app-detail label="D-code" [value]="lead().dCode" />
        <app-detail label="State" [value]="lead().state" />
        <app-detail label="Junior Closer" [value]="lead().juniorCloser?.name" />
        <app-detail label="Closer" [value]="lead().closer?.name" />
        <app-detail label="Created" [value]="formatDateTime(lead().createdAt)" />
      </div>
    </ng-template>
  `,
  styles: `
    .verdict { border: 1px solid var(--gray-200); border-radius: var(--radius-sm); padding: 0.7rem 0.85rem; margin-bottom: 0.9rem; background: var(--success-50); }
    .verdict--fail { background: var(--danger-50); }
    .verdict-head { display: flex; align-items: center; gap: 0.6rem; }
    .verdict-meta { font-size: 0.74rem; color: var(--gray-500); }
    .verdict-comment { margin: 0.45rem 0 0; font-size: 0.86rem; line-height: 1.45; }
  `,
})
export class QaLeadPeek implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly leadService = inject(LeadService);

  readonly lead = input.required<QaLeadSummary>();
  readonly verdict = input<QaVerdict | null>(null);
  readonly close = output<void>();

  readonly detail = signal<Lead | null>(null);
  readonly loading = signal(false);

  readonly formatDateTime = formatDateTime;
  readonly humanizeEnum = humanizeEnum;

  readonly full = computed(() => {
    const role = this.auth.role();
    if (role === 'ADMIN') return true;
    return role === 'MANAGER' && !this.lead().juniorCloserId;
  });

  async ngOnInit(): Promise<void> {
    if (!this.full()) return;
    this.loading.set(true);
    try {
      this.detail.set(await this.leadService.getLead(this.lead().id));
    } catch {
      this.detail.set(null);
    } finally {
      this.loading.set(false);
    }
  }
}
