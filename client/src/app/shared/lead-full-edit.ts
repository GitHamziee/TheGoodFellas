import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideBanknote,
  LucideCreditCard,
  LucideHeartPulse,
  LucideNotebookPen,
  LucideShieldCheck,
  LucideUser,
  LucideUsers,
  LucideWallet,
} from '@lucide/angular';
import { AdminLeadEditInput, LeadService } from '../core/services/lead.service';
import { Lead } from '../core/models/lead.model';
import {
  ACCOUNT_OWNERSHIP_OPTIONS,
  ACCOUNT_TYPE_OPTIONS,
  CARD_TYPE_OPTIONS,
  D_CODE_OPTIONS,
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
} from '../core/lead-options';
import { calculateAge, formatCardExpiry, sanitizeDigits, toDateInput, todayDateInput } from '../core/format-utils';
import { Modal } from './ui/modal';
import { Select } from './ui/select';
import { PhoneInput } from './ui/phone-input';
import { ZipInput } from './ui/zip-input';
import { DateInput } from './ui/date-input';
import { apiErrorMessage } from '../core/api';

const CPL_KEYS = [
  'customerName', 'phone', 'state', 'zipcode', 'smoker', 'dob', 'need', 'juniorNotes',
  'decisionMaker', 'bankAccount', 'dCode',
];

const DATE_KEYS = ['dob', 'beneficiaryDob', 'initialDraftDate', 'futureDraftDate'];

const FORM_KEYS = [
  'customerName', 'phone', 'state', 'zipcode', 'mailingAddress', 'email', 'maritalStatus', 'birthState',
  'gender', 'dob', 'age', 'ssn', 'dlStateId', 'yearlyIncome', 'smoker', 'need', 'decisionMaker', 'bankAccount',
  'dCode', 'incomeSource', 'retiredIncomeType', 'natureOfDisability', 'annualIncome', 'height', 'weight',
  'doctorName', 'healthConditions', 'medications', 'beneficiaryName', 'beneficiaryRelation', 'beneficiaryDob',
  'carrierName', 'clientLeadId', 'planType', 'coverageAmount', 'monthlyPremiums', 'initialDraftDate', 'futureDraftDate',
  'payer', 'paymentMethod', 'payerSocial', 'bankName', 'accountTitle', 'accountType', 'accountOwnership',
  'accountOpeningState', 'routingNumber', 'accountNumber', 'cardType', 'cardNumber', 'cardExpiry',
  'juniorNotes', 'closerNotes',
];

/**
 * The assigned Client's "fix this lead before I decide on it" form. Unlike the read-only
 * detail view, EVERY field is shown whether it has a value or not, so the client can fill
 * gaps as well as correct mistakes. CPL leads get their own (shorter) field set.
 */
@Component({
  selector: 'app-lead-full-edit',
  imports: [
    FormsModule, Modal, Select, PhoneInput, ZipInput, DateInput,
    LucideUser, LucideWallet, LucideHeartPulse, LucideUsers, LucideShieldCheck,
    LucideBanknote, LucideCreditCard, LucideNotebookPen,
  ],
  template: `
    <app-modal title="Edit lead" [subtitle]="lead().customerName + ' · fix anything before you approve or decline'" [wide]="true" (close)="closed.emit()">
      @if (error()) {
        <div class="error">{{ error() }}</div>
      }

      <form (ngSubmit)="save()" id="lead-full-edit">
        <div class="section">
          <h2 class="section-title"><svg lucideUser></svg> Personal & contact</h2>
          <div class="form-grid">
            <label>
              Customer's name <span class="req">Required</span>
              <input type="text" name="customerName" [(ngModel)]="form['customerName']" [class.invalid]="showErrors() && !form['customerName']" />
            </label>
            <label>
              Phone number <span class="req">Required</span>
              <input appPhone name="phone" [(ngModel)]="form['phone']" [class.invalid]="showErrors() && !form['phone']" />
            </label>
            <label>
              State <span class="req">Required</span>
              <app-select [options]="stateOptions" [searchable]="true" name="state" [(ngModel)]="form['state']" [invalid]="showErrors() && !form['state']" />
            </label>
            <label>
              Zipcode
              <input appZip name="zipcode" [(ngModel)]="form['zipcode']" />
            </label>
            @if (!isCpl()) {
              <label class="full">
                Mailing address
                <input type="text" name="mailingAddress" [(ngModel)]="form['mailingAddress']" />
              </label>
              <label>
                Email
                <input type="email" name="email" [(ngModel)]="form['email']" />
              </label>
              <label>
                Marital status
                <app-select [options]="maritalStatusOptions" name="maritalStatus" [(ngModel)]="form['maritalStatus']" />
              </label>
              <label>
                Birth state
                <app-select [options]="stateOptions" [searchable]="true" name="birthState" [(ngModel)]="form['birthState']" />
              </label>
              <label>
                Gender
                <app-select [options]="genderOptions" name="gender" [(ngModel)]="form['gender']" />
              </label>
            }
            <label>
              Date of birth
              <app-date-input name="dob" [min]="minDob" [max]="todayIso" [ngModel]="form['dob']" (ngModelChange)="onDobChange($event)"></app-date-input>
            </label>
            @if (!isCpl()) {
              <label>
                Age
                <input type="number" name="age" min="0" max="130" [(ngModel)]="form['age']" />
              </label>
              <label>
                Social Security Number
                <input type="text" name="ssn" inputmode="numeric" maxlength="9" placeholder="123456789"
                  [ngModel]="form['ssn']" (ngModelChange)="form['ssn'] = digits($event, 9)" />
                <span class="hint">Exactly 9 digits.</span>
              </label>
              <label>
                DL / State ID #
                <input type="text" name="dlStateId" [(ngModel)]="form['dlStateId']" />
              </label>
              <label>
                Yearly income <span class="hint">Whole dollars</span>
                <input type="number" name="yearlyIncome" min="0" [(ngModel)]="form['yearlyIncome']" />
              </label>
            } @else {
              <label>
                Smoker
                <app-select [options]="smokerOptions" name="smoker" [(ngModel)]="form['smoker']" />
              </label>
            }
          </div>
        </div>

        <div class="section">
          <h2 class="section-title"><svg lucideWallet></svg> Need & income</h2>
          <div class="form-grid">
            <label>
              Need
              <app-select [options]="needOptions" name="need" [(ngModel)]="form['need']" />
            </label>
            @if (isCpl()) {
              <label>
                Decision maker
                <app-select [options]="smokerOptions" name="decisionMaker" [(ngModel)]="form['decisionMaker']" />
              </label>
              <label>
                Bank account
                <app-select [options]="smokerOptions" name="bankAccount" [(ngModel)]="form['bankAccount']" />
              </label>
              <label>
                D-code
                <app-select [options]="dCodeOptions" name="dCode" [(ngModel)]="form['dCode']" />
              </label>
            } @else {
              <label>
                Source of income
                <app-select [options]="incomeSourceOptions" name="incomeSource" [(ngModel)]="form['incomeSource']" />
              </label>
              <label>
                Retired income type
                <app-select [options]="retiredIncomeOptions" name="retiredIncomeType" [(ngModel)]="form['retiredIncomeType']" />
              </label>
              <label>
                Nature of disability
                <input type="text" name="natureOfDisability" [(ngModel)]="form['natureOfDisability']" />
              </label>
              <label>
                Annual income <span class="hint">Whole dollars</span>
                <input type="number" name="annualIncome" min="0" [(ngModel)]="form['annualIncome']" />
              </label>
            }
          </div>
        </div>

        @if (!isCpl()) {
          <div class="section">
            <h2 class="section-title"><svg lucideHeartPulse></svg> Physical & health</h2>
            <div class="form-grid">
              <label>
                Height
                <input type="text" name="height" placeholder="e.g. 5'10&quot;" [(ngModel)]="form['height']" />
              </label>
              <label>
                Weight <span class="hint">Pounds</span>
                <input type="number" name="weight" min="0" [(ngModel)]="form['weight']" />
              </label>
              <label>
                Smoker
                <app-select [options]="smokerOptions" name="smoker" [(ngModel)]="form['smoker']" />
              </label>
              <label>
                Doctor's name
                <input type="text" name="doctorName" [(ngModel)]="form['doctorName']" />
              </label>
              <label class="full">
                Health conditions
                <textarea name="healthConditions" rows="2" [(ngModel)]="form['healthConditions']"></textarea>
              </label>
              <label class="full">
                Medications
                <textarea name="medications" rows="2" [(ngModel)]="form['medications']"></textarea>
              </label>
            </div>
          </div>

          <div class="section">
            <h2 class="section-title"><svg lucideUsers></svg> Beneficiary</h2>
            <div class="form-grid">
              <label>
                Beneficiary name
                <input type="text" name="beneficiaryName" [(ngModel)]="form['beneficiaryName']" />
              </label>
              <label>
                Relation
                <input type="text" name="beneficiaryRelation" placeholder="e.g. Daughter" [(ngModel)]="form['beneficiaryRelation']" />
              </label>
              <label>
                Beneficiary date of birth
                <app-date-input name="beneficiaryDob" [min]="minDob" [max]="todayIso" [(ngModel)]="form['beneficiaryDob']"></app-date-input>
              </label>
            </div>
          </div>

          <div class="section">
            <h2 class="section-title"><svg lucideShieldCheck></svg> Policy</h2>
            <div class="form-grid">
              <label>
                Carrier name
                <input type="text" name="carrierName" [(ngModel)]="form['carrierName']" />
              </label>
              <label>
                Client lead ID
                <input type="text" name="clientLeadId" [(ngModel)]="form['clientLeadId']" />
              </label>
              <label>
                Plan type
                <app-select [options]="planTypeOptions" name="planType" [(ngModel)]="form['planType']" />
              </label>
              <label>
                Coverage amount <span class="hint">Whole dollars</span>
                <input type="number" name="coverageAmount" min="0" [(ngModel)]="form['coverageAmount']" />
              </label>
              <label>
                Monthly premium <span class="hint">Whole dollars</span>
                <input type="number" name="monthlyPremiums" min="0" [(ngModel)]="form['monthlyPremiums']" />
              </label>
            </div>
          </div>

          <div class="section">
            <h2 class="section-title"><svg lucideBanknote></svg> Billing</h2>
            <div class="form-grid">
              <label>
                Initial draft date
                <app-date-input name="initialDraftDate" min="2000-01-01" max="2100-12-31" [(ngModel)]="form['initialDraftDate']"></app-date-input>
              </label>
              <label>
                Future draft date
                <app-date-input name="futureDraftDate" min="2000-01-01" max="2100-12-31" [(ngModel)]="form['futureDraftDate']"></app-date-input>
              </label>
              <label>
                Who is paying?
                <app-select [options]="payerOptions" name="payer" [(ngModel)]="form['payer']" />
              </label>
              <label>
                Payment method
                <app-select [options]="paymentMethodOptions" name="paymentMethod" [(ngModel)]="form['paymentMethod']" />
              </label>
              <label>
                Payer's Social Security Number <span class="hint">If someone else is paying</span>
                <input type="text" name="payerSocial" inputmode="numeric" maxlength="9" placeholder="123456789"
                  [ngModel]="form['payerSocial']" (ngModelChange)="form['payerSocial'] = digits($event, 9)" />
              </label>
            </div>

            <h3 class="section-title"><svg lucideBanknote></svg> Bank account</h3>
            <div class="form-grid">
              <label>
                Bank name
                <input type="text" name="bankName" [(ngModel)]="form['bankName']" />
              </label>
              <label>
                Account title
                <input type="text" name="accountTitle" [(ngModel)]="form['accountTitle']" />
              </label>
              <label>
                Account type
                <app-select [options]="accountTypeOptions" name="accountType" [(ngModel)]="form['accountType']" />
              </label>
              <label>
                Joint or single account
                <app-select [options]="accountOwnershipOptions" name="accountOwnership" [(ngModel)]="form['accountOwnership']" />
              </label>
              <label>
                Account opening state
                <app-select [options]="stateOptions" [searchable]="true" name="accountOpeningState" [(ngModel)]="form['accountOpeningState']" />
              </label>
              <label>
                Routing number
                <input type="text" name="routingNumber" inputmode="numeric" maxlength="9" placeholder="123456789"
                  [ngModel]="form['routingNumber']" (ngModelChange)="form['routingNumber'] = digits($event, 9)"
                  [class.invalid]="routingInvalid()" />
                <span class="hint">Exactly 9 digits.</span>
              </label>
              <label>
                Account number
                <input type="text" name="accountNumber" inputmode="numeric" maxlength="17"
                  [ngModel]="form['accountNumber']" (ngModelChange)="form['accountNumber'] = digits($event, 17)" />
                <span class="hint">3 to 17 digits.</span>
              </label>
            </div>

            <h3 class="section-title"><svg lucideCreditCard></svg> Card</h3>
            <div class="form-grid">
              <label>
                Card type
                <app-select [options]="cardTypeOptions" name="cardType" [(ngModel)]="form['cardType']" />
              </label>
              <label>
                Card number
                <input type="text" name="cardNumber" inputmode="numeric" maxlength="19"
                  [ngModel]="form['cardNumber']" (ngModelChange)="form['cardNumber'] = digits($event, 19)" />
                <span class="hint">13 to 19 digits.</span>
              </label>
              <label>
                Expiry
                <input type="text" name="cardExpiry" inputmode="numeric" maxlength="5" placeholder="MM/YY"
                  [ngModel]="form['cardExpiry']" (ngModelChange)="form['cardExpiry'] = expiry($event)" />
              </label>
            </div>
          </div>
        }

        <div class="section">
          <h2 class="section-title"><svg lucideNotebookPen></svg> Notes</h2>
          <label>
            {{ isCpl() ? 'Notes for admin' : 'Intake notes' }}
            <textarea name="juniorNotes" rows="3" [(ngModel)]="form['juniorNotes']"></textarea>
          </label>
          @if (!isCpl()) {
            <label>
              Closer notes
              <textarea name="closerNotes" rows="3" [(ngModel)]="form['closerNotes']"></textarea>
            </label>
          }
        </div>
      </form>

      <div footer>
        <button type="submit" form="lead-full-edit" class="btn" [disabled]="busy()">
          @if (busy()) {
            <span class="spinner"></span> Saving…
          } @else {
            Save changes
          }
        </button>
      </div>
    </app-modal>
  `,
})
export class LeadFullEdit implements OnInit {
  private readonly leadService = inject(LeadService);

  readonly lead = input.required<Lead>();
  readonly saved = output<Lead>();
  readonly closed = output<void>();

  readonly isCpl = computed(() => this.lead().leadType === 'CPL');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly showErrors = signal(false);

  readonly stateOptions = US_STATE_OPTIONS;
  readonly maritalStatusOptions = MARITAL_STATUS_OPTIONS;
  readonly genderOptions = GENDER_OPTIONS;
  readonly smokerOptions = SMOKER_OPTIONS;
  readonly needOptions = NEED_OPTIONS;
  readonly incomeSourceOptions = INCOME_SOURCE_OPTIONS;
  readonly retiredIncomeOptions = RETIRED_INCOME_OPTIONS;
  readonly planTypeOptions = PLAN_TYPE_OPTIONS;
  readonly payerOptions = PAYER_OPTIONS;
  readonly paymentMethodOptions = PAYMENT_METHOD_OPTIONS;
  readonly accountTypeOptions = ACCOUNT_TYPE_OPTIONS;
  readonly accountOwnershipOptions = ACCOUNT_OWNERSHIP_OPTIONS;
  readonly cardTypeOptions = CARD_TYPE_OPTIONS;
  readonly dCodeOptions = D_CODE_OPTIONS;
  readonly minDob = '1900-01-01';
  readonly todayIso = todayDateInput();
  readonly digits = sanitizeDigits;
  readonly expiry = formatCardExpiry;

  /** Every editable field, seeded from the lead. Blank means "no value" and is sent as '' to clear it. */
  form: Record<string, string | number | boolean> = {};

  routingInvalid(): boolean {
    const r = this.form['routingNumber'];
    return typeof r === 'string' && !!r && r.length !== 9;
  }

  // The modal is created fresh per lead (`@if`), so seeding from the input once is enough.
  ngOnInit(): void {
    const l = this.lead() as unknown as Record<string, string | number | boolean | null | undefined>;
    for (const k of FORM_KEYS) {
      const v = l[k];
      this.form[k] = DATE_KEYS.includes(k) ? toDateInput(v as string | null | undefined) || '' : (v ?? '');
    }
  }

  onDobChange(value: string): void {
    this.form['dob'] = value;
    this.form['age'] = calculateAge(value) ?? '';
  }

  async save(): Promise<void> {
    this.showErrors.set(true);
    const f = this.form;
    if (!f['customerName']?.toString().trim() || !f['phone']?.toString().trim() || !f['state']) {
      this.error.set("Customer's name, phone and state are required.");
      return;
    }
    if (this.routingInvalid()) {
      this.error.set('Routing number must be exactly 9 digits.');
      return;
    }

    this.error.set(null);
    this.busy.set(true);
    try {
      // A CPL lead only carries its own field set; the server enforces the same limit.
      const payload = Object.fromEntries(
        Object.entries(f).filter(([k]) => !this.isCpl() || CPL_KEYS.includes(k)),
      ) as AdminLeadEditInput;
      const updated = await this.leadService.clientEditLead(this.lead().id, payload);
      this.saved.emit(updated);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not save changes.'));
    } finally {
      this.busy.set(false);
    }
  }
}
