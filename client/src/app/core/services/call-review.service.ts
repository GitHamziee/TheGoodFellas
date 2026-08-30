import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../config';
import { CallReview } from '../models/review.model';

interface ApiSuccess<T> {
  data: T;
  message?: string;
}

const BASE = `${API_BASE_URL}/call-reviews`;

@Injectable({ providedIn: 'root' })
export class CallReviewService {
  private readonly http = inject(HttpClient);

  /** Flags something wrong on a live call with a Junior Closer or Closer — no lead
   *  involved. There's no "pass" option; a call with nothing wrong doesn't get logged. */
  async submit(revieweeId: string, comment: string): Promise<CallReview> {
    const res = await firstValueFrom(
      this.http.post<ApiSuccess<{ review: CallReview }>>(BASE, { revieweeId, comment })
    );
    return res.data.review;
  }

  /** Reviews this QA reviewer has personally written, most recent first. */
  async mine(): Promise<CallReview[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ reviews: CallReview[] }>>(`${BASE}/mine`));
    return res.data.reviews;
  }
}
