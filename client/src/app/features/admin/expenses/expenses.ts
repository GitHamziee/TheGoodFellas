import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideBanknote,
  LucidePlus,
  LucideReceipt,
  LucideScale,
  LucideTrash2,
} from '@lucide/angular';
import { ExpenseService } from '../../../core/services/expense.service';
import { Expense, IncomePayment } from '../../../core/models/expense.model';
import { APP_TIME_ZONE, formatDate, formatPkr, pacificParts, pluralize, toDateInput } from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import { EmptyState, SearchBox, SkeletonRows } from '../../../shared/ui/ui';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';
import { DateInput } from '../../../shared/ui/date-input';
import { apiErrorMessage } from '../../../core/api';
import { toastNotice } from '../../../core/toast-notice';

/** Months shown in the header's income-vs-expenses chart. */
const MONTHS = 6;

/** One line of the ledger — an expense or an income payment, normalised so they share a timeline. */
interface LedgerRow {
  id: string;
  kind: 'in' | 'out';
  title: string;
  sub: string;
  note: string | null;
  amount: number;
  /** Day of month + short weekday — the month is already in the group header. */
  day: string;
  dow: string;  /** Sort key, epoch ms. */
  at: number;
  /** yyyy-MM month bucket — same rules as the header chart. */
  month: string;
  /** Set on expense rows only, so the row can offer Delete. */
  expense: Expense | null;
}

/** Expense dates are calendar dates stored as UTC midnight; income is a real timestamp shown in Pacific. */
function dayParts(iso: string, timeZone: string): { day: string; dow: string } {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString('en-US', { day: 'numeric', timeZone }),
    dow: d.toLocaleDateString('en-US', { weekday: 'short', timeZone }),
  };
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

@Component({
  selector: 'app-admin-expenses',
  imports: [
    DateInput,
    FormsModule,
    Modal,
    EmptyState,
    SearchBox,
    SkeletonRows,
    LucideBanknote,
    LucidePlus,
    LucideReceipt,
    LucideScale,
    LucideTrash2,
  ],
  templateUrl: './expenses.html',
})
export class AdminExpenses implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.refresh());
  private readonly expenseService = inject(ExpenseService);

  readonly expenses = signal<Expense[]>([]);
  readonly income = signal<IncomePayment[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = toastNotice();
  readonly creating = signal(false);
  readonly deletingId = signal<string | null>(null);
  readonly showCreate = signal(false);

  readonly formatDate = formatDate;
  readonly formatPkr = formatPkr;
  readonly pluralize = pluralize;

  description = '';
  amount: number | null = null;
  date = toDateInput(new Date().toISOString());

  /** A plain method, not computed() — description/amount are ngModel-bound plain fields,
   * not signals, so a computed() here would never see them change after its first read. */
  canSubmitCreate(): boolean {
    return this.description.trim() !== '' && !!this.amount && this.amount > 0;
  }

  readonly totals = computed(() => {
    const expenseTotal = this.expenses().reduce((sum, e) => sum + e.amount, 0);
    const incomeTotal = this.income().reduce((sum, i) => sum + i.pkrAmount, 0);
    return { expenseTotal, incomeTotal, net: incomeTotal - expenseTotal };
  });

  /**
   * Last 6 months of income vs expenses, oldest first. Expense `date` is a calendar date stored
   * as UTC midnight, so its month is read straight off the ISO string; income `createdAt` is a
   * real timestamp, so it is bucketed by Pacific month like the rest of the app.
   */
  readonly months = computed(() => {
    const now = pacificParts();
    const keys = Array.from({ length: MONTHS }, (_, i) => {
      const d = new Date(Date.UTC(now.year, now.month - 1 - (MONTHS - 1 - i), 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    });
    const rows = keys.map((key) => ({ key, income: 0, expense: 0 }));
    const at = new Map(rows.map((r) => [r.key, r]));
    for (const e of this.expenses()) {
      const row = at.get(e.date.slice(0, 7));
      if (row) row.expense += e.amount;
    }
    for (const p of this.income()) {
      const { year, month } = pacificParts(p.createdAt);
      const row = at.get(`${year}-${String(month).padStart(2, '0')}`);
      if (row) row.income += p.pkrAmount;
    }
    const max = Math.max(1, ...rows.flatMap((r) => [r.income, r.expense]));
    return rows.map((r) => {
      const [y, m] = r.key.split('-').map(Number);
      const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
      return {
        ...r,
        net: r.income - r.expense,
        label,
        longLabel: new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }),
        incomePct: (r.income / max) * 100,
        expensePct: (r.expense / max) * 100,
      };
    });
  });

  /** This month vs last month — the numbers the header leads with. */
  readonly thisMonth = computed(() => {
    const m = this.months();
    const [cur, prev] = [m[m.length - 1], m[m.length - 2]];
    return {
      ...cur,
      prevLabel: prev.longLabel,
      netDelta: this.delta(cur.net - prev.net, true),
      incomeDelta: this.delta(cur.income - prev.income, true),
      expenseDelta: this.delta(cur.expense - prev.expense, false),
    };
  });

  readonly kind = signal<'all' | 'in' | 'out'>('all');
  readonly search = signal('');

  /** Expenses and income on one timeline, newest first, grouped by month with in/out subtotals. */
  readonly ledger = computed(() => {
    const kind = this.kind();
    const q = this.search().trim().toLowerCase();
    const rows: LedgerRow[] = [
      ...this.expenses().map((e) => ({
        id: `e-${e.id}`,
        kind: 'out' as const,
        title: e.description,
        sub: 'Expense',
        note: null,
        amount: e.amount,
        ...dayParts(e.date, 'UTC'),
        at: new Date(e.date).getTime(),
        month: e.date.slice(0, 7),
        expense: e,
      })),
      ...this.income().map((p) => {
        const { year, month } = pacificParts(p.createdAt);
        const n = p.leads.length;
        const note = p.note?.trim() || null;
        return {
          id: `i-${p.id}`,
          kind: 'in' as const,
          // The customer is what tells payments apart, so it leads; "Lead payment" is the same on every row.
          title: n === 0 ? 'Lead payment' : p.leads.map((l) => l.customerName).join(', '),
          sub:
            n === 0
              ? (note ?? 'No lead linked')
              : [n > 1 ? `Lead payment · ${n} leads` : 'Lead payment', note].filter(Boolean).join(' · '),
          note,
          amount: p.pkrAmount,
          ...dayParts(p.createdAt, APP_TIME_ZONE),
          at: new Date(p.createdAt).getTime(),
          month: monthKey(year, month),
          expense: null,
        };
      }),
    ]
      .filter((r) => kind === 'all' || r.kind === kind)
      .filter((r) => !q || [r.title, r.sub, r.note].some((s) => s?.toLowerCase().includes(q)))
      .sort((a, b) => b.at - a.at);

    const groups = new Map<string, { key: string; label: string; income: number; expense: number; rows: LedgerRow[] }>();
    for (const r of rows) {
      let g = groups.get(r.month);
      if (!g) {
        const [y, m] = r.month.split('-').map(Number);
        const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        });
        g = { key: r.month, label, income: 0, expense: 0, rows: [] };
        groups.set(r.month, g);
      }
      g.rows.push(r);
      if (r.kind === 'in') g.income += r.amount;
      else g.expense += r.amount;
    }
    return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));
  });

  /** ▲/▼ PKR change; `upIsGood` false for expenses. */
  private delta(d: number, upIsGood: boolean): { text: string; cls: string } {
    if (d === 0) return { text: 'No change', cls: 'mh-delta' };
    const good = d > 0 === upIsGood;
    return {
      text: `${d > 0 ? '▲' : '▼'} ${formatPkr(Math.abs(d))}`,
      cls: good ? 'mh-delta mh-delta--good' : 'mh-delta mh-delta--bad',
    };
  }

  signedPkr(n: number): string {
    return `${n < 0 ? '−' : '+'}${formatPkr(Math.abs(n))}`;
  }

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      const [expenses, income] = await Promise.all([this.expenseService.list(), this.expenseService.income()]);
      this.expenses.set(expenses);
      this.income.set(income);
    } catch {
      this.error.set('Could not load expenses. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  openCreate(): void {
    this.error.set(null);
    this.description = '';
    this.amount = null;
    this.date = toDateInput(new Date().toISOString());
    this.showCreate.set(true);
  }

  async createExpense(): Promise<void> {
    if (!this.canSubmitCreate()) return;

    this.error.set(null);
    this.creating.set(true);
    try {
      const created = await this.expenseService.create({
        description: this.description.trim(),
        amount: this.amount!,
        date: this.date || undefined,
      });
      this.expenses.update((rows) => [created, ...rows]);
      this.showCreate.set(false);
      this.notice.set(`Added "${created.description}".`);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not add the expense.'));
    } finally {
      this.creating.set(false);
    }
  }

  async deleteExpense(expense: Expense): Promise<void> {
    this.error.set(null);
    this.deletingId.set(expense.id);
    try {
      await this.expenseService.delete(expense.id);
      this.expenses.update((rows) => rows.filter((e) => e.id !== expense.id));
      this.notice.set(`Removed "${expense.description}".`);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not delete the expense.'));
    } finally {
      this.deletingId.set(null);
    }
  }
}
