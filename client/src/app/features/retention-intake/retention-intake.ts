import { Component, ElementRef, effect, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideCircleCheck, LucideSend } from '@lucide/angular';
import { RetentionIntakeInput, LeadService } from '../../core/services/lead.service';
import {
  ACCOUNT_OWNERSHIP_OPTIONS,
  ACCOUNT_TYPE_OPTIONS,
  CARD_TYPE_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  PLAN_TYPE_OPTIONS,
  US_STATE_OPTIONS,
} from '../../core/lead-options';
import { formatCardExpiry, sanitizeDigits, todayDateInput } from '../../core/format-utils';
import { parseLeadPaste } from '../../core/lead-paste-parser';
import { Select } from '../../shared/ui/select';
import { NoCopy } from '../../shared/no-copy.directive';
import { PhoneInput } from '../../shared/ui/phone-input';
import { DateInput } from '../../shared/ui/date-input';
import { apiErrorMessage } from '../../core/api';

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
  imports: [DateInput, PhoneInput, FormsModule, Select, NoCopy, LucideSend, LucideCircleCheck],
  templateUrl: './retention-intake.html',
  styleUrl: './retention-intake.css'
})
export class RetentionIntake {
  constructor(private readonly leadService: LeadService) {
    // Land focus on "Log another lead" so Enter starts the next one.
    effect(() => this.again()?.nativeElement.focus());
  }

  private readonly again = viewChild<ElementRef<HTMLButtonElement>>('again');
  /** Who was just submitted — shown on the confirmation so a long run of leads is traceable. */
  readonly lastSubmitted = signal<{ name: string; state?: string } | null>(null);

  readonly planTypeOptions = PLAN_TYPE_OPTIONS;
  readonly stateOptions = US_STATE_OPTIONS;
  readonly accountTypeOptions = ACCOUNT_TYPE_OPTIONS;
  readonly paymentMethodOptions = PAYMENT_METHOD_OPTIONS;
  readonly cardTypeOptions = CARD_TYPE_OPTIONS;
  readonly accountOwnershipOptions = ACCOUNT_OWNERSHIP_OPTIONS;
  /** Bounds for date-of-birth inputs — a plain `<input type="date">` has no digit limit
   * on the year segment otherwise, so nothing stops typing a year like "221465". */
  readonly minDob = '1900-01-01';
  readonly todayIso = todayDateInput();

  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly submitted = signal(false);
  /** Set once the user tries to submit, so errors don't shout at an untouched form. */
  readonly showErrors = signal(false);

  form: RetentionIntakeInput = {};

  readonly pasteText = signal('');
  readonly pasteError = signal<string | null>(null);
  readonly pasteWarnings = signal<string[]>([]);

  /** A paste replaces the box's whole contents — otherwise a second lead gets appended to the
   * first and the combined text matches no layout. */
  onPasteEvent(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text');
    if (text === undefined) return;
    event.preventDefault();
    this.onPaste(text);
  }

  /** Fills the form from a lead copied out of the sheet. Replaces whatever was typed, so the
   * form always reflects the paste; nothing is submitted until the user does that. */
  onPaste(text: string): void {
    this.pasteText.set(text);
    this.pasteWarnings.set([]);
    if (!text.trim()) {
      this.pasteError.set(null);
      return;
    }
    const result = parseLeadPaste(text);
    if (!result) {
      this.pasteError.set("Couldn't read that paste.");
      return;
    }
    this.form = { ...result.fields };
    this.pasteWarnings.set(result.warnings);
    this.pasteError.set(null);
  }

  /** Routing numbers are optional, but once started they must be exactly 9 digits. */
  routingInvalid(): boolean {
    const r = this.form.routingNumber;
    return !!r && r.length !== 9;
  }

  missing(): string[] {
    const missing: string[] = [];
    if (!this.form.customerName?.trim()) missing.push('Full name');
    if (!this.form.phone?.trim()) missing.push('Phone number');
    if (!this.form.state?.trim()) missing.push('State');
    if (this.routingInvalid()) missing.push('Routing number (must be exactly 9 digits)');
    return missing;
  }

  canSubmit(): boolean {
    return this.missing().length === 0 && !this.submitting();
  }

  onSsnChange(value: string): void {
    this.form.ssn = sanitizeDigits(value, 9);
  }

  onRoutingNumberChange(value: string): void {
    this.form.routingNumber = sanitizeDigits(value, 9);
  }

  onAccountNumberChange(value: string): void {
    this.form.accountNumber = sanitizeDigits(value, 17);
  }

  onCardNumberChange(value: string): void {
    this.form.cardNumber = sanitizeDigits(value, 19);
  }

  onCardExpiryChange(value: string): void {
    this.form.cardExpiry = formatCardExpiry(value);
  }

  async submit(): Promise<void> {
    this.showErrors.set(true);
    if (this.missing().length > 0) {
      this.error.set(null);
      setTimeout(() => document.querySelector<HTMLElement>('.invalid, .dropdown-trigger.invalid')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      return;
    }

    this.error.set(null);
    this.submitting.set(true);
    try {
      // Blank optional fields come through as '' — strip them so the API sees absent, not empty.
      const strip = (obj: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v !== null && v !== undefined));

      await this.leadService.submitRetentionIntake(strip(this.form) as RetentionIntakeInput);
      this.lastSubmitted.set({ name: this.form.customerName ?? '', state: this.form.state });
      this.form = {};
      this.showErrors.set(false);
      this.submitted.set(true);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not submit this lead. Check the details and try again.'));
    } finally {
      this.submitting.set(false);
    }
  }

  /** Dismisses the success banner so the same page is ready for the next lead. */
  logAnother(): void {
    this.submitted.set(false);
    this.pasteText.set('');
    this.pasteError.set(null);
    this.pasteWarnings.set([]);
  }
}
