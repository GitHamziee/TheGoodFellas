import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  LucideArrowLeft,
  LucideCircleAlert,
  LucideHeartPulse,
  LucideNotebookPen,
  LucideSend,
  LucideUser,
  LucideUsers,
  LucideWallet,
} from '@lucide/angular';
import { CplLeadInput, JuniorLeadInput, LeadService } from '../../../core/services/lead.service';
import { UserService } from '../../../core/services/user.service';
import { Lead, LeadType } from '../../../core/models/lead.model';
import {
  D_CODE_OPTIONS,
  GENDER_OPTIONS,
  INCOME_SOURCE_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  NEED_OPTIONS,
  RETIRED_INCOME_OPTIONS,
  SMOKER_OPTIONS,
  US_STATE_OPTIONS,
} from '../../../core/lead-options';
import { calculateAge, getAvatarTone, getInitials, toDateInput, todayDateInput } from '../../../core/format-utils';
import { Select } from '../../../shared/ui/select';
import { FormSections } from '../../../shared/ui/form-sections';
import { NoCopy } from '../../../shared/no-copy.directive';
import { PhoneInput } from '../../../shared/ui/phone-input';
import { ZipInput } from '../../../shared/ui/zip-input';
import { DateInput } from '../../../shared/ui/date-input';
import { apiErrorMessage } from '../../../core/api';

/** Backs both the CPA and CPL forms — whichever fields matter for the picked leadType
 * get read on submit. Keeps one template-driven form object instead of two near-duplicates. */
type IntakeForm = Partial<
  Pick<
    Lead,
    | 'customerName'
    | 'maritalStatus'
    | 'phone'
    | 'state'
    | 'zipcode'
    | 'birthState'
    | 'gender'
    | 'smoker'
    | 'dob'
    | 'age'
    | 'height'
    | 'weight'
    | 'healthConditions'
    | 'need'
    | 'incomeSource'
    | 'retiredIncomeType'
    | 'natureOfDisability'
    | 'annualIncome'
    | 'juniorNotes'
    | 'decisionMaker'
    | 'bankAccount'
    | 'dCode'
  >
> & { closerId?: string };

interface LookupUser {
  id: string;
  name: string;
  email: string;
}

@Component({
  selector: 'app-submit-lead',
  imports: [DateInput, PhoneInput, ZipInput, 
    FormsModule,
    RouterLink,
    Select,
    FormSections,
    NoCopy,
    LucideSend,
    LucideUser,
    LucideUsers,
    LucideHeartPulse,
    LucideWallet,
    LucideNotebookPen,
    LucideCircleAlert,
    LucideArrowLeft,
  ],
  templateUrl: './submit-lead.html',
})
export class SubmitLead implements OnInit {
  private readonly leadService = inject(LeadService);
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /**
   * Doubles as the correction form for a lead the admin sent back: same intake fields,
   * so a near-duplicate component would only drift. With an :id in the route it loads
   * that lead, hides the closer picker (reassigning isn't the junior's call) and
   * resubmits instead of creating.
   */
  readonly editId = this.route.snapshot.paramMap.get('id');
  readonly isCorrection = !!this.editId;
  readonly returnReason = signal<string | null>(null);

  readonly closers = signal<LookupUser[]>([]);
  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);
  /** Set once the user tries to submit, so errors don't shout at an untouched form. */
  readonly showErrors = signal(false);

  readonly needOptions = NEED_OPTIONS;
  readonly incomeSourceOptions = INCOME_SOURCE_OPTIONS;
  readonly retiredIncomeOptions = RETIRED_INCOME_OPTIONS;
  readonly maritalStatusOptions = MARITAL_STATUS_OPTIONS;
  readonly stateOptions = US_STATE_OPTIONS;
  readonly genderOptions = GENDER_OPTIONS;
  readonly smokerOptions = SMOKER_OPTIONS;
  readonly dCodeOptions = D_CODE_OPTIONS;

  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  /** Bounds for date-of-birth inputs — a plain `<input type="date">` has no digit limit
   * on the year segment otherwise, so nothing stops typing a year like "221465". */
  readonly minDob = '1900-01-01';
  readonly todayIso = todayDateInput();

  /** Fixed to whatever the lead already is in correction mode — reassigning type isn't
   * on the table when you're just fixing what's already there. */
  readonly leadType = signal<LeadType>('CPA');

  form: IntakeForm = {};
  /** Mirrors form.closerId — kept as a signal so the picker highlight is reactive. */
  readonly closerId = signal('');

  missing(): string[] {
    const f = this.form;
    const missing: string[] = [];
    if (this.leadType() === 'CPA' && !this.isCorrection && !this.closerId()) missing.push('Closer');
    if (!f.customerName?.trim()) missing.push("Customer's name");
    if (!f.phone?.trim()) missing.push('Phone number');
    if (!f.state?.trim()) missing.push('State');
    return missing;
  }

  setLeadType(type: LeadType): void {
    if (this.isCorrection) return;
    this.leadType.set(type);
  }

  canSubmit(): boolean {
    return this.missing().length === 0 && !this.submitting();
  }

  async ngOnInit(): Promise<void> {
    if (this.isCorrection) {
      try {
        const lead = await this.leadService.getLead(this.editId!);
        this.returnReason.set(lead.returnReason ?? null);
        this.leadType.set(lead.leadType ?? 'CPA');
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
          juniorNotes: lead.juniorNotes ?? undefined,
          decisionMaker: lead.decisionMaker ?? undefined,
          bankAccount: lead.bankAccount ?? undefined,
          dCode: lead.dCode ?? undefined,
        };
      } catch (err) {
        this.error.set(apiErrorMessage(err, 'Could not load this lead.'));
      }
      return;
    }

    try {
      this.closers.set(await this.userService.listClosers());
    } catch {
      this.error.set('Could not load the closer list. Refresh to try again.');
    }
  }

  chooseCloser(id: string): void {
    this.closerId.set(id);
    this.form.closerId = id;
  }

  /** Signals feed off `form`, which template-driven bindings mutate in place. */
  touch(): void {
    if (this.showErrors()) this.showErrors.set(true);
  }

  onDobChange(value: string): void {
    this.form.dob = value;
    this.form.age = calculateAge(value);
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
      // Blank optional selects come through as '' — strip them so the API sees absent, not empty.
      const strip = (obj: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v !== null && v !== undefined));

      if (this.isCorrection) {
        const intake = strip(this.form) as Omit<JuniorLeadInput, 'closerId'>;
        await this.leadService.resubmitIntake(this.editId!, intake);
        this.router.navigateByUrl('/junior/returned');
      } else if (this.leadType() === 'CPL') {
        const payload = strip(this.form) as CplLeadInput;
        await this.leadService.submitCplLead(payload);
        this.router.navigateByUrl('/junior/my-leads');
      } else {
        const payload = strip({ ...this.form, closerId: this.closerId() }) as JuniorLeadInput;
        await this.leadService.submitLead(payload);
        this.router.navigateByUrl('/junior/my-leads');
      }
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not submit the lead.'));
    } finally {
      this.submitting.set(false);
    }
  }
}
