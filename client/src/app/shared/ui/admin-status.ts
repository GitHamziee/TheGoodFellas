import { Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideChevronDown, LucideCheck, LucideCircleX } from '@lucide/angular';
import { apiErrorMessage } from '../../core/api';
import { ADMIN_STATUS_OPTIONS } from '../../core/lead-options';
import { Lead, LeadAdminStatus } from '../../core/models/lead.model';
import { AuthService } from '../../core/services/auth.service';
import { LeadService } from '../../core/services/lead.service';
import { uiZoom } from '../../core/ui-zoom';
import { Modal } from './modal';

const PRE_PAYMENT_STATUSES: LeadAdminStatus[] = ['UNDERWRITING_REVIEW', 'APPROVED', 'DECLINED'];

@Component({
  selector: 'app-admin-status-badge',
  template: `@if (label(); as text) {<span [class]="cls()">{{ text }}</span>}`,
})
export class AdminStatusBadge {
  readonly status = input<LeadAdminStatus | null | undefined>(null);
  readonly label = computed(() => ADMIN_STATUS_OPTIONS.find((o) => o.value === this.status())?.label ?? null);
  readonly cls = computed(() => `badge badge--admin-status badge--admin-${(this.status() ?? '').toLowerCase()}`);
}

/**
 * Admin/Manager tracking-status pill. Looks like the other status badges; clicking it opens a
 * small menu (same look as the row "⋯" menu) to change it. Saves on pick and emits the updated lead.
 */
@Component({
  selector: 'app-admin-status-control',
  imports: [FormsModule, Modal, LucideChevronDown, LucideCheck, LucideCircleX],
  template: `
    @if (readOnly()) {
      @if (label(); as text) {
        <span [class]="cls()"><span class="trk-dot"></span>{{ text }}</span>
      }
    } @else {
      <button type="button" [class]="cls()" [disabled]="busy()" aria-haspopup="menu" [attr.aria-expanded]="open()" (click)="toggle($event)">
        <span class="trk-dot"></span>
        {{ label() ?? 'Set tracking' }}
        <svg lucideChevronDown></svg>
      </button>
    }
    @if (open()) {
      <div class="panel" role="menu" [style.top.px]="top()" [style.left.px]="left()">
        @if (lead().adminStatus) {
          <button type="button" class="menu-item" (click)="pick(null)">Clear status</button>
        }
        @for (o of choices(); track o.value) {
          <button type="button" class="menu-item" (click)="pick(o.value)">
            {{ o.label }}
            @if (o.value === lead().adminStatus) {<svg lucideCheck class="tick"></svg>}
          </button>
        }
      </div>
    }
    @if (declining()) {
      <app-modal title="Decline lead" [subtitle]="lead().customerName" (close)="declining.set(false)">
        <div class="form-grid">
          <label class="full">
            <span>Reason <span class="hint">Optional</span></span>
            <input type="text" maxlength="200" [(ngModel)]="declineReason" name="declineReason" placeholder="e.g. Client declined on call" />
          </label>
        </div>
        <div footer>
          <button type="button" class="btn btn--danger" [disabled]="busy()" (click)="confirmDecline()">
            <svg lucideCircleX></svg> Confirm decline
          </button>
        </div>
      </app-modal>
    }
    @if (error()) {
      <div class="error">{{ error() }}</div>
    }
  `,
  styles: `
    :host { display: inline-block; }
    .panel {
      position: fixed; z-index: 60; min-width: 12rem; padding: 0.3rem;
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16); display: flex; flex-direction: column;
    }
    .menu-item {
      display: flex; align-items: center; gap: 0.55rem; padding: 0.5rem 0.65rem; border: 0;
      border-radius: var(--radius-sm); background: transparent; color: var(--text);
      font: inherit; font-size: 0.82rem; font-weight: 600; text-align: left; cursor: pointer;
    }
    .menu-item:hover { background: var(--gray-50); }
    .tick { margin-left: auto; width: 14px; height: 14px; color: var(--gray-500); }
  `,
})
export class AdminStatusControl {
  private readonly leadService = inject(LeadService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Retention Manager reads the tracking label but never changes it. */
  private readonly auth = inject(AuthService);
  protected readonly readOnly = computed(() => this.auth.role() === 'RETENTION_MANAGER');

  readonly lead = input.required<Lead>();
  readonly changed = output<Lead>();

  readonly options = ADMIN_STATUS_OPTIONS;
  /** A paid lead sitting at Approval Confirmed can't go back to the pre-payment outcomes; "Approved" keeps every option. */
  readonly choices = computed(() =>
    this.lead().paymentStatus === 'PAID' && this.lead().adminStatus === 'APPROVAL_CONFIRMED'
      ? this.options.filter((o) => !PRE_PAYMENT_STATUSES.includes(o.value))
      : this.options
  );
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  protected readonly open = signal(false);
  protected readonly declining = signal(false);
  protected declineReason = '';
  protected readonly top = signal(0);
  protected readonly left = signal(0);

  readonly label = computed(() => this.options.find((o) => o.value === this.lead().adminStatus)?.label ?? null);
  readonly cls = computed(() => {
    const s = this.lead().adminStatus;
    return s ? `trk trk--${s.toLowerCase()}` : 'trk trk--empty';
  });

  protected toggle(event: Event): void {
    event.stopPropagation();
    if (this.open()) return this.open.set(false);
    const z = uiZoom();
    const r = this.host.nativeElement.getBoundingClientRect();
    const panelHeight = 240;
    this.top.set((r.bottom + panelHeight * z > window.innerHeight ? Math.max(8, r.top - (panelHeight + 4) * z) : r.bottom + 4 * z) / z);
    this.left.set(Math.max(8, r.left / z));
    this.open.set(true);
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: Event): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  @HostListener('window:resize')
  close(): void {
    this.open.set(false);
  }

  async pick(next: LeadAdminStatus | null): Promise<void> {
    this.open.set(false);
    if (next === (this.lead().adminStatus ?? null)) return;
    // Declining a lead that is still awaiting its client rejects it, so ask for the reason first.
    if (next === 'DECLINED' && (this.lead().status === 'ASSIGNED' || this.lead().status === 'ASSIGNED_EXTERNAL')) {
      this.declineReason = '';
      this.declining.set(true);
      return;
    }
    await this.save(next);
  }

  protected async confirmDecline(): Promise<void> {
    await this.save('DECLINED', this.declineReason.trim() || undefined);
    this.declining.set(false);
  }

  private async save(next: LeadAdminStatus | null, reason?: string): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      this.changed.emit(await this.leadService.setAdminStatus(this.lead().id, next, reason));
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not update status.'));
    } finally {
      this.busy.set(false);
    }
  }
}
