import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '../../core/api';
import { ADMIN_STATUS_OPTIONS } from '../../core/lead-options';
import { Lead, LeadAdminStatus } from '../../core/models/lead.model';
import { LeadService } from '../../core/services/lead.service';
import { Select } from './select';

const NONE = '';

@Component({
  selector: 'app-admin-status-badge',
  template: `@if (label(); as text) {<span class="badge badge--admin-status">{{ text }}</span>}`,
})
export class AdminStatusBadge {
  readonly status = input<LeadAdminStatus | null | undefined>(null);
  readonly label = computed(() => ADMIN_STATUS_OPTIONS.find((o) => o.value === this.status())?.label ?? null);
}

/** Admin picker for a lead's tracking status. Saves on change and emits the updated lead. */
@Component({
  selector: 'app-admin-status-control',
  imports: [FormsModule, Select],
  template: `
    <div class="admin-status-control">
      <app-select
        [options]="options"
        [ngModel]="lead().adminStatus ?? NONE"
        (ngModelChange)="save($event)"
        [disabled]="busy()"
        ariaLabel="Status"
        placeholder="Status"
      />
      @if (error()) {
        <div class="error">{{ error() }}</div>
      }
    </div>
  `,
})
export class AdminStatusControl {
  private readonly leadService = inject(LeadService);

  readonly NONE = NONE;
  readonly lead = input.required<Lead>();
  readonly changed = output<Lead>();

  readonly options = [{ value: NONE, label: 'No status' }, ...ADMIN_STATUS_OPTIONS];
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  async save(value: string): Promise<void> {
    const next = (value || null) as LeadAdminStatus | null;
    if (next === (this.lead().adminStatus ?? null)) return;
    this.error.set(null);
    this.busy.set(true);
    try {
      this.changed.emit(await this.leadService.setAdminStatus(this.lead().id, next));
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not update status.'));
    } finally {
      this.busy.set(false);
    }
  }
}
