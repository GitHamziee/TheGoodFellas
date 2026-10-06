import { Component, computed, input, signal } from '@angular/core';
import {
  LucideBanknote,
  LucideCheck,
  LucideClipboardCopy,
  LucideEye,
  LucideHeartPulse,
  LucideLock,
  LucideNotebookPen,
  LucideShieldCheck,
  LucideUser,
  LucideUsers,
} from '@lucide/angular';
import { Lead } from '../core/models/lead.model';
import {
  formatBool,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPhone,
  humanizeEnum,
  maskAccount,
  maskSsn,
  timeAgo,
} from '../core/format-utils';
import { PLAN_TYPE_LABEL } from '../core/lead-options';
import { Detail, PaymentBadge, StatusBadge } from './ui/ui';

interface Row {
  k: string;
  v: string;
  sensitive?: boolean;
}

/**
 * Full read-only view of a lead, grouped the same way the intake and enrichment
 * forms are. Only renders a section when the lead actually carries data for it,
 * so a masked or partially-filled record doesn't show a wall of dashes.
 */
@Component({
  selector: 'app-lead-detail',
  imports: [
    Detail,
    StatusBadge,
    PaymentBadge,
    LucideUser,
    LucideHeartPulse,
    LucideUsers,
    LucideShieldCheck,
    LucideBanknote,
    LucideNotebookPen,
    LucideEye,
    LucideLock,
    LucideClipboardCopy,
    LucideCheck,
  ],
  template: `
    <div class="ld">
      <div class="ld-top">
        <div>
          <div class="nm">{{ lead().customerName }}</div>
          <div class="mt">
            Submitted {{ timeAgo(lead().createdAt) }} · {{ formatDateTime(lead().createdAt) }}
          </div>
        </div>
        <div class="badges">
          <app-status-badge [status]="lead().status" />
          @if (lead().status === 'ACCEPTED') {
            <app-payment-badge [status]="lead().paymentStatus" />
          }
          @if (allowCopy()) {
            <button type="button" class="copy-btn" (click)="copyDetails()">
              @if (copied()) {
                <svg lucideCheck></svg> Copied
              } @else {
                <svg lucideClipboardCopy></svg> Copy details
              }
            </button>
          }
        </div>
      </div>

      @if (hasSensitive() && !unmasked()) {
        <button type="button" class="reveal" (click)="revealed.set(!revealed())">
          @if (revealed()) {
            <svg lucideLock></svg> Hide SSN & bank details
          } @else {
            <svg lucideEye></svg> Reveal SSN & bank details
          }
        </button>
      }

      @for (section of sections(); track section.title) {
        @if (section.rows.length) {
          <div class="ld-section">
            <h4>
              @switch (section.icon) {
                @case ('user') { <svg lucideUser></svg> }
                @case ('health') { <svg lucideHeartPulse></svg> }
                @case ('beneficiary') { <svg lucideUsers></svg> }
                @case ('policy') { <svg lucideShieldCheck></svg> }
                @case ('billing') { <svg lucideBanknote></svg> }
                @case ('notes') { <svg lucideNotebookPen></svg> }
              }
              {{ section.title }}
            </h4>
            <div class="detail-grid">
              @for (row of section.rows; track row.k) {
                <app-detail [label]="row.k" [value]="row.v" [sensitive]="!!row.sensitive" />
              }
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: `
    .ld-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }

    .nm { font-size: 1.05rem; font-weight: 800; color: var(--text); }
    .mt { font-size: 0.76rem; color: var(--gray-500); margin-top: 0.15rem; }
    .badges { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }

    .copy-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.3rem 0.6rem;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--surface);
      color: var(--gray-600);
      font-family: inherit;
      font-size: 0.72rem;
      font-weight: 700;
      cursor: pointer;
    }

    .copy-btn:hover { background: var(--gray-50); color: var(--text); }
    .copy-btn svg { width: 12px; height: 12px; }

    .reveal {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      margin-top: 1rem;
      padding: 0.4rem 0.75rem;
      border: 1px dashed var(--gold-300);
      border-radius: var(--radius-sm);
      background: var(--gold-50);
      color: var(--gold-800);
      font-family: inherit;
      font-size: 0.76rem;
      font-weight: 700;
      cursor: pointer;
    }

    .reveal:hover { background: var(--gold-100); }
    .reveal svg { width: 13px; height: 13px; }

    .ld-section { margin-top: 1.35rem; }

    .ld-section h4 {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin: 0 0 0.75rem;
      font-size: 0.7rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--gold-700);
    }

    .ld-section h4 svg { width: 13px; height: 13px; }
  `,
})
export class LeadDetail {
  readonly lead = input.required<Lead>();
  /** Admin always sees full lead data server-side (FULL_INCLUDE) — set this to skip the
   * dot-masked reveal toggle entirely and show SSN/routing/account numbers plainly. */
  readonly unmasked = input(true);
  /** "Copy details" writes straight to the clipboard via `navigator.clipboard`, so it isn't
   * caught by an `appNoCopy` wrapper (that only blocks the browser's copy/cut events) — set
   * this false to hide the button entirely on a page where copying lead data out is meant
   * to be blocked, not just discouraged. */
  readonly allowCopy = input(true);
  readonly revealed = signal(false);
  readonly copied = signal(false);

  readonly timeAgo = timeAgo;
  readonly formatDateTime = formatDateTime;

  readonly hasSensitive = computed(() => {
    const l = this.lead();
    return !!(l.ssn || l.routingNumber || l.accountNumber || l.payerSocial || l.cardNumber);
  });

  readonly sections = computed(() => {
    const l = this.lead();
    const show = this.unmasked() || this.revealed();
    /** Admin/Retention (unmasked) audit the full record, so every field is shown even
     * when blank — a missing row there would be indistinguishable from "hidden by
     * masking." Every other, more limited view still drops empty rows so a masked or
     * partially-filled record doesn't render as a wall of dashes. */
    const showEmpty = this.unmasked();
    const keep = (rows: (Row | null)[]): Row[] => rows.filter((r): r is Row => r !== null);
    const row = (k: string, v: unknown, formatted?: string, sensitive = false): Row | null => {
      const isEmpty = v === null || v === undefined || v === '';
      if (isEmpty && !showEmpty) return null;
      return { k, v: formatted ?? (isEmpty ? '—' : String(v)), sensitive };
    };

    return [
      {
        title: 'Personal & contact',
        icon: 'user',
        rows: keep([
          row('Phone', l.phone, formatPhone(l.phone)),
          row('Email', l.email),
          row('Marital status', l.maritalStatus, humanizeEnum(l.maritalStatus)),
          row('Gender', l.gender),
          row('Mailing address', l.mailingAddress),
          row('State', l.state),
          row('Zipcode', l.zipcode),
          row('Birth state', l.birthState),
          row('Date of birth', l.dob, formatDate(l.dob)),
          row('Age', l.age),
          row('Height', l.height),
          row('Weight', l.weight, l.weight ? `${l.weight} lbs` : undefined),
          row('Smoker', l.smoker, formatBool(l.smoker)),
          row('DL / State ID', l.dlStateId),
          row('SSN', l.ssn, show ? l.ssn! : maskSsn(l.ssn), true),
          row('D-code', l.dCode),
          row('Decision maker', l.decisionMaker, formatBool(l.decisionMaker)),
          row('Bank account', l.bankAccount, formatBool(l.bankAccount)),
        ]),
      },
      {
        title: 'Income',
        icon: 'user',
        rows: keep([
          row('Source of income', l.incomeSource, humanizeEnum(l.incomeSource)),
          row('Retired income type', l.retiredIncomeType, humanizeEnum(l.retiredIncomeType)),
          row('Nature of disability', l.natureOfDisability),
          row('Annual income', l.annualIncome, formatMoney(l.annualIncome)),
          row('Yearly income', l.yearlyIncome, formatMoney(l.yearlyIncome)),
        ]),
      },
      {
        title: 'Need & health',
        icon: 'health',
        rows: keep([
          row('Need', l.need, humanizeEnum(l.need)),
          row('Health conditions', l.healthConditions),
          row('Medications', l.medications),
          row("Doctor's name", l.doctorName),
        ]),
      },
      {
        title: 'Beneficiary',
        icon: 'beneficiary',
        rows: keep([
          row('Name', l.beneficiaryName),
          row('Relation', l.beneficiaryRelation),
          row('Date of birth', l.beneficiaryDob, formatDate(l.beneficiaryDob)),
        ]),
      },
      {
        title: 'Policy',
        icon: 'policy',
        rows: keep([
          row('Carrier', l.carrierName),
          row('Plan type', l.planType, l.planType ? PLAN_TYPE_LABEL[l.planType] : undefined),
          row('Coverage amount', l.coverageAmount, formatMoney(l.coverageAmount)),
          row('Monthly premium', l.monthlyPremiums, formatMoney(l.monthlyPremiums)),
        ]),
      },
      {
        title: 'Billing',
        icon: 'billing',
        rows: keep([
          row('Payer', l.payer, humanizeEnum(l.payer)),
          row('Payment method', l.paymentMethod, humanizeEnum(l.paymentMethod)),
          row('Initial draft date', l.initialDraftDate, formatDate(l.initialDraftDate)),
          row('Future draft date', l.futureDraftDate, formatDate(l.futureDraftDate)),
          row('Bank name', l.bankName),
          row('Account title', l.accountTitle),
          row('Account type', l.accountType, humanizeEnum(l.accountType)),
          row('Account ownership', l.accountOwnership, humanizeEnum(l.accountOwnership)),
          row('Account opening state', l.accountOpeningState),
          row('Routing number', l.routingNumber, show ? l.routingNumber! : maskAccount(l.routingNumber), true),
          row('Account number', l.accountNumber, show ? l.accountNumber! : maskAccount(l.accountNumber), true),
          row("Payer's SSN", l.payerSocial, show ? l.payerSocial! : maskSsn(l.payerSocial), true),
          row('Card type', l.cardType, humanizeEnum(l.cardType)),
          row('Card number', l.cardNumber, show ? l.cardNumber! : maskAccount(l.cardNumber), true),
          row('Card expiry', l.cardExpiry),
        ]),
      },
      {
        title: 'Notes & routing',
        icon: 'notes',
        rows: keep([
          row('Junior closer notes', l.juniorNotes),
          row('Closer notes', l.closerNotes),
          row('Rejection reason', l.rejectionReason),
          row('Junior closer', l.juniorCloser?.name),
          row('Closer', l.closer?.name),
          row('Client', l.client?.name),
          row(
            'External client',
            l.externalClient?.name,
            l.externalClient
              ? l.externalClient.name + (l.externalClient.company ? ' · ' + l.externalClient.company : '')
              : undefined,
          ),
          row(
            'Charge-backs',
            l.chargeBacks.length || null,
            l.chargeBacks.length
              ? `${l.chargeBacks.length} · ${formatMoney(l.chargeBacks.reduce((sum, c) => sum + c.pkrAmount, 0))} total`
              : undefined,
          ),
          row('Last updated', l.updatedAt, formatDateTime(l.updatedAt)),
          row('Closed at', l.closedAt, formatDateTime(l.closedAt)),
        ]),
      },
    ];
  });

  /**
   * A fixed field list/order/grouping given directly by the user — a condensed
   * carrier-submission cheat-sheet, not the full lead. Deliberately narrower than
   * `sections()` above (no state/zipcode/need/income/plan-type/notes/status/etc.) and
   * blank fields are kept as empty lines rather than dropped, unlike `sections()`'s
   * `row()` helper which omits anything unset.
   */
  copyDetails(): void {
    const l = this.lead();
    const show = this.unmasked() || this.revealed();
    const s = (v: unknown): string => (v === null || v === undefined || v === '' ? '' : String(v));
    const date = (v: string | null | undefined): string => (v ? formatDate(v) : '');
    const money = (v: number | null | undefined): string => (v === null || v === undefined ? '' : formatMoney(v));

    const lines = [
      `Customer's Name :${s(l.customerName)}`,
      `Phone Number :${l.phone ? formatPhone(l.phone) : ''}`,
      `Email:${s(l.email)}`,
      `Marital Status :${s(l.maritalStatus)}`,
      `Mailing Address:${s(l.mailingAddress)}`,
      `Birth State :${s(l.birthState)}`,
      `Gender :${s(l.gender)}`,
      `Smoker :${l.smoker === null || l.smoker === undefined ? '' : formatBool(l.smoker)}`,
      `DOB :${date(l.dob)}`,
      `Age :${s(l.age)}`,
      `Height :${s(l.height)}`,
      `Weight :${s(l.weight)}`,
      `Social :${s(l.ssn) ? (show ? l.ssn! : maskSsn(l.ssn)) : ''}`,
      `Driving license :${s(l.dlStateId)}`,
      '____________',
      `Beneficiary Relation :${s(l.beneficiaryRelation)}`,
      `Beneficiary Name :${s(l.beneficiaryName)}`,
      `Beneficiary DOB :${date(l.beneficiaryDob)}`,
      '____________',
      `Health Conditions :${s(l.healthConditions)}`,
      `Medications :${s(l.medications)}`,
      '____________',
      `Carrier Name :${s(l.carrierName)}`,
      `Coverage Amount :${money(l.coverageAmount)}`,
      `Monthly Premiums :${money(l.monthlyPremiums)}`,
      '____________',
      `Initial Draft Date :${date(l.initialDraftDate)}`,
      `Future Draft Date :${date(l.futureDraftDate)}`,
      `Bank Name:${s(l.bankName)}`,
      `Account Type:${s(l.accountType) ? humanizeEnum(l.accountType) : ''}`,
      `Routing Number:${s(l.routingNumber) ? (show ? l.routingNumber! : maskAccount(l.routingNumber)) : ''}`,
      `Account Number:${s(l.accountNumber) ? (show ? l.accountNumber! : maskAccount(l.accountNumber)) : ''}`,
    ];

    void navigator.clipboard.writeText(lines.join('\n')).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    });
  }
}
