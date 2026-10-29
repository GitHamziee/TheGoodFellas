import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  LucideArrowLeft,
  LucideBanknote,
  LucideCircleAlert,
  LucideCircleCheck,
  LucideCircleX,
  LucideHeartPulse,
  LucideNotebookPen,
  LucideSend,
  LucideShieldCheck,
  LucideUser,
  LucideUsers,
  LucideWallet,
} from '@lucide/angular';
import { RetentionSubmitInput, LeadService } from '../../../core/services/lead.service';
import { UserService } from '../../../core/services/user.service';
import { calculateAge, formatMoney, formatCardExpiry, sanitizeDigits, todayDateInput } from '../../../core/format-utils';
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
import { apiErrorMessage } from '../../../core/api';
import { clientNeedsLeadId, retentionMissing, scrollToFirstInvalid } from '../retention-required';
import { ClientCoverage } from '../../../core/models/user.model';

/** Fields tracked for the completeness meter — same set as Closer's new-lead form. */
const TRACKED: (keyof RetentionSubmitInput)[] = [
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
 * A Retention person builds a lead from scratch — same pattern as Closer's new-lead: a
 * self- or AI-sourced call worked directly, no public intake form or admin hand-out
 * involved. Combines the full junior-intake + closer-enrichment field set in one form,
 * submitted straight to the admin queue as SUBMITTED. No draft support and no lead to
 * load — this is a pure create, unlike lead-edit.
 */
@Component({
  selector: 'app-retention-new-lead',
  imports: [DateInput, PhoneInput, ZipInput, 
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
    LucideCircleCheck,
    LucideCircleX,
    LucideArrowLeft,
  ],
  templateUrl: './new-lead.html',
})
export class RetentionNewLead implements OnInit {
  private readonly leadService = inject(LeadService);
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);

  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly savingDraft = signal(false);
  readonly showErrors = signal(false);
  readonly showDraftReasonError = signal(false);
  readonly draftModalOpen = signal(false);

  readonly coverage = signal<ClientCoverage[]>([]);
  /** Clients licensed in the chosen state; all clients until a state is picked. */
  readonly clientOptions = computed(() => {
    this.revision();
    const state = this.form.state;
    return this.coverage()
      .filter((c) => !state || c.states.includes(state))
      .map((c) => ({ value: c.id, label: c.name }));
  });
  /** Plans the suggested client doesn't take are shown crossed out and can't be picked. */
  readonly planOptions = computed(() => {
    const accepted = this.suggestedClient()?.acceptedPlans;
    return PLAN_TYPE_OPTIONS.map((o) => ({ ...o, disabled: !!accepted && !accepted.includes(o.value) }));
  });
  readonly formatMoney = formatMoney;
  /** Lowest monthly premium the suggested client accepts, if set. */
  readonly suggestedClient = computed(() => {
    this.revision();
    return this.coverage().find((c) => c.id === this.form.suggestedClientId) ?? null;
  });
  /** AG / FCF leads carry the client's own lead ID; hidden for every other client. */
  readonly needsLeadId = computed(() => clientNeedsLeadId(this.suggestedClient()?.name));
  readonly suggestedMinimumPremium = computed(() => this.suggestedClient()?.minimumPremium ?? null);
  /** Carriers of the suggested client in the chosen state. */
  readonly carrierOptions = computed(() => {
    this.revision();
    const { state, suggestedClientId, carrierName } = this.form;
    const client = this.coverage().find((c) => c.id === suggestedClientId);
    const list = client
      ? (client.stateCarriers.find((s) => s.state === state)?.carriers ?? client.carriers)
      : [];
    const names = carrierName && !list.includes(carrierName) ? [...list, carrierName] : list;
    return names.map((c) => ({ value: c, label: c }));
  });

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

  form: RetentionSubmitInput = {};
  /** Bumped on every field change so the completeness meter recomputes. */
  readonly revision = signal(0);

  async ngOnInit(): Promise<void> {
    try {
      this.coverage.set(await this.userService.getStateSheet());
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

  /** Required fields still empty — see retention-required.ts for the optional ones. */
  readonly missingFields = computed(() => {
    this.revision();
    return retentionMissing(this.form, this.needsLeadId());
  });
  private readonly missingKeys = computed(() => new Set(this.missingFields().map((m) => m.key)));

  /** Highlight a field only after a submit attempt, and only while it's still empty. */
  err(key: string): boolean {
    return this.showErrors() && this.missingKeys().has(key);
  }

  readonly completeness = computed(() => {
    this.revision();
    const filled = TRACKED.filter((key) => {
      const v = this.form[key];
      return v !== undefined && v !== null && v !== '';
    }).length;
    return Math.round((filled / TRACKED.length) * 100);
  });

  readonly canSubmit = computed(() => !this.submitting());

  /** Display-only — derived from monthly premium, not a stored field. */
  readonly annualPremium = computed(() => {
    this.revision();
    const monthly = this.form.monthlyPremiums;
    return typeof monthly === 'number' ? monthly * 12 : null;
  });

  onStateChange(state: string): void {
    this.form.state = state;
    const client = this.coverage().find((c) => c.id === this.form.suggestedClientId);
    if (client && !client.states.includes(state)) this.onClientChange(undefined);
    else this.touch();
  }

  onClientChange(clientId: string | undefined): void {
    this.form.suggestedClientId = clientId;
    this.form.carrierName = undefined;
    if (!clientNeedsLeadId(this.coverage().find((c) => c.id === clientId)?.name)) this.form.clientLeadId = undefined;
    const accepted = this.coverage().find((c) => c.id === clientId)?.acceptedPlans;
    if (accepted && this.form.planType && !accepted.includes(this.form.planType)) this.form.planType = undefined;
    this.touch();
  }

  addBeneficiary(): void {
    this.form.extraBeneficiaries = [...(this.form.extraBeneficiaries ?? []), { name: '', relation: '', dob: '' }];
    this.touch();
  }

  removeBeneficiary(index: number): void {
    this.form.extraBeneficiaries = (this.form.extraBeneficiaries ?? []).filter((_, i) => i !== index);
    this.touch();
  }

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
    const missing = this.missingFields().length;
    if (missing > 0) {
      this.error.set(`Fill in the ${missing} highlighted field${missing === 1 ? '' : 's'} before submitting.`);
      scrollToFirstInvalid();
      return;
    }

    this.error.set(null);
    this.submitting.set(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(this.form).filter(([, v]) => v !== '' && v !== null && v !== undefined),
      ) as RetentionSubmitInput;
      const lead = await this.leadService.createLeadAsRetention(payload);
      this.router.navigate(['/retention/history'], { queryParams: { highlight: lead.id } });
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

  /** Parks the call as a draft instead of submitting it — resumable from the Retention queue. */
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
      ) as RetentionSubmitInput;
      await this.leadService.createLeadAsRetentionDraft(payload);
      this.draftModalOpen.set(false);
      this.router.navigateByUrl('/retention/leads');
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not save this as a draft.'));
    } finally {
      this.savingDraft.set(false);
    }
  }
}
