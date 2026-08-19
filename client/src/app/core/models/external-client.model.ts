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
  createdAt: string;
  updatedAt: string;
}
