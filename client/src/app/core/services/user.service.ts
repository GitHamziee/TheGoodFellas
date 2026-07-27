import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../config';
import { AppUser, Role } from '../models/user.model';

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

  async listUsers(role?: Role): Promise<AppUser[]> {
    const res = await firstValueFrom(
      this.http.get<ApiSuccess<{ users: AppUser[] }>>(BASE, { params: role ? { role } : {} })
    );
    return res.data.users;
  }

  async createUser(input: { name: string; email: string; password: string; role: Role; phone?: string }): Promise<AppUser> {
    const res = await firstValueFrom(this.http.post<ApiSuccess<{ user: AppUser }>>(BASE, input));
    return res.data.user;
  }

  async updateRole(id: string, role: Role): Promise<AppUser> {
    const res = await firstValueFrom(this.http.patch<ApiSuccess<{ user: AppUser }>>(`${BASE}/${id}/role`, { role }));
    return res.data.user;
  }
}
