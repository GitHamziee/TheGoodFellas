import { Component, computed, input, signal } from '@angular/core';
import {
  LucideBanknote,
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
        </div>
      </div>

      @if (hasSensitive()) {
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
    .badges { display: flex; gap: 0.4rem; flex-wrap: wrap; }

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
  readonly revealed = signal(false);

  readonly timeAgo = timeAgo;
  readonly formatDateTime = formatDateTime;

  readonly hasSensitive = computed(() => {
    const l = this.lead();
    return !!(l.ssn || l.routingNumber || l.accountNumber || l.payerSocial);
  });

  readonly sections = computed(() => {
    const l = this.lead();
    const show = this.revealed();
    const keep = (rows: (Row | null)[]): Row[] => rows.filter((r): r is Row => r !== null);
    /** Emits a row only when the lead actually carries the field. */
    const row = (k: string, v: unknown, formatted?: string, sensitive = false): Row | null => {
      if (v === null || v === undefined || v === '') return null;
      return { k, v: formatted ?? String(v), sensitive };
    };

    return [
      {
        title: 'Personal & contact',
        icon: 'user',
        rows: keep([
          row('Phone', l.phone, formatPhone(l.phone)),
          row('Email', l.email),
          row('Marital status', l.maritalStatus, humanizeEnum(l.maritalStatus)),
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
          row('Plan type', l.planType),
          row('Coverage amount', l.coverageAmount, formatMoney(l.coverageAmount)),
          row('Monthly premium', l.monthlyPremiums, formatMoney(l.monthlyPremiums)),
        ]),
      },
      {
        title: 'Billing',
        icon: 'billing',
        rows: keep([
          row('Payer', l.payer, humanizeEnum(l.payer)),
          row('Initial draft date', l.initialDraftDate, formatDate(l.initialDraftDate)),
          row('Future draft date', l.futureDraftDate, formatDate(l.futureDraftDate)),
          row('Bank name', l.bankName),
          row('Account title', l.accountTitle),
          row('Account type', l.accountType, humanizeEnum(l.accountType)),
          row('Routing number', l.routingNumber, show ? l.routingNumber! : maskAccount(l.routingNumber), true),
          row('Account number', l.accountNumber, show ? l.accountNumber! : maskAccount(l.accountNumber), true),
          row("Payer's SSN", l.payerSocial, show ? l.payerSocial! : maskSsn(l.payerSocial), true),
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
          row('Last updated', l.updatedAt, formatDateTime(l.updatedAt)),
          row('Closed at', l.closedAt, formatDateTime(l.closedAt)),
        ]),
      },
    ];
  });
}
