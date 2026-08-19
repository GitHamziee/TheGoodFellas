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
import { CloserLeadInput, LeadService } from '../../../core/services/lead.service';
import { Lead } from '../../../core/models/lead.model';
import {
  ACCOUNT_TYPE_OPTIONS,
  DRAFT_REASON_OPTIONS,
  GENDER_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  PAYER_OPTIONS,
  PLAN_TYPE_OPTIONS,
  SMOKER_OPTIONS,
} from '../../../core/lead-options';
import { humanizeEnum, pluralize, toDateInput } from '../../../core/format-utils';
import { SkeletonRows } from '../../../shared/ui/ui';
import { Modal } from '../../../shared/ui/modal';
import { Select } from '../../../shared/ui/select';
import { NoCopy } from '../../../shared/no-copy.directive';

/** Fields the closer is expected to fill, grouped for the completeness meter. */
const TRACKED: (keyof CloserLeadInput)[] = [
  'mailingAddress',
  'email',
  'ssn',
  'dlStateId',
  'doctorName',
  'yearlyIncome',
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

@Component({
  selector: 'app-enrich-lead',
  imports: [
    FormsModule,
    RouterLink,
    SkeletonRows,
    Modal,
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
  templateUrl: './enrich-lead.html',
})
export class EnrichLead implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly leadService = inject(LeadService);

  readonly leadId = this.route.snapshot.paramMap.get('id')!;
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly savingDraft = signal(false);
  readonly showErrors = signal(false);
  readonly showDraftReasonError = signal(false);
  readonly draftModalOpen = signal(false);
  readonly lead = signal<Lead | null>(null);

  /**
   * The same form serves three jobs: first enrichment of a NEW lead, resuming a
   * DRAFT they parked earlier, and correcting one the admin sent back. Only the
   * pre-fill, the submit call and the return path differ, so it's one component
   * rather than a near-duplicate of a 30-field form.
   */
  readonly isCorrection = computed(() => this.lead()?.status === 'RETURNED_TO_CLOSER');
  readonly isDraft = computed(() => this.lead()?.status === 'DRAFT');
  readonly returnReason = computed(() => this.lead()?.returnReason ?? null);

  readonly accountTypeOptions = ACCOUNT_TYPE_OPTIONS;
  readonly payerOptions = PAYER_OPTIONS;
  readonly planTypeOptions = PLAN_TYPE_OPTIONS;
  readonly draftReasonOptions = DRAFT_REASON_OPTIONS;
  readonly maritalStatusOptions = MARITAL_STATUS_OPTIONS;
  readonly genderOptions = GENDER_OPTIONS;
  readonly smokerOptions = SMOKER_OPTIONS;
  readonly humanizeEnum = humanizeEnum;
  readonly pluralize = pluralize;

  form: CloserLeadInput = {};
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

  /** Rough "how much of the enrichment is filled in" indicator. */
  readonly completeness = computed(() => {
    this.revision();
    const filled = TRACKED.filter((key) => {
      const v = this.form[key];
      return v !== undefined && v !== null && v !== '';
    }).length;
    return Math.round((filled / TRACKED.length) * 100);
  });

  readonly canSubmit = computed(() => this.missing().length === 0 && !this.submitting());

  /** Display-only — derived from monthly premium, not a stored field, so it can never drift out of sync. */
  readonly annualPremium = computed(() => {
    this.revision();
    const monthly = this.form.monthlyPremiums;
    return typeof monthly === 'number' ? monthly * 12 : null;
  });

  async ngOnInit(): Promise<void> {
    try {
      const lead = await this.leadService.getLead(this.leadId);
      this.lead.set(lead);
      // Pre-fill what the junior closer captured, plus any enrichment already saved —
      // on a returned lead those fields are populated and are the ones being corrected.
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
        draftReason: lead.draftReason ?? undefined,
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
      ) as CloserLeadInput;
      if (this.isCorrection()) {
        await this.leadService.resubmitEnrichment(this.leadId, payload);
        this.router.navigateByUrl('/closer/returned');
      } else {
        await this.leadService.enrichLead(this.leadId, payload);
        this.router.navigateByUrl('/closer/inbox');
      }
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not submit the lead.');
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

  /** Parks the lead instead of submitting it — only available while it's actively theirs (not a correction). */
  async saveDraft(): Promise<void> {
    if (!this.form.draftReason) {
      this.showDraftReasonError.set(true);
      return;
    }

    this.error.set(null);
    this.showDraftReasonError.set(false);
    this.savingDraft.set(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(this.form).filter(([, v]) => v !== '' && v !== null && v !== undefined),
      ) as CloserLeadInput;
      await this.leadService.saveDraft(this.leadId, payload);
      this.draftModalOpen.set(false);
      this.router.navigateByUrl('/closer/drafts');
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not save this as a draft.');
    } finally {
      this.savingDraft.set(false);
    }
  }
}
