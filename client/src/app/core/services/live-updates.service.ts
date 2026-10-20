import { Injectable, effect, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '../config';
import { AuthService } from './auth.service';

const SOCKET_URL = API_BASE_URL.replace(/\/api\/?$/, '');
/** Collapses a burst of writes (batch actions, several users at once) into one refetch. */
const DEBOUNCE_MS = 400;

/**
 * Listens for the server's payload-free `data:changed` nudge and exposes it as a counter signal.
 * Pages never read data from the socket — they just refetch over REST, so masking stays
 * server-side. Socket lifetime follows the session, same as ChatService (a separate socket
 * because CLIENT has no chat but still needs live lists).
 */
@Injectable({ providedIn: 'root' })
export class LiveUpdatesService {
  private readonly auth = inject(AuthService);
  private socket: Socket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private readonly _version = signal(0);
  readonly version = this._version.asReadonly();

  /** Targeted `notification:new` pushes — consumed by NotificationService, which owns the state. */
  readonly notifications$ = new Subject<unknown>();

  constructor() {
    effect(() => {
      if (this.auth.user()) this.connect();
      else this.teardown();
    });
  }

  private connect(): void {
    if (this.socket) return;
    const token = this.auth.getToken();
    if (!token) return;

    const socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket', 'polling'] });
    socket.on('data:changed', () => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this._version.update((v) => v + 1), DEBOUNCE_MS);
    });
    socket.on('notification:new', (n: unknown) => this.notifications$.next(n));
    // After a dropped connection we may have missed nudges — refetch once on reconnect.
    socket.io.on('reconnect', () => this._version.update((v) => v + 1));
    this.socket = socket;
  }

  private teardown(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.socket?.disconnect();
    this.socket = null;
  }
}
