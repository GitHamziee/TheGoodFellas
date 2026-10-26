import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../config';
import { LeadParty, LeadStatus, LeadType, PaymentStatus, PlanType } from '../models/lead.model';
import { CallReviewDetail, QaLane, QaTransferDetail } from '../models/review.model';
import type { ApiSuccess } from '../api';

export interface UserOutcomeRow {
  id: string;
  name: string;
  email: string;
  total: number;
  accepted: number;
  rejected: number;
}

/** One lead a Junior Closer submitted — masked summary, no phone/SSN/bank fields. */
export interface JuniorLeadRow {
  id: string;
  customerName: string;
  leadType: LeadType;
  dCode: string | null;
  state: string;
  status: LeadStatus;
  planType: PlanType | null;
  paymentStatus: PaymentStatus;
  returnReason: string | null;
  createdAt: string;
  updatedAt: string;
  closer: LeadParty | null;
  client: LeadParty | null;
  externalClient: LeadParty | null;
}

export interface JuniorQaVerdict {
  id: string;
  leadId: string;
  outcome: 'PASS' | 'FAIL';
  comment: string | null;
  createdAt: string;
  reviewer: LeadParty;
  lead: { customerName: string };
}

export interface JuniorCallIssue {
  id: string;
  comment: string;
  createdAt: string;
  reviewer: LeadParty;
  lead: { id: string; customerName: string } | null;
}

export interface JuniorCloserDetail {
  person: { id: string; name: string; email: string; createdAt: string };
  leads: JuniorLeadRow[];
  reviews: JuniorQaVerdict[];
  callIssues: JuniorCallIssue[];
  team: { people: number; avgTotal: number; acceptRate: number | null; volumeRank: number };
}

export interface OverallAnalytics {
  totalLeads: number;
  statusCounts: Partial<Record<LeadStatus, number>>;
  closedCount: number;
  unpaidAcceptedCount: number;
  roleCounts: Record<string, number>;
  /** One light row per lead (no customer fields) — sliced by period/source on the page. */
  leads: { status: LeadStatus; leadType: LeadType; paymentStatus: PaymentStatus; createdAt: string }[];
  chargeBacks: { createdAt: string; leadType: LeadType }[];
}

export interface ClosePlanBreakdown {
  planType: PlanType;
  count: number;
  /** Expected revenue (PKR) — count × the client's cost for this plan, not money actually collected. */
  revenue: number;
}

export interface ClosePlanRow {
  id: string;
  name: string;
  email: string;
  plans: ClosePlanBreakdown[];
  totalCount: number;
  totalRevenue: number;
  /**
   * `monthlyPremiums × 12` (USD) summed over the same sold leads as `totalRevenue` —
   * only populated for closers (the client-plans endpoint reuses this shape but never
   * sets it, since monthlyPremiums is a closer-only enrichment field).
   */
  annualPremiumRevenue?: number;
}

export interface ChargeBackBucket {
  id: string;
  name: string;
  email: string;
  count: number;
  /** ADMIN only — omitted for MANAGER. */
  pkrAmount?: number;
}

export interface ChargeBackRecent {
  id: string;
  leadId: string;
  customerName: string;
  phone: string;
  state: string;
  planType: PlanType | null;
  awaitingReassignment: boolean;
  /** The lead's current status — the row outlives the CHARGED_BACK state. */
  leadStatus: LeadStatus;
  /** Who the lead went to after the chargeback; null while it is still waiting for a new client. */
  reassignedTo: string | null;
  juniorCloser: LeadParty | null;
  client: LeadParty;
  /** Null for a charged-back CPL lead — CPL has no closer to attribute it to. */
  closer: LeadParty | null;
  /** ADMIN only — omitted for MANAGER. */
  pkrAmount?: number;
  reason: string;
  createdAt: string;
}

export interface ChargeBackAnalytics {
  total: number;
  /** ADMIN only — omitted for MANAGER. */
  totalPkrAmount?: number;
  byClient: ChargeBackBucket[];
  byCloser: ChargeBackBucket[];
  recent: ChargeBackRecent[];
}

const BASE = `${API_BASE_URL}/admin/analytics`;

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly http = inject(HttpClient);

  /** `range` is [start, end) epoch-ms; omit for all time. */
  async juniorClosers(range?: [number, number]): Promise<UserOutcomeRow[]> {
    const params: Record<string, string> = range ? { from: new Date(range[0]).toISOString(), to: new Date(range[1]).toISOString() } : {};
    const res = await firstValueFrom(
      this.http.get<ApiSuccess<{ rows: UserOutcomeRow[] }>>(`${BASE}/junior-closers`, { params })
    );
    return res.data.rows;
  }

  async juniorCloserDetail(id: string): Promise<JuniorCloserDetail> {
    const res = await firstValueFrom(
      this.http.get<ApiSuccess<{ detail: JuniorCloserDetail }>>(`${BASE}/junior-closers/${id}`)
    );
    return res.data.detail;
  }

  async closers(): Promise<UserOutcomeRow[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ rows: UserOutcomeRow[] }>>(`${BASE}/closers`));
    return res.data.rows;
  }

  async retention(): Promise<UserOutcomeRow[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ rows: UserOutcomeRow[] }>>(`${BASE}/retention`));
    return res.data.rows;
  }

  async closerPlans(): Promise<ClosePlanRow[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ rows: ClosePlanRow[] }>>(`${BASE}/closers/plans`));
    return res.data.rows;
  }

  async clientPlans(): Promise<ClosePlanRow[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ rows: ClosePlanRow[] }>>(`${BASE}/clients/plans`));
    return res.data.rows;
  }

  async overall(): Promise<OverallAnalytics> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ overall: OverallAnalytics }>>(`${BASE}/overall`));
    return res.data.overall;
  }

  async chargeBacks(): Promise<ChargeBackAnalytics> {
    const res = await firstValueFrom(
      this.http.get<ApiSuccess<{ chargeBacks: ChargeBackAnalytics }>>(`${BASE}/charge-backs`)
    );
    return res.data.chargeBacks;
  }

  // ─── QA Reports — detail rows; the report components aggregate in memory ──
  /** Transfer Report — every QA verdict on a lane's leads, plus what's still awaiting QA. */
  async qaTransfer(lane: QaLane): Promise<QaTransferDetail> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ detail: QaTransferDetail }>>(`${BASE}/qa-transfer/${lane}`));
    return res.data.detail;
  }

  /** Live Call Report — every issue QA has flagged against a lane's people. */
  async callReviews(lane: QaLane): Promise<CallReviewDetail> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ detail: CallReviewDetail }>>(`${BASE}/call-reviews/${lane}`));
    return res.data.detail;
  }
}
