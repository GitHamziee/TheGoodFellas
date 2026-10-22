import { Injectable, effect, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';

const OPEN_KEY = 'tgf.dialerOpen';

/** Per-tab, so a full page reload doesn't hide a dialer the agent left open. */
function readOpen(): boolean {
  try {
    return sessionStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Zoom Phone Smart Embed — the softphone runs inside this iframe, signed in with the agent's
 * own Zoom account. Nothing Zoom-side touches our server. */
export const ZOOM_EMBED_ORIGIN = 'https://applications.zoom.us';
/** `originDomain` tells the embed which parent page may command it. Without it Zoom falls back
 * to document.referrer, which becomes a Zoom page after the in-frame sign-in redirect — from then
 * on every zp-make-call is silently dropped. Must also be in the Smart Embed's Approved Domains. */
export const ZOOM_EMBED_URL =
  `${ZOOM_EMBED_ORIGIN}/integration/phone/embeddablephone/home` +
  `?originDomain=${encodeURIComponent(window.location.origin)}`;

/** US numbers are stored as bare digits; Zoom wants E.164. */
export function toE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/** 'unavailable' = the OS has no mic or won't hand it to the browser (Windows privacy settings). */
export type MicState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unavailable';

/**
 * Root-scoped and stateful, like ChatService: the dialer iframe lives in PortalShell so a call
 * survives page navigation, and any page can ask it to dial. Clicking "Dial lead" sends the
 * number straight into Zoom — it never has to be shown or copied.
 */
@Injectable({ providedIn: 'root' })
export class ZoomPhoneService {
  /** Only the minimize button / topbar toggle closes it — navigation and reloads don't. */
  readonly open = signal(readOpen());
  /**
   * The embed never triggers the browser's mic prompt itself — it enumerates devices, sees none
   * (labels/ids are hidden until permission exists) and shows "No available device". So we ask
   * from the top-level page; the iframe's `allow="microphone"` then inherits the grant.
   */
  readonly mic = signal<MicState>('unknown');

  private frame: HTMLIFrameElement | null = null;
  private loaded = false;
  /** A dial requested before the iframe finished loading — sent once it has. */
  private pending: string | null = null;

  constructor() {
    const auth = inject(AuthService);
    effect(() => {
      if (!auth.user()) this.open.set(false);
    });
    effect(() => {
      const open = this.open();
      try {
        sessionStorage.setItem(OPEN_KEY, open ? '1' : '0');
      } catch {
        /* storage unavailable — the panel still works, it just won't survive a reload */
      }
    });
    void this.watchMicPermission();
  }

  private async watchMicPermission(): Promise<void> {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      const sync = () => this.mic.set(status.state === 'granted' ? 'granted' : status.state === 'denied' ? 'denied' : 'prompt');
      sync();
      status.onchange = sync;
    } catch {
      this.mic.set('prompt'); // Permissions API can't query mic here — let the button try
    }
  }

  /** Shows the browser's mic prompt, then reloads the embed so Zoom re-reads the device list. */
  async enableMic(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      this.mic.set('granted');
      this.reloadFrame();
    } catch (err) {
      const name = (err as DOMException)?.name;
      this.mic.set(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
    }
  }

  private reloadFrame(): void {
    if (!this.frame) return;
    this.loaded = false;
    this.frame.src = ZOOM_EMBED_URL;
  }

  attach(frame: HTMLIFrameElement): void {
    this.frame = frame;
  }

  detach(): void {
    this.frame = null;
    this.loaded = false;
  }

  onFrameLoad(): void {
    this.loaded = true;
    if (this.pending) {
      this.send(this.pending);
      this.pending = null;
    }
  }

  toggle(): void {
    this.open.update((v) => !v);
  }

  /** Opens the dialer and places the call. Returns false if the number isn't dialable. */
  dial(phone: string | null | undefined): boolean {
    const number = phone ? toE164(phone) : null;
    if (!number) return false;
    this.open.set(true);
    if (this.frame && this.loaded) this.send(number);
    else this.pending = number;
    return true;
  }

  private send(number: string): void {
    this.frame?.contentWindow?.postMessage(
      { type: 'zp-make-call', data: { number, autoDial: true } },
      ZOOM_EMBED_ORIGIN,
    );
  }
}
