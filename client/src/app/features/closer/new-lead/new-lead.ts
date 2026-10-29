import { Component, OnInit, computed, inject, signal } from '@angular/core';
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
import { UserService } from '../../../core/services/user.service';
import { calculateAge, formatCardExpiry, sanitizeDigits, todayDateInput } from '../../../core/format-utils';
import {
  ACCOUNT_OWNERSHIP_OPTIONS,
  ACCOUNT_TYPE_OPTIONS,
  CARD_TYPE_OPTIONS,
  DRAFT_REASON_OPTIONS,
  GENDER_OPTIONS,
  INCOME_SOURCE_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  NEED_OPTIONS,
  PAYER_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  PLAN_TYPE_OPTIONS,
  RETIRED_INCOME_OPTIONS,
  SMOKER_OPTIONS,
  US_STATE_OPTIONS,
} from '../../../core/lead-options';
import { Select } from '../../../shared/ui/select';
import { FormSections } from '../../../shared/ui/form-sections';
import { Modal } from '../../../shared/ui/modal';
import { NoCopy } from '../../../shared/no-copy.directive';
import { PhoneInput } from '../../../shared/ui/phone-input';
import { ZipInput } from '../../../shared/ui/zip-input';
import { DateInput } from '../../../shared/ui/date-input';
import { DraftDate } from '../../../shared/ui/draft-date';
import { apiErrorMessage } from '../../../core/api';

interface LookupUser {
  id: string;
  name: string;
  email: string;
}

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
  'paymentMethod',
  'accountTitle',
  'accountType',
  'accountOwnership',
  'accountOpeningState',
  'routingNumber',
  'accountNumber',
  'cardType',
  'cardNumber',
  'cardExpiry',
];

/**
 * Closer builds a lead entirely from scratch — self- or AI-sourced calls with no Junior
 * Closer in the loop. Combines the junior intake fields (Need & income) with the closer's
 * own enrichment fields in one form, submitted in one shot straight to the admin queue.
 * No draft support and no lead to load — this is a pure create, unlike enrich-lead.
 */
@Component({
  selector: 'app-new-lead',
  imports: [DateInput, DraftDate, PhoneInput, ZipInput, 
    FormsModule,
    RouterLink,
    Select,
    FormSections,
    Modal,
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
export class NewLead implements OnInit {
  private readonly leadService = inject(LeadService);
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);

  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly savingDraft = signal(false);
  readonly showErrors = signal(false);
  readonly showDraftReasonError = signal(false);
  readonly draftModalOpen = signal(false);

  readonly clients = signal<LookupUser[]>([]);
  readonly clientOptions = computed(() => this.clients().map((c) => ({ value: c.id, label: c.name })));

  readonly draftReasonOptions = DRAFT_REASON_OPTIONS;
  readonly maritalStatusOptions = MARITAL_STATUS_OPTIONS;
  readonly stateOptions = US_STATE_OPTIONS;
  readonly genderOptions = GENDER_OPTIONS;
  readonly smokerOptions = SMOKER_OPTIONS;
  readonly needOptions = NEED_OPTIONS;
  readonly incomeSourceOptions = INCOME_SOURCE_OPTIONS;
  readonly retiredIncomeOptions = RETIRED_INCOME_OPTIONS;
  readonly accountTypeOptions = ACCOUNT_TYPE_OPTIONS;
  readonly payerOptions = PAYER_OPTIONS;
  readonly paymentMethodOptions = PAYMENT_METHOD_OPTIONS;
  readonly cardTypeOptions = CARD_TYPE_OPTIONS;
  readonly accountOwnershipOptions = ACCOUNT_OWNERSHIP_OPTIONS;
  readonly planTypeOptions = PLAN_TYPE_OPTIONS;
  /** Bounds for date-of-birth inputs — a plain `<input type="date">` has no digit limit
   * on the year segment otherwise, so nothing stops typing a year like "221465". */
  readonly minDob = '1900-01-01';
  readonly todayIso = todayDateInput();

  form: CloserCreateLeadInput = {};
  /** Bumped on every field change so the completeness meter recomputes. */
  readonly revision = signal(0);

  async ngOnInit(): Promise<void> {
    try {
      this.clients.set(await this.userService.listClients());
    } catch {
      // Non-fatal — the client picker is optional, the rest of the form still works.
    }
  }

  /** Routing numbers are optional, but once started they must be exactly 9 digits. */
  readonly routingInvalid = computed(() => {
    this.revision();
    const r = this.form.routingNumber;
    return !!r && r.length !== 9;
  });

  readonly missing = computed(() => {
    this.revision();
    const f = this.form;
    const missing: string[] = [];
    if (!f.customerName?.trim()) missing.push("Customer's name");
    if (!f.phone?.trim()) missing.push('Phone');
    if (!f.state?.trim()) missing.push('State');
    if (this.routingInvalid()) missing.push('Routing number (must be exactly 9 digits)');
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

  onDobChange(value: string): void {
    this.form.dob = value;
    this.form.age = calculateAge(value);
    this.touch();
  }

  onSsnChange(value: string): void {
    this.form.ssn = sanitizeDigits(value, 9);
    this.touch();
  }

  onPayerSocialChange(value: string): void {
    this.form.payerSocial = sanitizeDigits(value, 9);
    this.touch();
  }

  onRoutingNumberChange(value: string): void {
    this.form.routingNumber = sanitizeDigits(value, 9);
    this.touch();
  }

  onAccountNumberChange(value: string): void {
    this.form.accountNumber = sanitizeDigits(value, 17);
    this.touch();
  }

  onCardNumberChange(value: string): void {
    this.form.cardNumber = sanitizeDigits(value, 19);
    this.touch();
  }

  onCardExpiryChange(value: string): void {
    this.form.cardExpiry = formatCardExpiry(value);
    this.touch();
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
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not submit the lead.'));
    } finally {
      this.submitting.set(false);
    }
  }

  openDraftModal(): void {
    this.showDraftReasonError.set(false);
    this.draftModalOpen.set(true);
  }

  closeDraftModal(): void {
    this.draftModalOpen.set(false);
  }

  /** Parks the call as a draft instead of submitting it — resumable from Drafts. */
  async saveDraft(): Promise<void> {
    if (!this.form.draftReason || (this.form.draftReason === 'OTHER' && !this.form.draftReasonNote?.trim())) {
      this.showDraftReasonError.set(true);
      return;
    }

    this.error.set(null);
    this.showDraftReasonError.set(false);
    this.savingDraft.set(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(this.form).filter(([, v]) => v !== '' && v !== null && v !== undefined),
      ) as CloserCreateLeadInput;
      await this.leadService.createLeadAsCloserDraft(payload);
      this.draftModalOpen.set(false);
      this.router.navigateByUrl('/closer/drafts');
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not save this as a draft.'));
    } finally {
      this.savingDraft.set(false);
    }
  }
}
