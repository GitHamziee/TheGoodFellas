import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../config';
import { DraftReason, LeadParty, LeadStatus, PlanType } from '../models/lead.model';
import { CallReviewAnalytics } from '../models/review.model';

interface ApiSuccess<T> {
  data: T;
  message?: string;
}

export interface UserOutcomeRow {
  id: string;
  name: string;
  email: string;
  total: number;
  accepted: number;
  rejected: number;
}

export interface OverallAnalytics {
  totalLeads: number;
  statusCounts: Partial<Record<LeadStatus, number>>;
  closedCount: number;
  unpaidAcceptedCount: number;
  roleCounts: Record<string, number>;
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

export interface DraftRow {
  id: string;
  customerName: string;
  draftReason: DraftReason | null;
  draftReasonNote: string | null;
  createdAt: string;
  updatedAt: string;
  ageDays: number;
  closer: { id: string; name: string };
  /** Null when the closer built the lead from scratch (self- or AI-sourced, no junior closer). */
  juniorCloser: { id: string; name: string } | null;
}

export interface DraftsAnalytics {
  total: number;
  oldestDays: number;
  avgAgeDays: number;
  byCloser: { id: string; name: string; email: string; count: number }[];
  byReason: Partial<Record<DraftReason, number>>;
  drafts: DraftRow[];
}

export interface ChargeBackBucket {
  id: string;
  name: string;
  email: string;
  count: number;
  pkrAmount: number;
}

export interface ChargeBackRecent {
  id: string;
  leadId: string;
  customerName: string;
  client: LeadParty;
  /** Null for a charged-back CPL lead — CPL has no closer to attribute it to. */
  closer: LeadParty | null;
  pkrAmount: number;
  reason: string;
  createdAt: string;
}

export interface ChargeBackAnalytics {
  total: number;
  totalPkrAmount: number;
  byClient: ChargeBackBucket[];
  byCloser: ChargeBackBucket[];
  recent: ChargeBackRecent[];
}

const BASE = `${API_BASE_URL}/admin/analytics`;

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly http = inject(HttpClient);

  async juniorClosers(): Promise<UserOutcomeRow[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ rows: UserOutcomeRow[] }>>(`${BASE}/junior-closers`));
    return res.data.rows;
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

  async drafts(): Promise<DraftsAnalytics> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ drafts: DraftsAnalytics }>>(`${BASE}/drafts`));
    return res.data.drafts;
  }

  async chargeBacks(): Promise<ChargeBackAnalytics> {
    const res = await firstValueFrom(
      this.http.get<ApiSuccess<{ chargeBacks: ChargeBackAnalytics }>>(`${BASE}/charge-backs`)
    );
    return res.data.chargeBacks;
  }

  // ─── QA Reports — reuse UserOutcomeRow (accepted/rejected stand in for PASS/FAIL) ──
  /** Transfer Report — how QA scored the leads each Junior Closer submitted. */
  async qaJuniorClosers(): Promise<UserOutcomeRow[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ rows: UserOutcomeRow[] }>>(`${BASE}/qa-junior-closers`));
    return res.data.rows;
  }

  /** Transfer Report — how QA scored the leads each Closer enriched. */
  async qaClosers(): Promise<UserOutcomeRow[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ rows: UserOutcomeRow[] }>>(`${BASE}/qa-closers`));
    return res.data.rows;
  }

  /** Live Call Report — issues QA has flagged against each Junior Closer's live calls. */
  async callReviewsJunior(): Promise<CallReviewAnalytics> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ issues: CallReviewAnalytics }>>(`${BASE}/call-reviews-junior`));
    return res.data.issues;
  }

  /** Live Call Report — issues QA has flagged against each Closer's live calls. */
  async callReviewsCloser(): Promise<CallReviewAnalytics> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ issues: CallReviewAnalytics }>>(`${BASE}/call-reviews-closer`));
    return res.data.issues;
  }
}
