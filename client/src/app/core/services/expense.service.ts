import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../config';
import { Expense, IncomePayment } from '../models/expense.model';
import type { ApiSuccess } from '../api';

const BASE = `${API_BASE_URL}/expenses`;

export type ExpenseInput = {
  description: string;
  amount: number;
  date?: string;
};

@Injectable({ providedIn: 'root' })
export class ExpenseService {
  private readonly http = inject(HttpClient);

  async list(): Promise<Expense[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ expenses: Expense[] }>>(BASE));
    return res.data.expenses;
  }

  async create(input: ExpenseInput): Promise<Expense> {
    const res = await firstValueFrom(this.http.post<ApiSuccess<{ expense: Expense }>>(BASE, input));
    return res.data.expense;
  }

  async delete(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<ApiSuccess<{ id: string }>>(`${BASE}/${id}`));
  }

  /** Batch PKR payments recorded via the admin Leads page's "Mark Paid" action. */
  async income(): Promise<IncomePayment[]> {
    const res = await firstValueFrom(this.http.get<ApiSuccess<{ income: IncomePayment[] }>>(`${BASE}/income`));
    return res.data.income;
  }
}
