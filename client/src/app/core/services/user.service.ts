import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../config';
import { AppUser, ClientCoverage, Role } from '../models/user.model';

interface ApiSuccess<T> {
  data: T;
  message?: string;
}

type LookupUser = Pick<AppUser, 'id' | 'name' | 'email'>;

const BASE = `${API_BASE_URL}/users`;

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly http = inject(HttpClient);

  /** For the junior closer's "select a closer" dropdown at lead submission. */
  async listClosers(): Promise<LookupUser[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ closers: LookupUser[] }>>(`${BASE}/closers`));
    return res.data.closers;
  }

  /** For QA_JUNIOR_CLOSER's "who is this call review about" dropdown. */
  async listJuniorClosers(): Promise<LookupUser[]> {
    const res = await firstValueFrom(
      this.http.get<ApiSuccess<{ juniorClosers: LookupUser[] }>>(`${BASE}/junior-closers`),
    );
    return res.data.juniorClosers;
  }

  /** For the admin's "assign to client" dropdown. */
  async listClients(): Promise<LookupUser[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ clients: LookupUser[] }>>(`${BASE}/clients`));
    return res.data.clients;
  }

  /** For Admin's "assign to retention person" dropdown and the Retention queue's
   * "filter by teammate" dropdown. */
  async listRetention(): Promise<LookupUser[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ retention: LookupUser[] }>>(`${BASE}/retention`));
    return res.data.retention;
  }

  /** For the State Sheet — visible to Closer/Team Lead/Admin, narrower than listUsers(). */
  async getStateSheet(): Promise<ClientCoverage[]> {
    const res = await firstValueFrom(
      this.http.get<ApiSuccess<{ clients: ClientCoverage[] }>>(`${BASE}/state-sheet`),
    );
    return res.data.clients;
  }

  /** Any role — editing an account's basic info. Clients (and staff) have no self-service
   * way to fix their own name/email/phone; Settings is password-change only. */
  async updateProfile(
    id: string,
    profile: { name?: string; email?: string; phone?: string | null },
  ): Promise<AppUser> {
    const res = await firstValueFrom(this.http.patch<ApiSuccess<{ user: AppUser }>>(`${BASE}/${id}`, profile));
    return res.data.user;
  }

  async listUsers(role?: Role): Promise<AppUser[]> {
    const res = await firstValueFrom(
      this.http.get<ApiSuccess<{ users: AppUser[] }>>(BASE, { params: role ? { role } : {} })
    );
    return res.data.users;
  }

  async createUser(input: {
    name: string;
    email: string;
    password: string;
    role: Role;
    phone?: string;
    levelCost?: number | null;
    gradedCost?: number | null;
    modifiedCost?: number | null;
    giCost?: number | null;
    minimumPremium?: number | null;
    acceptsOnlineBankPayment?: boolean;
    states?: string[];
    carriers?: string[];
    stateCarriers?: { state: string; carriers: string[] }[];
  }): Promise<AppUser> {
    const res = await firstValueFrom(this.http.post<ApiSuccess<{ user: AppUser }>>(BASE, input));
    return res.data.user;
  }

  /** CLIENT accounts only — editing the per-plan lead cost + minimum premium after creation. */
  async updatePricing(
    id: string,
    pricing: {
      levelCost?: number | null;
      gradedCost?: number | null;
      modifiedCost?: number | null;
      giCost?: number | null;
      minimumPremium?: number | null;
    },
  ): Promise<AppUser> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ user: AppUser }>>(`${BASE}/${id}/pricing`, pricing),
    );
    return res.data.user;
  }

  /** CLIENT accounts only — editing licensed states / carrier roster / online-bank-payment
   * acceptance after creation. */
  async updateCoverage(
    id: string,
    coverage: { states?: string[]; carriers?: string[]; acceptsOnlineBankPayment?: boolean },
  ): Promise<AppUser> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ user: AppUser }>>(`${BASE}/${id}/coverage`, coverage),
    );
    return res.data.user;
  }

  /** CLIENT accounts only — editing which roster carriers apply in one licensed state. */
  async updateStateCarriers(id: string, state: string, carriers: string[]): Promise<AppUser> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ user: AppUser }>>(`${BASE}/${id}/state-carriers`, { state, carriers }),
    );
    return res.data.user;
  }

  async updateRole(id: string, role: Role): Promise<AppUser> {
    const res = await firstValueFrom(this.http.patch<ApiSuccess<{ user: AppUser }>>(`${BASE}/${id}/role`, { role }));
    return res.data.user;
  }

  /** No self-service "forgot password" flow — this is how a locked-out account recovers. */
  async resetPassword(id: string, newPassword: string): Promise<AppUser> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ user: AppUser }>>(`${BASE}/${id}/reset-password`, { newPassword })
    );
    return res.data.user;
  }
}
