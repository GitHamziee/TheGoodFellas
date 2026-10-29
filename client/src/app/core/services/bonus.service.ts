import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../config';
import type { ApiSuccess } from '../api';

const BASE = `${API_BASE_URL}/bonuses/retention`;

export type BonusRules = {
  monthlyThreshold: number;
  monthlyBase: number;
  daily2: number;
  daily3: number;
  daily4: number;
  daily5: number;
  daily6: number;
  levelRate: number;
  gradedRate: number;
  giRate: number;
};

export type BonusDayRow = { day: string; count: number; bonus: number; payoutDay: string };

export type MonthlyBonus = {
  count: number;
  qualified: boolean;
  base: number;
  extra: { level: number; gradedModified: number; gi: number; unclassified: number };
  extraAmount: number;
  total: number;
};

export type BonusPersonRow = {
  userId: string;
  name: string;
  days: BonusDayRow[];
  dailyTotal: number;
  monthly: MonthlyBonus;
  total: number;
};

export type BonusReport = { month: string; rules: BonusRules; people: BonusPersonRow[] };

@Injectable({ providedIn: 'root' })
export class BonusService {
  private readonly http = inject(HttpClient);

  async rules(): Promise<BonusRules> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ rules: BonusRules }>>(`${BASE}/rules`));
    return res.data.rules;
  }

  async saveRules(rules: BonusRules): Promise<BonusRules> {
    const res = await firstValueFrom(this.http.put<ApiSuccess<{ rules: BonusRules }>>(`${BASE}/rules`, rules));
    return res.data.rules;
  }

  /** The signed-in Retention person's own bonus. */
  async mine(month: string): Promise<{ month: string; rules: BonusRules; me: BonusPersonRow }> {
    const res = await firstValueFrom(
      this.http.get<ApiSuccess<{ month: string; rules: BonusRules; me: BonusPersonRow }>>(`${BASE}/mine`, { params: { month } })
    );
    return res.data;
  }

  async report(month: string): Promise<BonusReport> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<BonusReport>>(`${BASE}/report`, { params: { month } }));
    return res.data;
  }
}
