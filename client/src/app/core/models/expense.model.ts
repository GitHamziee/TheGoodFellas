export interface Expense {
  id: string;
  description: string;
  amount: number;
  date: string;
  createdAt: string;
}

/** One PKR payment received against a batch of leads marked paid together. */
export interface IncomePayment {
  id: string;
  pkrAmount: number;
  note?: string | null;
  createdAt: string;
  leads: { id: string; customerName: string }[];
}
