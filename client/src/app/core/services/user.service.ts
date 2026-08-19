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

  /** For the admin's "assign to client" dropdown. */
  async listClients(): Promise<LookupUser[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ clients: LookupUser[] }>>(`${BASE}/clients`));
    return res.data.clients;
  }

  /** For the State Sheet — visible to Closer/Team Lead/Admin, narrower than listUsers(). */
  async getStateSheet(): Promise<ClientCoverage[]> {
    const res = await firstValueFrom(
      this.http.get<ApiSuccess<{ clients: ClientCoverage[] }>>(`${BASE}/state-sheet`),
    );
    return res.data.clients;
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
    states?: string[];
    carriers?: string[];
  }): Promise<AppUser> {
    const res = await firstValueFrom(this.http.post<ApiSuccess<{ user: AppUser }>>(BASE, input));
    return res.data.user;
  }

  /** CLIENT accounts only — editing the per-plan lead cost after creation. */
  async updatePricing(
    id: string,
    pricing: { levelCost?: number | null; gradedCost?: number | null; modifiedCost?: number | null; giCost?: number | null },
  ): Promise<AppUser> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ user: AppUser }>>(`${BASE}/${id}/pricing`, pricing),
    );
    return res.data.user;
  }

  /** CLIENT accounts only — editing licensed states / carriers after creation. */
  async updateCoverage(id: string, coverage: { states?: string[]; carriers?: string[] }): Promise<AppUser> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ user: AppUser }>>(`${BASE}/${id}/coverage`, coverage),
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
