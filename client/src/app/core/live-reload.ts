import { effect, inject, untracked } from '@angular/core';
import { LiveUpdatesService } from './services/live-updates.service';

let silent = false;

/** True while a live reload is running — loaders skip their skeleton so the list updates in place. */
export function isSilentReload(): boolean {
  return silent;
}

/**
 * Re-runs `reload` whenever the server reports a change. Call as a field initializer
 * (needs an injection context). The first run is skipped — the page's own load covers it.
 * `reload` must set its `loading` flag only via `if (!isSilentReload())`, since the
 * synchronous part of it runs while the flag is raised.
 */
export function reloadOnChange(reload: () => unknown): void {
  const live = inject(LiveUpdatesService);
  let first = true;
  effect(() => {
    live.version();
    if (first) {
      first = false;
      return;
    }
    untracked(() => {
      silent = true;
      try {
        void reload();
      } finally {
        silent = false;
      }
    });
  });
}
