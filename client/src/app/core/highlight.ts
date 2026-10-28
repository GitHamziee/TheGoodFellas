import { effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

/**
 * Notifications link to a list page with `?highlight=<leadId>`. Once the page has loaded that
 * lead, `reveal` brings it into view (switch tab, clear filters, go to its page), then the row
 * — which must carry `[id]="'hl-' + lead.id"` and `[class.row-highlight]="lead.id === highlightId()"` —
 * is scrolled to and flashed for a few seconds. Returns the id to flash, or null.
 */
export function highlightFromQuery<T extends { id: string }>(source: () => T[], reveal: (item: T) => void) {
  const query = toSignal(inject(ActivatedRoute).queryParamMap);
  const highlightId = signal<string | null>(null);
  let handled: string | null = null;

  effect(() => {
    const id = query()?.get('highlight') ?? null;
    if (!id) {
      handled = null;
      return;
    }
    const item = source().find((l) => l.id === id);
    if (!item || handled === id) return;
    handled = id;
    untracked(() => {
      reveal(item);
      highlightId.set(id);
      setTimeout(() => document.getElementById('hl-' + id)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 100);
      setTimeout(() => highlightId.set(null), 6000);
    });
  });

  return highlightId;
}
