import prisma from '../lib/prisma';
import { isNonEmptyString } from '../lib/validation';
import type { ServiceResult } from '../lib/service-result';


const EXPENSE_SELECT = {
  id: true,
  description: true,
  amount: true,
  date: true,
  createdAt: true,
} as const;

const INCOME_SELECT = {
  id: true,
  pkrAmount: true,
  note: true,
  createdAt: true,
  leads: { select: { id: true, customerName: true } },
} as const;

export async function listExpenses() {
  return prisma.expense.findMany({ select: EXPENSE_SELECT, orderBy: { date: 'desc' } });
}

export async function createExpense(input: {
  description?: unknown;
  amount?: unknown;
  date?: unknown;
}): Promise<ServiceResult<{ expense: unknown }>> {
  const { description, amount, date } = input;

  if (!isNonEmptyString(description)) return { error: 'Description is required', status: 400 };

  const amountNum = typeof amount === 'number' ? amount : typeof amount === 'string' ? Number(amount) : NaN;
  if (!Number.isFinite(amountNum) || amountNum <= 0) return { error: 'Enter a valid PKR amount', status: 400 };

  let parsedDate = new Date();
  if (date !== undefined && date !== null && date !== '') {
    parsedDate = new Date(date as string);
    if (Number.isNaN(parsedDate.getTime())) return { error: 'Invalid date', status: 400 };
  }

  const expense = await prisma.expense.create({
    data: { description: description.trim(), amount: Math.trunc(amountNum), date: parsedDate },
    select: EXPENSE_SELECT,
  });

  return { data: { expense } };
}

export async function deleteExpense(id: string): Promise<ServiceResult<{ id: string }>> {
  const existing = await prisma.expense.findUnique({ where: { id } });
  if (!existing) return { error: 'Expense not found', status: 404 };

  await prisma.expense.delete({ where: { id } });
  return { data: { id } };
}

/** Batch PKR payments recorded via the admin Leads page's "Mark Paid" action. */
export async function listIncome() {
  return prisma.incomePayment.findMany({ select: INCOME_SELECT, orderBy: { createdAt: 'desc' } });
}
