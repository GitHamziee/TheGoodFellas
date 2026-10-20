import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../config';
import { ExternalClient } from '../models/external-client.model';
import type { ApiSuccess } from '../api';

const BASE = `${API_BASE_URL}/external-clients`;

export type ExternalClientInput = {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  notes?: string;
  levelCost?: number | null;
  gradedCost?: number | null;
  modifiedCost?: number | null;
  giCost?: number | null;
  minimumPremium?: number | null;
  acceptsOnlineBankPayment?: boolean;
  states?: string[];
  carriers?: string[];
  stateCarriers?: { state: string; carriers: string[] }[];
};

@Injectable({ providedIn: 'root' })
export class ExternalClientService {
  private readonly http = inject(HttpClient);

  async list(): Promise<ExternalClient[]> {
    const res = await firstValueFrom(
      this.http.get<ApiSuccess<{ externalClients: ExternalClient[] }>>(BASE)
    );
    return res.data.externalClients;
  }

  async create(input: ExternalClientInput): Promise<ExternalClient> {
    const res = await firstValueFrom(
      this.http.post<ApiSuccess<{ externalClient: ExternalClient }>>(BASE, input)
    );
    return res.data.externalClient;
  }

  async update(id: string, input: Partial<ExternalClientInput>): Promise<ExternalClient> {
    const res = await firstValueFrom(
      this.http.patch<ApiSuccess<{ externalClient: ExternalClient }>>(`${BASE}/${id}`, input)
    );
    return res.data.externalClient;
  }
}
