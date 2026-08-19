import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  LucideArrowLeft,
  LucideBanknote,
  LucideCircleAlert,
  LucideHeartPulse,
  LucideNotebookPen,
  LucideSend,
  LucideShieldCheck,
  LucideUser,
  LucideUsers,
  LucideWallet,
} from '@lucide/angular';
import { CloserCreateLeadInput, LeadService } from '../../../core/services/lead.service';
import {
  ACCOUNT_TYPE_OPTIONS,
  GENDER_OPTIONS,
  INCOME_SOURCE_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  NEED_OPTIONS,
  PAYER_OPTIONS,
  PLAN_TYPE_OPTIONS,
  RETIRED_INCOME_OPTIONS,
  SMOKER_OPTIONS,
} from '../../../core/lead-options';
import { Select } from '../../../shared/ui/select';
import { NoCopy } from '../../../shared/no-copy.directive';

/** Fields tracked for the completeness meter — same idea as enrich-lead's, plus the
 *  junior-intake fields since this form covers both halves at once. */
const TRACKED: (keyof CloserCreateLeadInput)[] = [
  'mailingAddress',
  'email',
  'ssn',
  'dlStateId',
  'doctorName',
  'need',
  'incomeSource',
  'annualIncome',
  'beneficiaryName',
  'beneficiaryRelation',
  'beneficiaryDob',
  'medications',
  'carrierName',
  'planType',
  'coverageAmount',
  'monthlyPremiums',
  'initialDraftDate',
  'payer',
  'accountTitle',
  'accountType',
  'routingNumber',
  'accountNumber',
];

/**
 * Closer builds a lead entirely from scratch — self- or AI-sourced calls with no Junior
 * Closer in the loop. Combines the junior intake fields (Need & income) with the closer's
 * own enrichment fields in one form, submitted in one shot straight to the admin queue.
 * No draft support and no lead to load — this is a pure create, unlike enrich-lead.
 */
@Component({
  selector: 'app-new-lead',
  imports: [
    FormsModule,
    RouterLink,
    Select,
    NoCopy,
    LucideSend,
    LucideUser,
    LucideUsers,
    LucideHeartPulse,
    LucideShieldCheck,
    LucideBanknote,
    LucideWallet,
    LucideNotebookPen,
    LucideCircleAlert,
    LucideArrowLeft,
  ],
  templateUrl: './new-lead.html',
})
export class NewLead {
  private readonly leadService = inject(LeadService);
  private readonly router = inject(Router);

  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly showErrors = signal(false);

  readonly maritalStatusOptions = MARITAL_STATUS_OPTIONS;
  readonly genderOptions = GENDER_OPTIONS;
  readonly smokerOptions = SMOKER_OPTIONS;
  readonly needOptions = NEED_OPTIONS;
  readonly incomeSourceOptions = INCOME_SOURCE_OPTIONS;
  readonly retiredIncomeOptions = RETIRED_INCOME_OPTIONS;
  readonly accountTypeOptions = ACCOUNT_TYPE_OPTIONS;
  readonly payerOptions = PAYER_OPTIONS;
  readonly planTypeOptions = PLAN_TYPE_OPTIONS;

  form: CloserCreateLeadInput = {};
  /** Bumped on every field change so the completeness meter recomputes. */
  readonly revision = signal(0);

  readonly missing = computed(() => {
    this.revision();
    const f = this.form;
    const missing: string[] = [];
    if (!f.customerName?.trim()) missing.push("Customer's name");
    if (!f.phone?.trim()) missing.push('Phone');
    if (!f.state?.trim()) missing.push('State');
    return missing;
  });

  readonly completeness = computed(() => {
    this.revision();
    const filled = TRACKED.filter((key) => {
      const v = this.form[key];
      return v !== undefined && v !== null && v !== '';
    }).length;
    return Math.round((filled / TRACKED.length) * 100);
  });

  readonly canSubmit = computed(() => this.missing().length === 0 && !this.submitting());

  /** Display-only — derived from monthly premium, not a stored field. */
  readonly annualPremium = computed(() => {
    this.revision();
    const monthly = this.form.monthlyPremiums;
    return typeof monthly === 'number' ? monthly * 12 : null;
  });

  touch(): void {
    this.revision.update((n) => n + 1);
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
      const payload = Object.fromEntries(
        Object.entries(this.form).filter(([, v]) => v !== '' && v !== null && v !== undefined),
      ) as CloserCreateLeadInput;
      await this.leadService.createLeadAsCloser(payload);
      this.router.navigateByUrl('/closer/history');
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not submit the lead.');
    } finally {
      this.submitting.set(false);
    }
  }
}
