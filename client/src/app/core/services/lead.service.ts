import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../config';
import { Lead, LeadHistoryRow, LeadPreview, PaymentStatus } from '../models/lead.model';

interface ApiSuccess<T> {
  data: T;
  message?: string;
}

const BASE = `${API_BASE_URL}/leads`;

const SHARED_KEYS = [
  'customerName', 'maritalStatus', 'phone', 'state', 'zipcode', 'birthState',
  'smoker', 'dob', 'age', 'height', 'weight', 'healthConditions',
] as const;

export type JuniorLeadInput = Partial<Pick<Lead, (typeof SHARED_KEYS)[number]>> &
  Partial<Pick<Lead, 'need' | 'incomeSource' | 'retiredIncomeType' | 'natureOfDisability' | 'annualIncome' | 'juniorNotes'>> & {
    closerId: string;
  };

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
      | 'bankName'
      | 'accountTitle'
      | 'payerSocial'
      | 'accountType'
      | 'routingNumber'
      | 'accountNumber'
      | 'closerNotes'
    >
  >;

export type AdminLeadEditInput = CloserLeadInput & Partial<Omit<JuniorLeadInput, 'closerId'>>;

@Injectable({ providedIn: 'root' })
export class LeadService {
  private readonly http = inject(HttpClient);

  // ─── Junior Closer ──────────────────────────────────────────
  async submitLead(input: JuniorLeadInput): Promise<Lead> {
    const res = await firstValueFrom(this.http.post<ApiSuccess<{ lead: Lead }>>(BASE, input));
    return res.data.lead;
  }

  async myLeads(): Promise<LeadHistoryRow[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: LeadHistoryRow[] }>>(`${BASE}/mine`));
    return res.data.leads;
  }

  // ─── Closer ─────────────────────────────────────────────────
  async inbox(): Promise<Lead[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: Lead[] }>>(`${BASE}/inbox`));
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

  // ─── Admin ──────────────────────────────────────────────────
  async queue(): Promise<Lead[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: Lead[] }>>(`${BASE}/queue`));
    return res.data.leads;
  }

  async allLeads(): Promise<Lead[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: Lead[] }>>(`${BASE}/all`));
    return res.data.leads;
  }

  async assignLead(id: string, clientId: string): Promise<Lead> {
    const res = await firstValueFrom(this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/${id}/assign`, { clientId }));
    return res.data.lead;
  }

  async editLead(id: string, input: AdminLeadEditInput): Promise<Lead> {
    const res = await firstValueFrom(this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/${id}`, input));
    return res.data.lead;
  }

  async setPaymentStatus(id: string, paymentStatus: PaymentStatus): Promise<Lead> {
    const res = await firstValueFrom(this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/${id}/payment-status`, { paymentStatus }));
    return res.data.lead;
  }

  // ─── Client ─────────────────────────────────────────────────
  /** "New Leads" page — ASSIGNED, masked preview until accepted. */
  async assignedPreviews(): Promise<LeadPreview[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: LeadPreview[] }>>(`${BASE}/assigned`));
    return res.data.leads;
  }

  /** "Lead History" page — everything this client has accepted, full detail. */
  async clientHistory(): Promise<Lead[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ leads: Lead[] }>>(`${BASE}/client-history`));
    return res.data.leads;
  }

  async acceptLead(id: string): Promise<Lead> {
    const res = await firstValueFrom(this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/${id}/accept`, {}));
    return res.data.lead;
  }

  async rejectLead(id: string, reason?: string): Promise<Lead> {
    const res = await firstValueFrom(this.http.patch<ApiSuccess<{ lead: Lead }>>(`${BASE}/${id}/reject`, { reason }));
    return res.data.lead;
  }

  // ─── Shared ─────────────────────────────────────────────────
  async getLead(id: string): Promise<Lead> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ lead: Lead }>>(`${BASE}/${id}`));
    return res.data.lead;
  }
}
