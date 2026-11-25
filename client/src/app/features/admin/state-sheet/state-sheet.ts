import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  LucideBanknote,
  LucideBuilding2,
  LucideCheck,
  LucideChevronUp,
  LucideCreditCard,
  LucideLandmark,
  LucideMapPin,
  LucideMinus,
  LucideUsers,
} from '@lucide/angular';
import { UserService } from '../../../core/services/user.service';
import { ClientCoverage } from '../../../core/models/user.model';
import { PlanType } from '../../../core/models/lead.model';
import { US_STATES, stateCode } from '../../../core/us-states';
import { PLAN_TYPE_OPTIONS } from '../../../core/lead-options';
import { formatMoney } from '../../../core/format-utils';
import { PageHero, EmptyState, SearchBox, SkeletonRows, StatTile } from '../../../shared/ui/ui';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';

/** Two-letter avatar text: first letters of the first two words, else the first two letters. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const text = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '').slice(0, 2);
  return text.toUpperCase();
}

/** A carrier in one state; `plans` is null when none have been set for it yet. */
interface CarrierRow {
  name: string;
  initials: string;
  plans: PlanType[] | null;
}

interface ClientBreakdown {
  name: string;
  initials: string;
  carriers: CarrierRow[];
  /** Distinct plans this client takes in the state — from its carriers, else its own plan list. */
  planCount: number;
  /** How many of this client's carriers in the state offer each plan, in `planTypes` order. */
  carriersPerPlan: number[];
  acceptedPlans: PlanType[];
  minimumPremium: number | null;
  maxAge: number | null;
  acceptsOnlineBankPayment: boolean;
  acceptedCards: string[];
}

interface StateRow {
  state: string;
  code: string;
  clients: string[];
  carriers: string[];
  /** Distinct plans offered in the state across every covering client. */
  planCount: number;
  /** Count of covering clients that accept online bank payments — drives the filter pill. */
  onlineBankClients: number;
  /** One entry per covering client — the panel's client sidebar and its detail. */
  breakdown: ClientBreakdown[];
}

/** Mounted at /admin/state-sheet, /manager/state-sheet, /closer/state-sheet,
 * /team-lead/state-sheet and /retention/state-sheet — one component shared across roles,
 * the same way analytics-junior/analytics-closer are. Read-only: editing coverage happens
 * on the admin Users page. */
@Component({
  selector: 'app-state-sheet',
  imports: [
    PageHero,
    SearchBox,
    StatTile,
    EmptyState,
    SkeletonRows,
    LucideMapPin,
    LucideBuilding2,
    LucideUsers,
    LucideChevronUp,
    LucideBanknote,
    LucideCheck,
    LucideMinus,
    LucideLandmark,
    LucideCreditCard,
  ],
  templateUrl: './state-sheet.html',
  styleUrl: './state-sheet.css',
})
export class StateSheet implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly userService = inject(UserService);

  readonly clients = signal<ClientCoverage[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly search = signal('');
  /** When on, states nobody covers yet are hidden. */
  readonly coveredOnly = signal(false);
  /** When on, states with no client accepting online bank payments are hidden. */
  readonly onlineBankOnly = signal(false);
  /** Which state's panel is open — one at a time. */
  readonly expanded = signal<string | null>(null);
  /** Which client is picked in each open panel's sidebar, keyed by state. */
  private readonly pickedClient = signal<Record<string, string>>({});

  readonly planTypes = PLAN_TYPE_OPTIONS;
  readonly formatMoney = formatMoney;
  readonly cardLabels: Record<string, string> = {
    DIRECT_EXPRESS: 'Direct Express',
    DEBIT_CARD: 'Debit Card',
    CREDIT_CARD: 'Credit Card',
  };

  /** One row per US state, regardless of coverage — this is a reference sheet, so a gap
   * (no client covering a state) is as useful to see as a match. */
  readonly rows = computed<StateRow[]>(() => {
    const clients = this.clients();
    return US_STATES.map((state) => {
      const covering = clients.filter((c) => c.states.includes(state));
      const breakdown: ClientBreakdown[] = covering.map((c) => {
        // Which of this client's roster carriers apply in *this* state — not their whole
        // roster, which can differ state to state (e.g. NRG in Alaska, MPG in Alabama).
        const carriers: CarrierRow[] = [...(c.stateCarriers.find((sc) => sc.state === state)?.carriers ?? [])]
          .sort((x, y) => x.localeCompare(y))
          .map((name) => ({
            name,
            initials: initials(name),
            plans: c.statePlans?.find((p) => p.state === state && p.carrier === name)?.plans ?? null,
          }));
        const fromCarriers = new Set(carriers.flatMap((r) => r.plans ?? []));
        return {
          name: c.name,
          initials: initials(c.name),
          carriers,
          planCount: fromCarriers.size || c.acceptedPlans.length,
          carriersPerPlan: this.planTypes.map((p) => carriers.filter((r) => r.plans?.includes(p.value)).length),
          acceptedPlans: c.acceptedPlans,
          minimumPremium: c.minimumPremium,
          maxAge: c.maxAge,
          acceptsOnlineBankPayment: c.acceptsOnlineBankPayment,
          acceptedCards: c.acceptedCards ?? [],
        };
      });
      const allPlans = new Set(
        breakdown.flatMap((b) => {
          const own = b.carriers.flatMap((r) => r.plans ?? []);
          return own.length ? own : b.acceptedPlans;
        }),
      );
      return {
        state,
        code: stateCode(state),
        clients: covering.map((c) => c.name),
        carriers: [...new Set(breakdown.flatMap((b) => b.carriers.map((r) => r.name)))].sort(),
        planCount: allPlans.size,
        onlineBankClients: breakdown.filter((b) => b.acceptsOnlineBankPayment).length,
        breakdown,
      };
    });
  });

  toggle(state: string): void {
    this.expanded.set(this.expanded() === state ? null : state);
  }

  /** The client shown in a state's panel: the one picked in its sidebar, else the first. */
  activeClient(row: StateRow): ClientBreakdown | null {
    const name = this.pickedClient()[row.state];
    return row.breakdown.find((b) => b.name === name) ?? row.breakdown[0] ?? null;
  }

  pickClient(state: string, name: string): void {
    this.pickedClient.update((m) => ({ ...m, [state]: name }));
  }

  cardLabel(card: string): string {
    return this.cardLabels[card] || card;
  }

  /** "2 of 4" style count for one carrier row; null while its plans haven't been set. */
  offeredCount(carrier: CarrierRow): string {
    return carrier.plans ? `${carrier.plans.length} of ${this.planTypes.length}` : 'Not set';
  }

  readonly filteredRows = computed<StateRow[]>(() => {
    let rows = this.rows();
    if (this.coveredOnly()) rows = rows.filter((r) => r.clients.length > 0);
    if (this.onlineBankOnly()) rows = rows.filter((r) => r.onlineBankClients > 0);

    const q = this.search().trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.state.toLowerCase().includes(q) ||
        r.clients.some((c) => c.toLowerCase().includes(q)) ||
        r.carriers.some((c) => c.toLowerCase().includes(q)),
    );
  });

  readonly stats = computed(() => {
    const rows = this.rows();
    const covered = rows.filter((r) => r.clients.length > 0);
    const allCarriers = new Set(rows.flatMap((r) => r.carriers));
    const onlineBankClients = this.clients().filter((c) => c.acceptsOnlineBankPayment).length;
    return {
      statesCovered: covered.length,
      totalStates: rows.length,
      clients: this.clients().length,
      carriers: allCarriers.size,
      onlineBankClients,
    };
  });

  async ngOnInit(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      this.clients.set(await this.userService.getStateSheet());
    } catch {
      this.error.set('Could not load the state sheet. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
