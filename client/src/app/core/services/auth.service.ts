import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../config';
import { AppUser, Role } from '../models/user.model';

const TOKEN_KEY = 'tgf_token';
const USER_KEY = 'tgf_user';

interface AuthResponse {
  data: { token: string; user: AppUser };
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly _user = signal<AppUser | null>(this.readStoredUser());
  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);
  readonly role = computed<Role | null>(() => this._user()?.role ?? null);

  private readStoredUser(): AppUser | null {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AppUser) : null;
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  private persistSession(token: string, user: AppUser) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    this._user.set(user);
  }

  async login(email: string, password: string): Promise<AppUser> {
    const res = await firstValueFrom(this.http.post<AuthResponse>(`${API_BASE_URL}/auth/login`, { email, password }));
    this.persistSession(res.data.token, res.data.user);
    return res.data.user;
  }

  /** Bumps tokenVersion server-side, invalidating the current session — caller should log out after. */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await firstValueFrom(
      this.http.post<{ data: unknown; message?: string }>(`${API_BASE_URL}/auth/change-password`, { currentPassword, newPassword })
    );
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this._user.set(null);
    this.router.navigateByUrl('/login');
  }

  /** Where a logged-in user's home dashboard lives, keyed by role. */
  homeFor(role: Role): string {
    switch (role) {
      case 'JUNIOR_CLOSER':
        return '/junior/dashboard';
      case 'CLOSER':
        return '/closer/dashboard';
      case 'ADMIN':
        return '/admin/dashboard';
      case 'CLIENT':
        return '/client/dashboard';
      case 'TEAM_LEAD':
        return '/team-lead/dashboard';
      case 'QA_JUNIOR_CLOSER':
        return '/qa-junior/review-queue';
      case 'QA_CLOSER':
        return '/qa-closer/review-queue';
      case 'RETENTION':
        return '/retention/leads';
      case 'MANAGER':
        return '/manager/dashboard';
      case 'RETENTION_MANAGER':
        return '/retention-manager/queue';
    }
  }
}
