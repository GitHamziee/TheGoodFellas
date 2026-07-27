import { AccountType, IncomeSource, LeadNeed, PayerType, RetiredIncomeType } from './models/lead.model';

export const NEED_OPTIONS: { value: LeadNeed; label: string }[] = [
  { value: 'BURIAL', label: 'Burial' },
  { value: 'CREMATION', label: 'Cremation' },
  { value: 'LEAVE_MONEY', label: 'Leave money' },
];

export const INCOME_SOURCE_OPTIONS: { value: IncomeSource; label: string }[] = [
  { value: 'EMPLOYED', label: 'Employed' },
  { value: 'SELF_EMPLOYED', label: 'Self employed' },
  { value: 'RETIRED', label: 'Retired' },
];

export const RETIRED_INCOME_OPTIONS: { value: RetiredIncomeType; label: string }[] = [
  { value: 'SSI', label: 'SSI' },
  { value: 'SSDI', label: 'SSDI' },
];

export const ACCOUNT_TYPE_OPTIONS: { value: AccountType; label: string }[] = [
  { value: 'CHECKING', label: 'Checking' },
  { value: 'SAVINGS', label: 'Savings' },
];

export const PAYER_OPTIONS: { value: PayerType; label: string }[] = [
  { value: 'SELF', label: 'Self' },
  { value: 'SOMEONE_ELSE', label: 'Someone else' },
];
