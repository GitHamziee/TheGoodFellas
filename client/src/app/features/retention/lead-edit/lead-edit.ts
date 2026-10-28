import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  LucideArrowLeft,
  LucideBanknote,
  LucideCircleAlert,
  LucideHeartPulse,
  LucideNotebookPen,
  LucidePhoneCall,
  LucidePhoneForwarded,
  LucideSend,
  LucideShieldCheck,
  LucideUser,
  LucideUsers,
} from '@lucide/angular';
import { RetentionSubmitInput, LeadService } from '../../../core/services/lead.service';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { ZoomPhoneService } from '../../../core/services/zoom-phone.service';
import { Lead, LeadNote } from '../../../core/models/lead.model';
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
import { formatCardExpiry, formatDateTime, getInitials, sanitizeDigits, toDateInput, todayDateInput } from '../../../core/format-utils';
import { SkeletonRows } from '../../../shared/ui/ui';
import { Modal } from '../../../shared/ui/modal';
import { Select } from '../../../shared/ui/select';
import { FormSections } from '../../../shared/ui/form-sections';
import { NoCopy } from '../../../shared/no-copy.directive';
import { PhoneInput } from '../../../shared/ui/phone-input';
import { ZipInput } from '../../../shared/ui/zip-input';
import { DateInput } from '../../../shared/ui/date-input';
import { apiErrorMessage } from '../../../core/api';

/** Fields tracked for the completeness meter — same set the sheet import can fill plus
 * everything a Retention person can add on top of it. */
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

interface LookupUser {
  id: string;
  name: string;
  email: string;
}

/**
 * Opens a sheet-imported RETENTION lead for editing — pre-filled with whatever the sheet
 * gave us, gaps left for the Retention person to fill in. Any Retention account may open any
 * teammate's lead here, not just their own (see the teammate filter on the Leads page) — the
 * server enforces this the same way, no ownership check on the submit endpoint.
 */
@Component({
  selector: 'app-retention-lead-edit',
  imports: [DateInput, PhoneInput, ZipInput, 
    FormsModule,
    RouterLink,
    SkeletonRows,
    Modal,
    Select,
    FormSections,
    NoCopy,
    LucideSend,
    LucideUser,
    LucideUsers,
    LucideHeartPulse,
    LucideShieldCheck,
    LucideBanknote,
    LucideNotebookPen,
    LucideCircleAlert,
    LucideArrowLeft,
    LucidePhoneCall,
    LucidePhoneForwarded,
  ],
  templateUrl: './lead-edit.html',
})
export class RetentionLeadEdit implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly leadService = inject(LeadService);
  private readonly userService = inject(UserService);
  private readonly auth = inject(AuthService);
  private readonly zoom = inject(ZoomPhoneService);

  readonly leadId = this.route.snapshot.paramMap.get('id')!;
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly savingDraft = signal(false);
  readonly showErrors = signal(false);
  readonly showDraftReasonError = signal(false);
  readonly draftModalOpen = signal(false);
  readonly lead = signal<Lead | null>(null);
  /** Follow-up notes the Retention Manager left on this lead (only readable on your own leads). */
  readonly notes = signal<LeadNote[]>([]);
  readonly formatDateTime = formatDateTime;

  readonly currentUserId = computed(() => this.auth.user()?.id ?? null);
  readonly isMine = computed(() => this.lead()?.retention?.id === this.currentUserId());
  readonly isDraft = computed(() => this.lead()?.status === 'DRAFT');
  readonly isReturned = computed(() => this.lead()?.status === 'RETURNED_TO_RETENTION');
  /** Only whoever marked it can open a callback lead, so this is always "my callback". */
  readonly isCallback = computed(() => !!this.lead()?.callbackById);
  readonly savingCallback = signal(false);

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
  readonly getInitials = getInitials;
  /** Bounds for date-of-birth inputs — a plain `<input type="date">` has no digit limit
   * on the year segment otherwise, so nothing stops typing a year like "221465". */
  readonly minDob = '1900-01-01';
  readonly todayIso = todayDateInput();

  form: RetentionSubmitInput = {};
  /** Bumped on every field change so the completeness meter recomputes. */
  readonly revision = signal(0);

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

  async ngOnInit(): Promise<void> {
    try {
      this.clients.set(await this.userService.listClients());
    } catch {
      // Non-fatal — the client picker is optional, the rest of the form still works.
    }

    try {
      const lead = await this.leadService.getLead(this.leadId);
      this.lead.set(lead);
      this.leadService.leadNotes(lead.id).then((n) => this.notes.set(n)).catch(() => undefined);
      this.form = {
        customerName: lead.customerName,
        maritalStatus: lead.maritalStatus ?? undefined,
        phone: lead.phone,
        state: lead.state,
        zipcode: lead.zipcode ?? undefined,
        birthState: lead.birthState ?? undefined,
        gender: lead.gender ?? undefined,
        smoker: lead.smoker ?? undefined,
        dob: toDateInput(lead.dob) || undefined,
        age: lead.age ?? undefined,
        height: lead.height ?? undefined,
        weight: lead.weight ?? undefined,
        healthConditions: lead.healthConditions ?? undefined,
        need: lead.need ?? undefined,
        incomeSource: lead.incomeSource ?? undefined,
        retiredIncomeType: lead.retiredIncomeType ?? undefined,
        natureOfDisability: lead.natureOfDisability ?? undefined,
        annualIncome: lead.annualIncome ?? undefined,
        mailingAddress: lead.mailingAddress ?? undefined,
        email: lead.email ?? undefined,
        yearlyIncome: lead.yearlyIncome ?? undefined,
        ssn: lead.ssn ?? undefined,
        dlStateId: lead.dlStateId ?? undefined,
        doctorName: lead.doctorName ?? undefined,
        beneficiaryRelation: lead.beneficiaryRelation ?? undefined,
        beneficiaryName: lead.beneficiaryName ?? undefined,
        beneficiaryDob: toDateInput(lead.beneficiaryDob) || undefined,
        medications: lead.medications ?? undefined,
        carrierName: lead.carrierName ?? undefined,
        planType: lead.planType ?? undefined,
        suggestedClientId: lead.suggestedClientId ?? undefined,
        coverageAmount: lead.coverageAmount ?? undefined,
        monthlyPremiums: lead.monthlyPremiums ?? undefined,
        initialDraftDate: toDateInput(lead.initialDraftDate) || undefined,
        futureDraftDate: toDateInput(lead.futureDraftDate) || undefined,
        payer: lead.payer ?? undefined,
        // Older leads predate this field — infer it from whichever group they already have
        // data in, so an existing record doesn't suddenly show neither section.
        paymentMethod:
          lead.paymentMethod ??
          (lead.cardNumber
            ? 'CARD'
            : lead.bankName || lead.routingNumber || lead.accountNumber
              ? 'BANK_ACCOUNT'
              : undefined),
        bankName: lead.bankName ?? undefined,
        accountTitle: lead.accountTitle ?? undefined,
        payerSocial: lead.payerSocial ?? undefined,
        accountType: lead.accountType ?? undefined,
        accountOwnership: lead.accountOwnership ?? undefined,
        accountOpeningState: lead.accountOpeningState ?? undefined,
        routingNumber: lead.routingNumber ?? undefined,
        accountNumber: lead.accountNumber ?? undefined,
        cardType: lead.cardType ?? undefined,
        cardNumber: lead.cardNumber ?? undefined,
        cardExpiry: lead.cardExpiry ?? undefined,
        closerNotes: lead.closerNotes ?? undefined,
        draftReason: lead.draftReason ?? undefined,
        draftReasonNote: lead.draftReasonNote ?? undefined,
      };
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not load this lead.'));
    } finally {
      this.loading.set(false);
    }
  }

  /** Dials whatever is in the phone field now, so a corrected number is the one called. */
  dialLead(): void {
    if (!this.zoom.dial(this.form.phone)) this.error.set('This phone number cannot be dialed.');
  }

  touch(): void {
    this.revision.update((n) => n + 1);
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
      ) as RetentionSubmitInput;
      const lead = await this.leadService.retentionSubmit(this.leadId, payload);
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

  /** Parks the lead instead of submitting it — reappears in the shared queue for any
   *  teammate (including this one) to resume later. */
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
      await this.leadService.retentionSaveDraft(this.leadId, payload);
      this.draftModalOpen.set(false);
      this.router.navigateByUrl('/retention/leads');
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not save this as a draft.'));
    } finally {
      this.savingDraft.set(false);
    }
  }

  /** Flips the Callback flag only — no form fields are sent. Either direction closes the form
   *  back to the leads list. */
  async toggleCallback(): Promise<void> {
    this.error.set(null);
    this.savingCallback.set(true);
    try {
      if (this.isCallback()) {
        await this.leadService.retentionRemoveCallback(this.leadId);
      } else {
        await this.leadService.retentionMarkCallback(this.leadId);
      }
      this.router.navigateByUrl('/retention/leads');
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not update the callback.'));
    } finally {
      this.savingCallback.set(false);
    }
  }
}
