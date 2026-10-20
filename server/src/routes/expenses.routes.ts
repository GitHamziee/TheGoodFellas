import { Router } from 'express';
import { apiSuccess, sendResult } from '../lib/api-response';
import { asyncHandler } from '../lib/async-handler';
import { authenticate, requireRole } from '../middleware/auth';
import * as expenseService from '../services/expense.service';

const router = Router();
router.use(authenticate);
router.use(requireRole('ADMIN'));

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const expenses = await expenseService.listExpenses();
    return apiSuccess(res, { expenses });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const result = await expenseService.createExpense(req.body ?? {});
    return sendResult(res, result, 'Expense added', 201);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await expenseService.deleteExpense(req.params.id);
    return sendResult(res, result, 'Expense deleted');
  })
);

// Read-only here — the write path is PATCH /api/leads/batch-payment (marking leads
// paid is a lead-state transition, so it lives in leads.routes.ts), this just surfaces
// the resulting records for the Expenses page's income-vs-expense view.
router.get(
  '/income',
  asyncHandler(async (_req, res) => {
    const income = await expenseService.listIncome();
    return apiSuccess(res, { income });
  })
);

export default router;
