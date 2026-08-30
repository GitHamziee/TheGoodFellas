import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
} from '@lucide/angular';
import { RetentionSubmitInput, LeadService } from '../../../core/services/lead.service';
import { AuthService } from '../../../core/services/auth.service';
import { Lead } from '../../../core/models/lead.model';
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
import { getInitials, toDateInput } from '../../../core/format-utils';
import { SkeletonRows } from '../../../shared/ui/ui';
import { Select } from '../../../shared/ui/select';
import { NoCopy } from '../../../shared/no-copy.directive';

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
  'accountTitle',
  'accountType',
  'routingNumber',
  'accountNumber',
];

/**
 * Opens a sheet-imported RETENTION lead for editing — pre-filled with whatever the sheet
 * gave us, gaps left for the Retention person to fill in. Any Retention account may open any
 * teammate's lead here, not just their own (see RetentionQueue's teammate filter) — the
 * server enforces this the same way, no ownership check on the submit endpoint.
 */
@Component({
  selector: 'app-retention-lead-edit',
  imports: [
    FormsModule,
    RouterLink,
    SkeletonRows,
    Select,
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
  ],
  templateUrl: './lead-edit.html',
})
export class RetentionLeadEdit implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly leadService = inject(LeadService);
  private readonly auth = inject(AuthService);

  readonly leadId = this.route.snapshot.paramMap.get('id')!;
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly showErrors = signal(false);
  readonly lead = signal<Lead | null>(null);

  readonly currentUserId = computed(() => this.auth.user()?.id ?? null);
  readonly isMine = computed(() => this.lead()?.retention?.id === this.currentUserId());

  readonly maritalStatusOptions = MARITAL_STATUS_OPTIONS;
  readonly genderOptions = GENDER_OPTIONS;
  readonly smokerOptions = SMOKER_OPTIONS;
  readonly needOptions = NEED_OPTIONS;
  readonly incomeSourceOptions = INCOME_SOURCE_OPTIONS;
  readonly retiredIncomeOptions = RETIRED_INCOME_OPTIONS;
  readonly accountTypeOptions = ACCOUNT_TYPE_OPTIONS;
  readonly payerOptions = PAYER_OPTIONS;
  readonly planTypeOptions = PLAN_TYPE_OPTIONS;
  readonly getInitials = getInitials;

  form: RetentionSubmitInput = {};
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

  async ngOnInit(): Promise<void> {
    try {
      const lead = await this.leadService.getLead(this.leadId);
      this.lead.set(lead);
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
        coverageAmount: lead.coverageAmount ?? undefined,
        monthlyPremiums: lead.monthlyPremiums ?? undefined,
        initialDraftDate: toDateInput(lead.initialDraftDate) || undefined,
        futureDraftDate: toDateInput(lead.futureDraftDate) || undefined,
        payer: lead.payer ?? undefined,
        bankName: lead.bankName ?? undefined,
        accountTitle: lead.accountTitle ?? undefined,
        payerSocial: lead.payerSocial ?? undefined,
        accountType: lead.accountType ?? undefined,
        routingNumber: lead.routingNumber ?? undefined,
        accountNumber: lead.accountNumber ?? undefined,
        closerNotes: lead.closerNotes ?? undefined,
      };
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not load this lead.');
    } finally {
      this.loading.set(false);
    }
  }

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
      ) as RetentionSubmitInput;
      await this.leadService.retentionSubmit(this.leadId, payload);
      this.router.navigateByUrl('/retention/queue');
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not submit the lead.');
    } finally {
      this.submitting.set(false);
    }
  }
}
