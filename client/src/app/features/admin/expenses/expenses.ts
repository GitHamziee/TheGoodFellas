import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideBanknote,
  LucideCircleCheck,
  LucidePiggyBank,
  LucidePlus,
  LucideReceipt,
  LucideScale,
  LucideTrash2,
  LucideTrendingDown,
} from '@lucide/angular';
import { ExpenseService } from '../../../core/services/expense.service';
import { Expense, IncomePayment } from '../../../core/models/expense.model';
import { formatDate, formatPkr, pluralize, toDateInput } from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import { EmptyState, SkeletonRows, StatTile } from '../../../shared/ui/ui';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';

@Component({
  selector: 'app-admin-expenses',
  imports: [
    FormsModule,
    Modal,
    StatTile,
    EmptyState,
    SkeletonRows,
    LucideBanknote,
    LucideCircleCheck,
    LucidePiggyBank,
    LucidePlus,
    LucideReceipt,
    LucideScale,
    LucideTrash2,
    LucideTrendingDown,
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
  readonly notice = signal<string | null>(null);
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
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not add the expense.');
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
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not delete the expense.');
    } finally {
      this.deletingId.set(null);
    }
  }
}
