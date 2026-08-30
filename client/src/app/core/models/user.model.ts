import { PlanType } from './lead.model';

export type Role =
  | 'JUNIOR_CLOSER'
  | 'CLOSER'
  | 'ADMIN'
  | 'CLIENT'
  | 'TEAM_LEAD'
  | 'QA_JUNIOR_CLOSER'
  | 'QA_CLOSER'
  | 'RETENTION';

/** Which of a client's roster carriers (AppUser.carriers) apply in one licensed state. */
export interface StateCarriers {
  state: string;
  carriers: string[];
}

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
  /** Lowest monthly premium (USD) this client will accept — CLIENT accounts only. */
  minimumPremium?: number | null;
  /** Whether this client can take payment via online bank transfer — CLIENT accounts only. */
  acceptsOnlineBankPayment?: boolean;
  /** Licensed states + carrier roster, CLIENT accounts only — empty array for every other
   * role. Feeds the State Sheet page (state -> clients -> carriers available there). */
  states?: string[];
  carriers?: string[];
  /** Which roster carriers apply in each licensed state — CLIENT accounts only. */
  stateCarriers?: StateCarriers[];
}

/** One row of the State Sheet data set — narrower than AppUser, since Closer/Team Lead
 * see this too and shouldn't get email/phone/raw pricing figures along with it. */
export interface ClientCoverage {
  id: string;
  name: string;
  states: string[];
  carriers: string[];
  stateCarriers: StateCarriers[];
  /** Derived from the per-plan cost fields being non-null — see PLAN_TYPE_LABEL. */
  acceptedPlans: PlanType[];
  minimumPremium: number | null;
  acceptsOnlineBankPayment: boolean;
}
