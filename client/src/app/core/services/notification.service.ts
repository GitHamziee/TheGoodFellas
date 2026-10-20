import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../config';
import { AppNotification } from '../models/notification.model';
import { AuthService } from './auth.service';
import { LiveUpdatesService } from './live-updates.service';

const BASE = `${API_BASE_URL}/notifications`;
const MAX_TOASTS = 4;
export const TOAST_MS = 7000;

/**
 * Owns the notification inbox and the on-screen toast stack. Persisted notifications come from
 * REST (so anything missed while offline is still in the bell); live ones arrive over the shared
 * LiveUpdates socket and are shown as a toast. Everything is a signal — the app is zoneless.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly live = inject(LiveUpdatesService);

  private readonly _items = signal<AppNotification[]>([]);
  private readonly _toasts = signal<AppNotification[]>([]);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  readonly items = this._items.asReadonly();
  readonly toasts = this._toasts.asReadonly();
  readonly unread = computed(() => this._items().filter((n) => !n.read).length);

  constructor() {
    effect(() => {
      if (this.auth.user()) void this.load();
      else this.reset();
    });
    this.live.notifications$.subscribe((n) => this.receive(n as AppNotification));
  }

  private async load(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ data: { items: AppNotification[] } }>(BASE),
      );
      this._items.set(res.data.items);
    } catch {
      // The bell just stays empty; live pushes still work.
    }
  }

  private reset(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    this._items.set([]);
    this._toasts.set([]);
  }

  private receive(n: AppNotification): void {
    const incoming = { ...n, read: false };
    this._items.update((list) => [incoming, ...list.filter((x) => x.id !== n.id)].slice(0, 50));
    this._toasts.update((list) => [incoming, ...list.filter((x) => x.id !== n.id)].slice(0, MAX_TOASTS));
    this.armTimer(n.id);
  }

  /** Toast only — never added to the bell or persisted. For things like chat messages that
   * already have their own unread badge. */
  showToast(n: Omit<AppNotification, 'read'>): void {
    this._toasts.update((list) => [{ ...n, read: true }, ...list.filter((x) => x.id !== n.id)].slice(0, MAX_TOASTS));
    this.armTimer(n.id);
  }

  private armTimer(id: string): void {
    this.clearTimer(id);
    this.timers.set(id, setTimeout(() => this.dismissToast(id), TOAST_MS));
  }

  private clearTimer(id: string): void {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
  }

  /** Hovering a toast keeps it on screen. */
  pauseToast(id: string): void {
    this.clearTimer(id);
  }

  resumeToast(id: string): void {
    if (this._toasts().some((t) => t.id === id)) this.armTimer(id);
  }

  dismissToast(id: string): void {
    this.clearTimer(id);
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }

  /** Opens the notification's page and marks it read. */
  open(n: AppNotification): void {
    this.dismissToast(n.id);
    // Toast-only notifications aren't in the inbox and have no server row to mark.
    if (this._items().some((x) => x.id === n.id)) void this.markRead(n);
    if (n.link) void this.router.navigateByUrl(n.link);
  }

  async markRead(n: AppNotification): Promise<void> {
    if (n.read) return;
    this._items.update((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    try {
      await firstValueFrom(this.http.patch(`${BASE}/${n.id}/read`, {}));
    } catch {
      /* optimistic; next load reconciles */
    }
  }

  async markAllRead(): Promise<void> {
    this._items.update((list) => list.map((x) => ({ ...x, read: true })));
    this._toasts.set([]);
    try {
      await firstValueFrom(this.http.patch(`${BASE}/read-all`, {}));
    } catch {
      /* optimistic */
    }
  }
}
