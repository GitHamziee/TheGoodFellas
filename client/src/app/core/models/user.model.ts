export type Role = 'JUNIOR_CLOSER' | 'CLOSER' | 'ADMIN' | 'CLIENT' | 'TEAM_LEAD';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone?: string | null;
  /** Per-plan lead cost (USD), CLIENT accounts only — null for every other role. */
  levelCost?: number | null;
  gradedCost?: number | null;
  modifiedCost?: number | null;
  giCost?: number | null;
  /** Licensed states + carriers, CLIENT accounts only — empty array for every other role.
   * Feeds the future State Sheet page (state -> clients -> carriers available there). */
  states?: string[];
  carriers?: string[];
}

/** One row of the State Sheet data set — narrower than AppUser, since Closer/Team Lead
 * see this too and shouldn't get email/phone/pricing along with it. */
export interface ClientCoverage {
  id: string;
  name: string;
  states: string[];
  carriers: string[];
}
