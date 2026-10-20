import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideArrowUpRight, LucideCrown } from '@lucide/angular';
import { getInitials } from '../../core/format-utils';

export interface LeaderboardRow {
  id: string;
  name: string;
  /** Small line under the name, e.g. "5 of 8 approved". */
  sub: string;
  /** Headline figure, e.g. "63" or "8". */
  value: string;
  /** Suffix after the figure, e.g. "%" or "leads". */
  unit: string;
  /** 0–100 fill of the ring around the avatar. */
  pct: number;
}

export interface LeaderboardData {
  title: string;
  tag: string;
  link: string;
  rows: LeaderboardRow[];
}

interface Tally {
  id: string;
  name: string;
  total: number;
  accepted: number;
  rate?: number;
}

const TOP = 3;

/**
 * Turns already-sorted per-person tallies into a board's top three.
 * `rate` boards fill the ring with the approval rate; `volume` boards fill it relative to the
 * busiest person, so the leader's ring is always full.
 */
export function buildLeaderboard(
  title: string,
  tag: string,
  link: string,
  rows: Tally[],
  kind: 'rate' | 'volume',
): LeaderboardData {
  const top = rows.slice(0, TOP);
  const max = Math.max(1, ...top.map((r) => r.total));
  return {
    title,
    tag,
    link,
    rows: top.map((r) =>
      kind === 'rate'
        ? {
            id: r.id,
            name: r.name,
            sub: `${r.accepted} of ${r.total} approved`,
            value: String(r.rate ?? 0),
            unit: '%',
            pct: r.rate ?? 0,
          }
        : {
            id: r.id,
            name: r.name,
            sub: `${r.accepted} approved`,
            value: String(r.total),
            unit: r.total === 1 ? 'lead' : 'leads',
            pct: Math.round((r.total / max) * 100),
          },
    ),
  };
}

/** Pastel ranking card — top three, a progress ring on each avatar. Styles: `.arena` / `.rung` in shared-page.css. */
@Component({
  selector: 'app-leaderboard',
  imports: [RouterLink, LucideArrowUpRight, LucideCrown],
  template: `
    <section class="arena" [class.arena--junior]="tone() === 'junior'">
      <header class="arena__head">
        <div class="arena__titles">
          <h2 class="arena__title">{{ board().title }}</h2>
          <span class="arena__tag">{{ board().tag }}</span>
        </div>
        <a class="arena__link" [routerLink]="board().link" aria-label="Full breakdown">
          <svg lucideArrowUpRight></svg>
        </a>
      </header>

      @if (board().rows.length === 0) {
        <p class="arena__empty">No activity in this period yet.</p>
      } @else {
        <ol class="arena__list">
          @for (row of board().rows; track row.id; let i = $index) {
            <li class="rung" [class.rung--champ]="i === 0">
              <span class="rung__av" [style.--pct]="row.pct + '%'">
                <span class="rung__face">{{ initials(row.name) }}</span>
                <span class="rung__rank">
                  @if (i === 0) { <svg lucideCrown></svg> } @else { {{ i + 1 }} }
                </span>
              </span>
              <span class="rung__who">
                <span class="rung__name">{{ row.name }}</span>
                <span class="rung__sub">{{ row.sub }}</span>
              </span>
              <span class="rung__val">{{ row.value }}<small>{{ row.unit }}</small></span>
            </li>
          }
        </ol>
      }
    </section>
  `,
})
export class Leaderboard {
  readonly board = input.required<LeaderboardData>();
  /** `closer` boards are lavender, `junior` boards green. */
  readonly tone = input<'closer' | 'junior'>('closer');
  readonly initials = getInitials;
}
