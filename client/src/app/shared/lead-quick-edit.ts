import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LeadService } from '../core/services/lead.service';
import { Lead } from '../core/models/lead.model';
import { US_STATE_OPTIONS } from '../core/lead-options';
import { Modal } from './ui/modal';
import { Select } from './ui/select';
import { PhoneInput } from './ui/phone-input';
import { ZipInput } from './ui/zip-input';
import { apiErrorMessage } from '../core/api';

/**
 * Admin's "fix a rejected lead before reassigning it" modal. Lived on the old Assignment
 * Queue page; shared now so the CPA/Retention and CPL pages offer the same correction.
 */
@Component({
  selector: 'app-lead-quick-edit',
  imports: [FormsModule, Modal, Select, PhoneInput, ZipInput],
  template: `
    <app-modal title="Edit lead" subtitle="Correct the details a client declined, then reassign." [wide]="true" (close)="closed.emit()">
      @if (error()) {
        <div class="error">{{ error() }}</div>
      }
      @if (lead().rejectionReason) {
        <div class="warn">Client's Reason for declining: {{ lead().rejectionReason }}</div>
      }

      <div class="form-grid">
        <label>
          Customer name
          <input type="text" [(ngModel)]="customerName" name="customerName" />
        </label>
        <label>
          Phone
          <input appPhone [(ngModel)]="phone" name="phone" />
        </label>
        <label>
          State
          <app-select [options]="stateOptions" [searchable]="true" [(ngModel)]="state" name="state" />
        </label>
        <label>
          Zipcode
          <input appZip [(ngModel)]="zipcode" name="zipcode" />
        </label>
        @if (isCpl()) {
          <label class="full">
            Notes
            <textarea rows="3" [(ngModel)]="juniorNotes" name="juniorNotes"></textarea>
          </label>
        } @else {
          <label>
            Marital status
            <input type="text" [(ngModel)]="maritalStatus" name="maritalStatus" />
          </label>
          <label class="full">
            Health conditions
            <input type="text" [(ngModel)]="healthConditions" name="healthConditions" />
          </label>
          <label class="full">
            Closer notes
            <textarea rows="3" [(ngModel)]="closerNotes" name="closerNotes"></textarea>
          </label>
        }
      </div>

      <div footer>
        <button type="button" class="btn" [disabled]="busy()" (click)="save()">
          @if (busy()) {
            <span class="spinner"></span> Saving…
          } @else {
            Save changes
          }
        </button>
      </div>
    </app-modal>
  `,
})
export class LeadQuickEdit implements OnInit {
  private readonly leadService = inject(LeadService);

  readonly lead = input.required<Lead>();
  readonly isCpl = computed(() => this.lead().leadType === 'CPL');
  readonly saved = output<Lead>();
  readonly closed = output<void>();

  readonly stateOptions = US_STATE_OPTIONS;
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  // The modal is created fresh per lead (`@if`), so seeding from the input once is enough.
  customerName = '';
  phone = '';
  state = '';
  zipcode = '';
  maritalStatus = '';
  healthConditions = '';
  closerNotes = '';
  juniorNotes = '';

  ngOnInit(): void {
    const l = this.lead();
    this.customerName = l.customerName;
    this.phone = l.phone;
    this.state = l.state;
    this.zipcode = l.zipcode ?? '';
    this.maritalStatus = l.maritalStatus ?? '';
    this.healthConditions = l.healthConditions ?? '';
    this.closerNotes = l.closerNotes ?? '';
    this.juniorNotes = l.juniorNotes ?? '';
  }

  async save(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      const base = {
        customerName: this.customerName,
        phone: this.phone,
        state: this.state,
        zipcode: this.zipcode || undefined,
      };
      const input = this.isCpl()
        ? { ...base, juniorNotes: this.juniorNotes || undefined }
        : {
            ...base,
            maritalStatus: this.maritalStatus || undefined,
            healthConditions: this.healthConditions || undefined,
            closerNotes: this.closerNotes || undefined,
          };
      const id = this.lead().id;
      const updated = await this.leadService.editLead(id, input);
      this.saved.emit(updated);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not save changes.'));
    } finally {
      this.busy.set(false);
    }
  }
}
