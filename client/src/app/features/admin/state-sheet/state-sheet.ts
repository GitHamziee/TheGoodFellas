import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { LucideBuilding2, LucideChevronDown, LucideMapPin, LucideUsers } from '@lucide/angular';
import { UserService } from '../../../core/services/user.service';
import { ClientCoverage } from '../../../core/models/user.model';
import { US_STATES } from '../../../core/us-states';
import { EmptyState, SearchBox, SkeletonRows, StatTile } from '../../../shared/ui/ui';

interface ClientBreakdown {
  name: string;
  carriers: string[];
}

interface StateRow {
  state: string;
  clients: string[];
  carriers: string[];
  /** Per-client carrier list, for the expanded row — pairs each covering client
   * with the carriers *that client* supports here, unlike the flat `carriers`
   * union above which can't tell you who backs which carrier. */
  breakdown: ClientBreakdown[];
}

/** Mounted at /admin/state-sheet, /closer/state-sheet and /team-lead/state-sheet — one
 * component shared across roles, the same way analytics-junior/analytics-closer are.
 * Read-only: editing coverage happens on the admin Users page. */
@Component({
  selector: 'app-state-sheet',
  imports: [
    SearchBox,
    StatTile,
    EmptyState,
    SkeletonRows,
    LucideMapPin,
    LucideBuilding2,
    LucideUsers,
    LucideChevronDown,
  ],
  templateUrl: './state-sheet.html',
})
export class StateSheet implements OnInit {
  private readonly userService = inject(UserService);

  readonly clients = signal<ClientCoverage[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly search = signal('');
  /** When on, states nobody covers yet are hidden. */
  readonly coveredOnly = signal(false);
  /** Which state's row is expanded to show its per-client carrier breakdown — one at a time. */
  readonly expanded = signal<string | null>(null);

  /** One row per US state, regardless of coverage — this is a reference sheet, so a gap
   * (no client covering a state) is as useful to see as a match. */
  readonly rows = computed<StateRow[]>(() => {
    const clients = this.clients();
    return US_STATES.map((state) => {
      const covering = clients.filter((c) => c.states.includes(state));
      return {
        state,
        clients: covering.map((c) => c.name),
        // Carriers aren't tracked per state, only per client — this is the union of
        // carriers across whichever clients cover this state.
        carriers: [...new Set(covering.flatMap((c) => c.carriers))].sort(),
        breakdown: covering.map((c) => ({ name: c.name, carriers: [...c.carriers].sort() })),
      };
    });
  });

  toggle(state: string): void {
    this.expanded.set(this.expanded() === state ? null : state);
  }

  readonly filteredRows = computed<StateRow[]>(() => {
    let rows = this.rows();
    if (this.coveredOnly()) rows = rows.filter((r) => r.clients.length > 0);

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
    return {
      statesCovered: covered.length,
      totalStates: rows.length,
      clients: this.clients().length,
      carriers: allCarriers.size,
    };
  });

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    try {
      this.clients.set(await this.userService.getStateSheet());
    } catch {
      this.error.set('Could not load the state sheet. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
