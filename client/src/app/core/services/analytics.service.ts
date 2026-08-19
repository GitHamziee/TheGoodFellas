import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../config';
import { DraftReason, LeadParty, LeadStatus, PlanType } from '../models/lead.model';

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
  createdAt: string;
  updatedAt: string;
  ageDays: number;
  closer: { id: string; name: string };
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
}
