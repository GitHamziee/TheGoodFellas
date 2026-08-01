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
import { ACCOUNT_TYPE_OPTIONS, PAYER_OPTIONS } from '../../../core/lead-options';
import { humanizeEnum, toDateInput } from '../../../core/format-utils';
import { SkeletonRows } from '../../../shared/ui/ui';

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
  readonly showErrors = signal(false);
  readonly lead = signal<Lead | null>(null);

  readonly accountTypeOptions = ACCOUNT_TYPE_OPTIONS;
  readonly payerOptions = PAYER_OPTIONS;
  readonly maritalStatusOptions = ['Single', 'Married', 'Divorced', 'Widowed'];
  readonly humanizeEnum = humanizeEnum;

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

  async ngOnInit(): Promise<void> {
    try {
      const lead = await this.leadService.getLead(this.leadId);
      this.lead.set(lead);
      // Pre-fill everything the junior closer already captured.
      this.form = {
        customerName: lead.customerName,
        maritalStatus: lead.maritalStatus ?? undefined,
        phone: lead.phone,
        state: lead.state,
        zipcode: lead.zipcode ?? undefined,
        birthState: lead.birthState ?? undefined,
        smoker: lead.smoker ?? undefined,
        dob: toDateInput(lead.dob) || undefined,
        age: lead.age ?? undefined,
        height: lead.height ?? undefined,
        weight: lead.weight ?? undefined,
        healthConditions: lead.healthConditions ?? undefined,
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
      await this.leadService.enrichLead(this.leadId, payload);
      this.router.navigateByUrl('/closer/inbox');
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not submit the lead.');
    } finally {
      this.submitting.set(false);
    }
  }
}
