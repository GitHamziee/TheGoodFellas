import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../config';
import {
  Lead,
  LeadHistoryRow,
  LeadInboxPreview,
  LeadIntakeEdit,
  TeamLeadLeadRow,
} from '../models/lead.model';
import { LeadReviewRow, QaCloserLeadRow, QaJuniorLeadRow, ReviewOutcome } from '../models/review.model';
import type { ApiSuccess } from '../api';

const BASE = `${API_BASE_URL}/leads`;

const SHARED_KEYS = [
  'customerName', 'maritalStatus', 'phone', 'state', 'zipcode', 'birthState', 'gender',
  'smoker', 'dob', 'age', 'height', 'weight', 'healthConditions',
] as const;

export type JuniorLeadInput = Partial<Pick<Lead, (typeof SHARED_KEYS)[number]>> &
  Partial<Pick<Lead, 'need' | 'incomeSource' | 'retiredIncomeType' | 'natureOfDisability' | 'annualIncome' | 'juniorNotes'>> & {
    closerId: string;
  };

const CPL_SHARED_KEYS = ['customerName', 'phone', 'state', 'zipcode', 'smoker', 'dob'] as const;

/** CPL's own, deliberately shorter intake — no closerId, no enrichment step ever follows. */
export type CplLeadInput = Partial<Pick<Lead, (typeof CPL_SHARED_KEYS)[number]>> &
  Partial<Pick<Lead, 'need' | 'juniorNotes' | 'decisionMaker' | 'bankAccount' | 'dCode'>>;

export type CloserLeadInput = Partial<Pick<Lead, (typeof SHARED_KEYS)[number]>> &
  Partial<
    Pick<
      Lead,
      | 'mailingAddress'
      | 'email'
      | 'yearlyIncome'
      | 'ssn'
      | 'dlStateId'
      | 'doctorName'
      | 'beneficiaryRelation'
      | 'beneficiaryName'
      | 'beneficiaryDob'
      | 'medications'
      | 'carrierName'
      | 'planType'
      | 'coverageAmount'
      | 'monthlyPremiums'
      | 'initialDraftDate'
      | 'futureDraftDate'
      | 'payer'
      | 'paymentMethod'
      | 'bankName'
      | 'accountTitle'
      | 'payerSocial'
      | 'accountType'
      | 'accountOwnership'
      | 'accountOpeningState'
      | 'routingNumber'
      | 'accountNumber'
      | 'cardType'
      | 'cardNumber'
      | 'cardExpiry'
      | 'closerNotes'
      | 'draftReason'
      | 'draftReasonNote'
      | 'suggestedClientId'
    >
  >;

export type AdminLeadEditInput = CloserLeadInput &
  Partial<Omit<JuniorLeadInput, 'closerId'>> &
  Partial<Pick<Lead, 'decisionMaker' | 'bankAccount' | 'dCode'>>;

/** Closer building a lead from scratch — junior intake + closer enrichment together,
 *  no CPL-only fields, no closerId (the caller is implicit). */
export type CloserCreateLeadInput = CloserLeadInput & Partial<Omit<JuniorLeadInput, 'closerId'>>;

/** Retention submitting a form-imported lead — same full field set as CloserCreateLeadInput
 *  (no CPL-only fields, no owner id — the caller is implicit and not even checked, any
 *  Retention teammate may submit any other's lead). */
export type RetentionSubmitInput = CloserCreateLeadInput;

const RETENTION_INTAKE_KEYS = [
  'customerName', 'phone', 'mailingAddress', 'state', 'dob', 'ssn', 'carrierName',
  'planType', 'coverageAmount', 'monthlyPremiums', 'beneficiaryName',
  'paymentMethod', 'bankName', 'accountType', 'accountOwnership', 'accountOpeningState',
  'routingNumber', 'accountNumber', 'cardType', 'cardNumber', 'cardExpiry',
] as const;

/** What the public retention intake form (no login) submits — whoever just worked an
 *  AI-sourced call types these in directly. */
export type RetentionIntakeInput = Partial<Pick<Lead, (typeof RETENTION_INTAKE_KEYS)[number]>>;

@Injectable({ providedIn: 'root' })
export class LeadService {
  private readonly http = inject(HttpClient);

  // ─── Junior Closer ──────────────────────────────────────────
  async submitLead(input: JuniorLeadInput): Promise<Lead> {
    const res = await firstValueFrom(this.http.post<ApiSuccess<{ lead: Lead }>>(BASE, input));
    return res.data.lead;
  }

  /** CPL submission — skips the closer entirely, lands straight in the admin's queue. */
  async submitCplLead(input: CplLeadInput): Promise<Lead> {
    const res = await firstValueFrom(this.http.post<ApiSuccess<{ lead: Lead }>>(`${BASE}/cpl`, input));
    return res.data.lead;
  }

  async myLeads(): Promise<LeadHistoryRow[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: LeadHistoryRow[] }>>(`${BASE}/mine`));
    return res.data.leads;
  }

  /** Leads the admin sent back to this junior closer to correct. */
  async myReturnedLeads(): Promise<LeadIntakeEdit[]> {
    const res = await firstValueFrom(
      this.http.get<ApiSuccess<{ leads: LeadIntakeEdit[] }>>(`${BASE}/returned/mine`)
    );
    return res.data.leads;
  }

  /** Corrects the intake and sends it back to the admin — same endpoint for CPA and CPL,
   *  the server picks the right field set from the lead's own leadType. */
  async resubmitIntake(
    id: string,
    input: Omit<JuniorLeadInput, 'closerId'> & Partial<Pick<Lead, 'decisionMaker' | 'bankAccount' | 'dCode'>>
  ): Promise<LeadHistoryRow> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ lead: LeadHistoryRow }>>(`${BASE}/${id}/resubmit-intake`, input)
    );
    return res.data.lead;
  }

  // ─── Closer ─────────────────────────────────────────────────
  async inbox(): Promise<LeadInboxPreview[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: LeadInboxPreview[] }>>(`${BASE}/inbox`));
    return res.data.leads;
  }

  async closerHistory(): Promise<LeadHistoryRow[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: LeadHistoryRow[] }>>(`${BASE}/closer-history`));
    return res.data.leads;
  }

  async enrichLead(id: string, input: CloserLeadInput): Promise<Lead> {
    const res = await firstValueFrom(this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/${id}/enrich`, input));
    return res.data.lead;
  }

  /** Leads this closer has parked as a draft — full detail, resumable only by them. */
  async drafts(): Promise<Lead[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: Lead[] }>>(`${BASE}/drafts`));
    return res.data.leads;
  }

  /** Parks a NEW or already-drafted lead instead of submitting it — draftReason is required. */
  async saveDraft(id: string, input: CloserLeadInput): Promise<Lead> {
    const res = await firstValueFrom(this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/${id}/draft`, input));
    return res.data.lead;
  }

  /** Leads the admin sent back to this closer to correct. */
  async closerReturnedLeads(): Promise<Lead[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: Lead[] }>>(`${BASE}/returned/closer`));
    return res.data.leads;
  }

  /** Corrects the enrichment and sends it back to the admin. */
  async resubmitEnrichment(id: string, input: CloserLeadInput): Promise<Lead> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/${id}/resubmit-enrichment`, input)
    );
    return res.data.lead;
  }

  /** Closer builds a lead from scratch — self-/AI-sourced calls with no junior closer
   *  involved. Lands straight in the admin queue as SUBMITTED. */
  async createLeadAsCloser(input: CloserCreateLeadInput): Promise<Lead> {
    const res = await firstValueFrom(this.http.post<ApiSuccess<{ lead: Lead }>>(`${BASE}/closer`, input));
    return res.data.lead;
  }

  /** Same as createLeadAsCloser, but parks it as a draft — draftReason is required.
   *  Resumable via the normal enrich-lead page, same as any other closer draft. */
  async createLeadAsCloserDraft(input: CloserCreateLeadInput): Promise<Lead> {
    const res = await firstValueFrom(this.http.post<ApiSuccess<{ lead: Lead }>>(`${BASE}/closer/draft`, input));
    return res.data.lead;
  }

  // ─── Admin ──────────────────────────────────────────────────
  async queue(): Promise<Lead[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: Lead[] }>>(`${BASE}/queue`));
    return res.data.leads;
  }

  async allLeads(): Promise<Lead[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: Lead[] }>>(`${BASE}/all`));
    return res.data.leads;
  }

  /** All CPL leads, any status — feeds the dedicated Admin "CPL Leads" page. */
  async cplLeads(): Promise<Lead[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: Lead[] }>>(`${BASE}/cpl`));
    return res.data.leads;
  }

  /** Every closer's parked drafts — Admin oversight, full detail, view-only. */
  async adminDrafts(): Promise<Lead[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: Lead[] }>>(`${BASE}/admin/drafts`));
    return res.data.leads;
  }

  /** Charged-back leads waiting to be reassigned to a different client/external client. */
  async chargeBacks(): Promise<Lead[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: Lead[] }>>(`${BASE}/charge-backs`));
    return res.data.leads;
  }

  /** Records a chargeback against an ACCEPTED + PAID lead — frees it up for reassignment. */
  async chargeBackLead(id: string, pkrAmount: number, reason: string): Promise<Lead> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/${id}/charge-back`, { pkrAmount, reason })
    );
    return res.data.lead;
  }

  async assignLead(id: string, clientId: string): Promise<Lead> {
    const res = await firstValueFrom(this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/${id}/assign`, { clientId }));
    return res.data.lead;
  }

  async assignLeadExternal(id: string, externalClientId: string): Promise<Lead> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/${id}/assign-external`, { externalClientId })
    );
    return res.data.lead;
  }

  async editLead(id: string, input: AdminLeadEditInput): Promise<Lead> {
    const res = await firstValueFrom(this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/${id}`, input));
    return res.data.lead;
  }

  /** Sends a queued lead back to whichever role entered the bad data. */
  async returnLead(id: string, target: 'JUNIOR_CLOSER' | 'CLOSER' | 'RETENTION', reason: string): Promise<Lead> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/${id}/return`, { target, reason })
    );
    return res.data.lead;
  }

  /** Admin override of the client's own approve/decline step, for many leads at once — records
   *  a decision made over the phone. Works for client-assigned and external-assigned leads. */
  async batchDecide(leadIds: string[], decision: 'ACCEPT' | 'REJECT', reason?: string): Promise<{ count: number }> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ count: number }>>(`${BASE}/batch-decision`, { leadIds, decision, reason })
    );
    return res.data;
  }

  /** Reverts a mistaken PAID back to UNPAID. Marking a lead PAID only happens via batchMarkPaid,
   *  so the amount received is always recorded — this never sets PAID. */
  async markUnpaid(id: string): Promise<Lead> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/${id}/payment-status`, { paymentStatus: 'UNPAID' })
    );
    return res.data.lead;
  }

  /** Marks a batch of leads paid at once, recording one PKR amount for the whole batch. */
  async batchMarkPaid(leadIds: string[], pkrAmount: number, note?: string): Promise<{ count: number }> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ count: number }>>(`${BASE}/batch-payment`, { leadIds, pkrAmount, note })
    );
    return res.data;
  }

  /** Charges back many ACCEPTED + PAID leads at once — one PKR total and one reason for the batch. */
  async batchChargeBack(leadIds: string[], pkrAmount: number, reason: string): Promise<{ count: number }> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ count: number }>>(`${BASE}/batch-charge-back`, { leadIds, pkrAmount, reason })
    );
    return res.data;
  }

  // ─── Client ─────────────────────────────────────────────────
  /** "New Leads" page — ASSIGNED, masked preview until accepted. */
  async assignedPreviews(): Promise<Lead[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: Lead[] }>>(`${BASE}/assigned`));
    return res.data.leads;
  }

  /** "Lead History" page — everything this client has accepted, full detail. */
  async clientHistory(): Promise<Lead[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: Lead[] }>>(`${BASE}/client-history`));
    return res.data.leads;
  }

  async clientEditLead(id: string, input: AdminLeadEditInput): Promise<Lead> {
    const res = await firstValueFrom(this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/${id}/client-edit`, input));
    return res.data.lead;
  }

  async acceptLead(id: string): Promise<Lead> {
    const res = await firstValueFrom(this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/${id}/accept`, {}));
    return res.data.lead;
  }

  async rejectLead(id: string, reason?: string): Promise<Lead> {
    const res = await firstValueFrom(this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/${id}/reject`, { reason }));
    return res.data.lead;
  }

  // ─── Team Lead ────────────────────────────────────────────────
  /** Masked, read-only view of the admin's SUBMITTED queue. */
  async teamLeadSubmitted(): Promise<TeamLeadLeadRow[]> {
    const res = await firstValueFrom(
      this.http.get<ApiSuccess<{ leads: TeamLeadLeadRow[] }>>(`${BASE}/team-lead/leads`)
    );
    return res.data.leads;
  }

  // ─── Public — Retention intake form (no login) ─────────────────
  /** Submits the public retention intake form. Reaches the server ahead of `authenticate`,
   *  so this works whether or not the caller is logged in. */
  async submitRetentionIntake(input: RetentionIntakeInput): Promise<Lead> {
    const res = await firstValueFrom(this.http.post<ApiSuccess<{ lead: Lead }>>(`${BASE}/retention/intake`, input));
    return res.data.lead;
  }

  // ─── Admin: Retention imports ─────────────────────────────────
  /** Form-submitted leads not yet handed to a Retention person. */
  /** Admin: pull new leads from the Google Sheet right now (it also syncs on its own timer). */
  async syncRetentionSheet(): Promise<{ imported: number; alreadyImported: number; invalid: { row: number; reason: string }[] }> {
    const res = await firstValueFrom(
      this.http.post<ApiSuccess<{ imported: number; alreadyImported: number; invalid: { row: number; reason: string }[] }>>(`${BASE}/retention/sync`, {})
    );
    return res.data;
  }

  async retentionUnassigned(): Promise<Lead[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: Lead[] }>>(`${BASE}/retention/unassigned`));
    return res.data.leads;
  }

  /** Every RETENTION lead, any status. */
  async retentionAll(): Promise<Lead[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: Lead[] }>>(`${BASE}/retention/all`));
    return res.data.leads;
  }

  /** Hands (or re-hands, to correct a misassignment) an unworked retention lead to a person. */
  async assignRetention(id: string, retentionId: string): Promise<Lead> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/retention/${id}/assign`, { retentionId })
    );
    return res.data.lead;
  }

  /** Hands many unworked retention leads to one person; ineligible ids are skipped server-side. */
  async batchAssignRetention(leadIds: string[], retentionId: string): Promise<{ count: number }> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ count: number }>>(`${BASE}/retention/batch-assign`, { leadIds, retentionId })
    );
    return res.data;
  }

  // ─── Retention ────────────────────────────────────────────────
  /** Retention builds a lead from scratch — self-/AI-sourced calls worked directly by a
   *  Retention person, no public intake form involved. Lands straight in the admin queue
   *  as SUBMITTED, same as createLeadAsCloser. */
  async createLeadAsRetention(input: RetentionSubmitInput): Promise<Lead> {
    const res = await firstValueFrom(this.http.post<ApiSuccess<{ lead: Lead }>>(`${BASE}/retention`, input));
    return res.data.lead;
  }

  /** Same as createLeadAsRetention, but parks it as a draft — draftReason is required.
   *  Resumable via the normal shared queue + lead-edit page, same as any other retention draft. */
  async createLeadAsRetentionDraft(input: RetentionSubmitInput): Promise<Lead> {
    const res = await firstValueFrom(this.http.post<ApiSuccess<{ lead: Lead }>>(`${BASE}/retention/draft`, input));
    return res.data.lead;
  }

  /** The whole team's shared working queue, full detail — not scoped to the caller. */
  async retentionQueue(): Promise<Lead[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: Lead[] }>>(`${BASE}/retention/queue`));
    return res.data.leads;
  }

  /** Edits + submits a retention lead — any Retention teammate may act on any other's lead. */
  async retentionSubmit(id: string, input: RetentionSubmitInput): Promise<Lead> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/retention/${id}/submit`, input)
    );
    return res.data.lead;
  }

  /** Parks a retention lead as a draft instead of submitting it — draftReason required,
   *  same as the Closer's saveDraft. Reappears in the shared queue, resumable by anyone. */
  async retentionSaveDraft(id: string, input: RetentionSubmitInput): Promise<Lead> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/retention/${id}/draft`, input)
    );
    return res.data.lead;
  }

  /** Marks a queue lead as a Callback — only the caller sees it until they remove it. */
  async retentionMarkCallback(id: string): Promise<Lead> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/retention/${id}/callback`, {})
    );
    return res.data.lead;
  }

  /** Clears the caller's own Callback; the lead goes back to its unchanged status and assignee. */
  async retentionRemoveCallback(id: string): Promise<Lead> {
    const res = await firstValueFrom(this.http.delete<ApiSuccess<{ lead: Lead }>>(`${BASE}/retention/${id}/callback`));
    return res.data.lead;
  }

  /** Shared team history — leads worked past the queue. Coverage amount and monthly
   *  premium come back null; Retention doesn't see money figures. */
  async retentionHistory(): Promise<Lead[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: Lead[] }>>(`${BASE}/retention/history`));
    return res.data.leads;
  }

  // ─── QA ─────────────────────────────────────────────────────
  /** Leads QA_JUNIOR_CLOSER hasn't reviewed the intake on yet — unmasked intake fields only. */
  async qaJuniorQueue(): Promise<QaJuniorLeadRow[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: QaJuniorLeadRow[] }>>(`${BASE}/qa/junior-queue`));
    return res.data.leads;
  }

  async qaJuniorHistory(): Promise<LeadReviewRow<QaJuniorLeadRow>[]> {
    const res = await firstValueFrom(
      this.http.get<ApiSuccess<{ reviews: LeadReviewRow<QaJuniorLeadRow>[] }>>(`${BASE}/qa/junior-history`)
    );
    return res.data.reviews;
  }

  /** Leads QA_CLOSER hasn't reviewed the enrichment on yet — full detail. */
  async qaCloserQueue(): Promise<QaCloserLeadRow[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: QaCloserLeadRow[] }>>(`${BASE}/qa/closer-queue`));
    return res.data.leads;
  }

  async qaCloserHistory(): Promise<LeadReviewRow<QaCloserLeadRow>[]> {
    const res = await firstValueFrom(
      this.http.get<ApiSuccess<{ reviews: LeadReviewRow<QaCloserLeadRow>[] }>>(`${BASE}/qa/closer-history`)
    );
    return res.data.reviews;
  }

  /** Records this QA reviewer's pass/fail verdict — locked to one per lead per QA lane. */
  async submitQaReview(id: string, outcome: ReviewOutcome, comment?: string): Promise<void> {
    await firstValueFrom(this.http.patch<ApiSuccess<unknown>>(`${BASE}/${id}/qa-review`, { outcome, comment }));
  }

  // ─── Shared ─────────────────────────────────────────────────
  async getLead(id: string): Promise<Lead> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ lead: Lead }>>(`${BASE}/${id}`));
    return res.data.lead;
  }
}
