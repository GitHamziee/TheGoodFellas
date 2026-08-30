import { StateCarriers } from './user.model';

export interface ExternalClient {
  id: string;
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  levelCost?: number | null;
  gradedCost?: number | null;
  modifiedCost?: number | null;
  giCost?: number | null;
  /** Same coverage fields as a CLIENT-role AppUser — see user.model.ts. */
  minimumPremium?: number | null;
  acceptsOnlineBankPayment?: boolean;
  states?: string[];
  carriers?: string[];
  stateCarriers?: StateCarriers[];
  createdAt: string;
  updatedAt: string;
}
