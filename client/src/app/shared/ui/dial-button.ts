import { Component, inject, input, signal } from '@angular/core';
import { LucidePhoneCall } from '@lucide/angular';
import { LeadService } from '../../core/services/lead.service';
import { ZoomPhoneService } from '../../core/services/zoom-phone.service';
import { apiErrorMessage } from '../../core/api';

/** Round call icon for list rows. The lists are masked (no phone), so it fetches the lead and
 *  hands the number straight to the dialer — it's never rendered. */
@Component({
  selector: 'app-dial-button',
  imports: [LucidePhoneCall],
  template: `
    <button
      type="button"
      class="dial-btn"
      [disabled]="busy()"
      (click)="dial($event)"
      [attr.aria-label]="'Dial ' + name()"
      title="Dial"
    >
      <svg lucidePhoneCall></svg>
    </button>
  `,
  styles: `
    :host { display: inline-flex; }
    .dial-btn {
      flex: none;
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: var(--success-50, #ecfdf5);
      color: var(--success-600, #059669);
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .dial-btn:hover:not(:disabled) { background: var(--success-600, #059669); color: #fff; }
    .dial-btn:disabled { opacity: 0.5; cursor: default; }
    .dial-btn svg { width: 15px; height: 15px; }
  `,
})
export class DialButton {
  private readonly leadService = inject(LeadService);
  private readonly zoom = inject(ZoomPhoneService);

  readonly leadId = input.required<string>();
  readonly name = input<string>('');
  readonly failed = signal<string | null>(null);
  readonly busy = signal(false);

  async dial(event: Event): Promise<void> {
    event.stopPropagation();
    this.busy.set(true);
    try {
      const lead = await this.leadService.getLead(this.leadId());
      if (!this.zoom.dial(lead.phone)) this.fail(`${lead.customerName}'s phone number cannot be dialed.`);
    } catch (err) {
      this.fail(apiErrorMessage(err, 'Could not dial this lead.'));
    } finally {
      this.busy.set(false);
    }
  }

  private fail(message: string): void {
    this.failed.set(message);
    alert(message);
  }
}
