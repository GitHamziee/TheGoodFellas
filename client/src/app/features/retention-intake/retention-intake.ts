import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideCircleCheck, LucideSend } from '@lucide/angular';
import { RetentionIntakeInput, LeadService } from '../../core/services/lead.service';
import { ACCOUNT_TYPE_OPTIONS, PLAN_TYPE_OPTIONS } from '../../core/lead-options';
import { Select } from '../../shared/ui/select';
import { NoCopy } from '../../shared/no-copy.directive';

/**
 * Public, unauthenticated intake form for AI-sourced ("Retention") leads — reachable at
 * /retention-intake with no login required. Whoever just worked a call (an outside calling
 * team, not necessarily anyone with an account here) types the details in directly; this
 * replaces the old Google Sheet the same data used to be logged into by hand. Submissions
 * land unassigned in Admin's Retention Imports queue, same as the sheet import used to
 * produce — see server/src/services/lead.service.ts#submitRetentionIntake.
 */
@Component({
  selector: 'app-retention-intake',
  imports: [FormsModule, Select, NoCopy, LucideSend, LucideCircleCheck],
  templateUrl: './retention-intake.html',
  styles: `
    :host {
      display: block;
      min-height: 100vh;
      padding: 2.5rem 1.5rem;
      box-sizing: border-box;
    }
  `,
})
export class RetentionIntake {
  constructor(private readonly leadService: LeadService) {}

  readonly planTypeOptions = PLAN_TYPE_OPTIONS;
  readonly accountTypeOptions = ACCOUNT_TYPE_OPTIONS;

  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly submitted = signal(false);
  /** Set once the user tries to submit, so errors don't shout at an untouched form. */
  readonly showErrors = signal(false);

  form: RetentionIntakeInput = {};

  missing(): string[] {
    const missing: string[] = [];
    if (!this.form.customerName?.trim()) missing.push('Full name');
    if (!this.form.phone?.trim()) missing.push('Phone number');
    if (!this.form.state?.trim()) missing.push('State');
    return missing;
  }

  canSubmit(): boolean {
    return this.missing().length === 0 && !this.submitting();
  }

  async submit(): Promise<void> {
    this.showErrors.set(true);
    if (this.missing().length > 0) {
      this.error.set(`Still needed: ${this.missing().join(', ')}.`);
      return;
    }

    this.error.set(null);
    this.submitting.set(true);
    try {
      // Blank optional fields come through as '' — strip them so the API sees absent, not empty.
      const strip = (obj: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v !== null && v !== undefined));

      await this.leadService.submitRetentionIntake(strip(this.form) as RetentionIntakeInput);
      this.form = {};
      this.showErrors.set(false);
      this.submitted.set(true);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not submit this lead. Check the details and try again.');
    } finally {
      this.submitting.set(false);
    }
  }

  /** Dismisses the success banner so the same page is ready for the next lead. */
  logAnother(): void {
    this.submitted.set(false);
  }
}
