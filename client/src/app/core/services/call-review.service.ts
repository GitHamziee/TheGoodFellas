import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../config';
import { CallLeadRef, CallReview } from '../models/review.model';
import type { ApiSuccess } from '../api';

const BASE = `${API_BASE_URL}/call-reviews`;

@Injectable({ providedIn: 'root' })
export class CallReviewService {
  private readonly http = inject(HttpClient);

  /** Flags something wrong on a live call with a Junior Closer or Closer, optionally
   *  attaching the lead the call was about. There is no "pass" option; a call with nothing
   *  wrong does not get logged. */
  async submit(revieweeId: string, comment: string, leadId?: string | null): Promise<CallReview> {
    const res = await firstValueFrom(
      this.http.post<ApiSuccess<{ review: CallReview }>>(BASE, { revieweeId, comment, leadId: leadId || undefined })
    );
    return res.data.review;
  }

  /** Recent leads a person worked — feeds the lead picker on the review form. */
  async leadsFor(revieweeId: string): Promise<CallLeadRef[]> {
    const res = await firstValueFrom(
      this.http.get<ApiSuccess<{ leads: CallLeadRef[] }>>(`${BASE}/leads`, { params: { revieweeId } })
    );
    return res.data.leads;
  }

  /** Reviews this QA reviewer has personally written, most recent first. */
  async mine(): Promise<CallReview[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ reviews: CallReview[] }>>(`${BASE}/mine`));
    return res.data.reviews;
  }
}
