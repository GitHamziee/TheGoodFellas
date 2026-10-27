import { Component, inject, input, signal } from '@angular/core';
import { LucideInfo } from '@lucide/angular';
import { apiErrorMessage } from '../../core/api';
import { formatDateTime } from '../../core/format-utils';
import { chargeBackMonthLabel } from '../../core/lead-options';
import { RetentionTimelineEntry, RetentionTimelineKind } from '../../core/models/retention-history.model';
import { LeadService } from '../../core/services/lead.service';
import { Modal } from './modal';
import { SkeletonRows } from './ui';

export const KIND_LABEL: Record<RetentionTimelineKind, string> = {
  CREATED: 'Lead created',
  ASSIGNED_TO_RETENTION: 'Assigned to retention',
  SUBMITTED: 'Worked and submitted',
  RETURNED_TO_RETENTION: 'Sent back to retention',
  RETURNED_TO_CLOSER: 'Sent back to closer',
  RETURNED_TO_JUNIOR: 'Sent back to junior closer',
  ASSIGNED_TO_CLIENT: 'Assigned to client',
  ASSIGNED_EXTERNAL: 'Handed to external client',
  ACCEPTED: 'Approved',
  REJECTED: 'Rejected',
  PAID: 'Marked paid',
  STATUS_SET: 'Status set',
  CHARGED_BACK: 'Charged back',
};

export const KIND_TONE: Partial<Record<RetentionTimelineKind, string>> = {
  ACCEPTED: 'dot--good',
  PAID: 'dot--good',
  REJECTED: 'dot--bad',
  CHARGED_BACK: 'dot--bad',
  RETURNED_TO_RETENTION: 'dot--warn',
  RETURNED_TO_CLOSER: 'dot--warn',
  RETURNED_TO_JUNIOR: 'dot--warn',
};

/** Small "i" button that opens a lead's lifecycle timeline. Self-contained: fetches on open. */
@Component({
  selector: 'app-lifecycle-button',
  imports: [Modal, SkeletonRows, LucideInfo],
  template: `
    <button type="button" class="info-btn" aria-label="Lead lifecycle" title="Lifecycle" (click)="show($event)">
      <svg lucideInfo></svg>
    </button>
    @if (open()) {
      <app-modal title="Lifecycle" [subtitle]="name()" [wide]="true" (close)="open.set(false)">
        @if (loading()) {
          <app-skeleton-rows [count]="4" />
        } @else if (error()) {
          <div class="error">{{ error() }}</div>
        } @else {
          <ol class="timeline">
            @for (e of timeline(); track $index) {
              <li>
                <span class="dot" [class]="'dot ' + (tone[e.kind] ?? '')"></span>
                @if (e.kind === 'CHARGED_BACK' && monthLabel(e.chargeMonth); as month) {
                  <div class="tl-detail">{{ month }}</div>
                }
                <div class="tl-head">
                  <span class="tl-title">{{ label[e.kind] }}</span>
                  <span class="tl-when">{{ formatDateTime(e.at) }}</span>
                </div>
                @if (e.actor || e.target || e.note) {
                  <div class="tl-detail">
                    @if (e.actor) { by {{ e.actor }} }
                    @if (e.target) { {{ e.actor ? '→' : 'to' }} {{ e.target }} }
                    @if (e.note) { {{ e.actor || e.target ? '·' : '' }} {{ e.note }} }
                  </div>
                }
              </li>
            }
          </ol>
        }
      </app-modal>
    }
  `,
  styles: `
    :host { display: inline-flex; vertical-align: middle; }
    .info-btn {
      display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0;
      border: 0; border-radius: 50%; background: transparent; color: var(--gray-400); cursor: pointer;
    }
    .info-btn:hover { background: var(--gray-100); color: var(--gray-700); }
    .info-btn svg { width: 14px; height: 14px; }
    .timeline { list-style: none; margin: 0; padding: 0 0 0 1.4rem; position: relative; }
    .timeline::before { content: ''; position: absolute; left: 0.42rem; top: 0.4rem; bottom: 0.4rem; width: 2px; background: var(--gray-200, #e5e7eb); }
    .timeline li { position: relative; padding: 0 0 1.1rem; }
    .timeline li:last-child { padding-bottom: 0; }
    .dot { position: absolute; left: -1.4rem; top: 0.3rem; width: 0.9rem; height: 0.9rem; border-radius: 50%; background: var(--gold-500); border: 2px solid var(--surface, #fff); box-sizing: border-box; box-shadow: 0 0 0 1px var(--gold-500); }
    .dot--good { background: var(--success-600, #16a34a); box-shadow: 0 0 0 1px var(--success-600, #16a34a); }
    .dot--bad { background: var(--danger-600, #dc2626); box-shadow: 0 0 0 1px var(--danger-600, #dc2626); }
    .dot--warn { background: var(--warning-600, #d97706); box-shadow: 0 0 0 1px var(--warning-600, #d97706); }
    .tl-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.2rem 1rem; }
    .tl-title { font-weight: 700; }
    .tl-when { color: var(--gray-500); font-size: 0.78rem; }
    .tl-detail { color: var(--gray-600); font-size: 0.85rem; margin-top: 0.1rem; }
  `,
})
export class LifecycleButton {
  private readonly leadService = inject(LeadService);

  readonly leadId = input.required<string>();
  readonly name = input<string>('');

  protected readonly open = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly timeline = signal<RetentionTimelineEntry[]>([]);

  protected readonly label = KIND_LABEL;
  protected readonly tone = KIND_TONE;
  protected readonly formatDateTime = formatDateTime;
  protected readonly monthLabel = chargeBackMonthLabel;

  protected async show(event: Event): Promise<void> {
    event.stopPropagation();
    this.open.set(true);
    this.error.set(null);
    this.timeline.set([]);
    this.loading.set(true);
    try {
      this.timeline.set(await this.leadService.leadLifecycle(this.leadId()));
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not load this lead’s lifecycle.'));
    } finally {
      this.loading.set(false);
    }
  }
}
