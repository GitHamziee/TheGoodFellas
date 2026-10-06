import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../config';
import { WhitelistedIp } from '../models/ip-whitelist.model';

interface ApiSuccess<T> {
  data: T;
  message?: string;
}

const BASE = `${API_BASE_URL}/admin/whitelisted-ips`;

export type WhitelistedIpInput = {
  ipAddress: string;
  label?: string;
};

@Injectable({ providedIn: 'root' })
export class IpWhitelistService {
  private readonly http = inject(HttpClient);

  async list(): Promise<WhitelistedIp[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ ips: WhitelistedIp[] }>>(BASE));
    return res.data.ips;
  }

  async create(input: WhitelistedIpInput): Promise<WhitelistedIp> {
    const res = await firstValueFrom(this.http.post<ApiSuccess<{ ip: WhitelistedIp }>>(BASE, input));
    return res.data.ip;
  }

  async delete(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<ApiSuccess<{ id: string }>>(`${BASE}/${id}`));
  }

  /** What to whitelist for "this connection" — the raw IP, and a suggested entry (widened to
   * a /64 for IPv6, since the host portion rotates and the raw address would stop matching). */
  async detect(): Promise<{ ip: string; suggested: string }> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ ip: string; suggested: string }>>(`${BASE}/detect`));
    return res.data;
  }
}
