import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../config';
import { LeadStatus } from '../models/lead.model';

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

  async overall(): Promise<OverallAnalytics> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ overall: OverallAnalytics }>>(`${BASE}/overall`));
    return res.data.overall;
  }
}
