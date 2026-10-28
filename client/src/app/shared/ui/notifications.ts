import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, signal } from '@angular/core';
import {
  LucideBell,
  LucideCheckCheck,
  LucideCircleAlert,
  LucideCircleCheck,
  LucideCircleX,
  LucideInfo,
  LucideX,
} from '@lucide/angular';
import { AppNotification } from '../../core/models/notification.model';
import { NotificationService, TOAST_MS } from '../../core/services/notification.service';

function relativeTime(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Fixed top-right stack of live toasts. Mounted once in the portal shell. */
@Component({
  selector: 'app-toast-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideCircleCheck, LucideCircleAlert, LucideCircleX, LucideInfo, LucideX],
  template: `
    <div class="toast-stack" aria-live="polite">
      @for (n of notifications.toasts(); track n.id) {
        <div
          class="toast toast--{{ n.kind }}"
          [class.toast--link]="!!n.link"
          role="status"
          (mouseenter)="notifications.pauseToast(n.id)"
          (mouseleave)="notifications.resumeToast(n.id)"
          (click)="notifications.open(n)"
        >
          <div class="toast-icon">
            @switch (n.kind) {
              @case ('success') { <svg lucideCircleCheck></svg> }
              @case ('warning') { <svg lucideCircleAlert></svg> }
              @case ('danger') { <svg lucideCircleX></svg> }
              @default { <svg lucideInfo></svg> }
            }
          </div>
          <div class="toast-body">
            <div class="toast-title">{{ n.title }}</div>
            @if (n.message) {
              <div class="toast-msg">{{ n.message }}</div>
            }
            @if (n.link) {
              <div class="toast-cta">View →</div>
            }
          </div>
          <button
            class="toast-close"
            type="button"
            aria-label="Dismiss"
            (click)="$event.stopPropagation(); notifications.dismissToast(n.id)"
          >
            <svg lucideX></svg>
          </button>
          <div class="toast-bar" [style.animation-duration.ms]="duration"></div>
        </div>
      }
    </div>
  `,
  styles: `
    .toast-stack {
      position: fixed;
      top: 4.5rem;
      right: 1.25rem;
      z-index: 1200;
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
      width: min(380px, calc(100vw / var(--ui-zoom) - 2rem));
      pointer-events: none;
    }
    .toast {
      --accent: var(--gold-500);
      position: relative;
      overflow: hidden;
      pointer-events: auto;
      display: flex;
      gap: 0.8rem;
      align-items: flex-start;
      padding: 0.9rem 2.4rem 1rem 0.9rem;
      border-radius: var(--radius-lg);
      background: linear-gradient(160deg, var(--ink-800), var(--ink-950));
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-left: 3px solid var(--accent);
      color: #fff;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.2);
      animation: toast-in 0.38s cubic-bezier(0.2, 0.9, 0.3, 1.15);
      transition: transform 0.15s ease;
    }
    .toast--link { cursor: pointer; }
    .toast--link:hover { transform: translateX(-3px); }
    .toast--success { --accent: #22c55e; }
    .toast--warning { --accent: #f59e0b; }
    .toast--danger { --accent: #ef4444; }
    .toast--info { --accent: var(--gold-500); }
    .toast-icon {
      flex-shrink: 0;
      width: 2.2rem;
      height: 2.2rem;
      border-radius: 0.65rem;
      display: grid;
      place-items: center;
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 16%, transparent);
    }
    .toast-icon svg { width: 18px; height: 18px; }
    .toast-body { min-width: 0; }
    .toast-title { font-weight: 700; font-size: 0.88rem; line-height: 1.25; }
    .toast-msg {
      margin-top: 0.2rem;
      font-size: 0.8rem;
      line-height: 1.4;
      color: rgba(255, 255, 255, 0.72);
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
      overflow-wrap: anywhere;
    }
    .toast-cta { margin-top: 0.4rem; font-size: 0.72rem; font-weight: 700; color: var(--accent); letter-spacing: 0.02em; }
    .toast-close {
      position: absolute;
      top: 0.55rem;
      right: 0.55rem;
      width: 1.6rem;
      height: 1.6rem;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: 0.45rem;
      background: transparent;
      color: rgba(255, 255, 255, 0.5);
      cursor: pointer;
    }
    .toast-close:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
    .toast-close svg { width: 14px; height: 14px; }
    .toast-bar {
      position: absolute;
      left: 0;
      bottom: 0;
      height: 3px;
      width: 100%;
      background: var(--accent);
      opacity: 0.8;
      transform-origin: left;
      animation: toast-bar linear forwards;
    }
    .toast:hover .toast-bar { animation-play-state: paused; }
    @keyframes toast-in {
      from { opacity: 0; transform: translateX(110%) scale(0.96); }
      to { opacity: 1; transform: none; }
    }
    @keyframes toast-bar {
      from { transform: scaleX(1); }
      to { transform: scaleX(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .toast { animation: none; }
    }
    @media (max-width: 880px) {
      .toast-stack { top: 3.9rem; right: 1rem; }
    }
  `,
})
export class ToastHost {
  readonly notifications = inject(NotificationService);
  readonly duration = TOAST_MS;
}

/** Topbar bell with unread badge and a dropdown inbox of recent notifications. */
@Component({
  selector: 'app-notification-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideBell, LucideCheckCheck, LucideCircleAlert, LucideCircleCheck, LucideCircleX, LucideInfo],
  template: `
    <button class="bell" type="button" aria-label="Notifications" [attr.aria-expanded]="open()" (click)="toggle()">
      <svg lucideBell></svg>
      @if (notifications.unread() > 0) {
        <span class="bell-badge">{{ badge() }}</span>
      }
    </button>

    @if (open()) {
      <div class="panel" role="dialog" aria-label="Notifications">
        <div class="panel-head">
          <span class="panel-title">Notifications</span>
          <button class="mark-all" type="button" [disabled]="notifications.unread() === 0" (click)="notifications.markAllRead()">
            <svg lucideCheckCheck></svg> Mark all read
          </button>
        </div>
        <div class="panel-list">
          @for (n of notifications.items(); track n.id) {
            <button class="item item--{{ n.kind }}" [class.item--unread]="!n.read" type="button" (click)="select(n)">
              <span class="item-icon">
                @switch (n.kind) {
                  @case ('success') { <svg lucideCircleCheck></svg> }
                  @case ('warning') { <svg lucideCircleAlert></svg> }
                  @case ('danger') { <svg lucideCircleX></svg> }
                  @default { <svg lucideInfo></svg> }
                }
              </span>
              <span class="item-body">
                <span class="item-title">{{ n.title }}</span>
                <span class="item-msg">{{ n.message }}</span>
                <span class="item-time">{{ ago(n.createdAt) }}</span>
              </span>
              @if (!n.read) {
                <span class="item-dot"></span>
              }
            </button>
          } @empty {
            <div class="empty">
              <svg lucideBell></svg>
              <div>You are all caught up</div>
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: `
    :host { position: relative; display: inline-block; }
    .bell {
      position: relative;
      width: 2.3rem;
      height: 2.3rem;
      display: grid;
      place-items: center;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--surface);
      color: var(--ink-800);
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
    }
    .bell:hover { border-color: var(--gold-400); background: var(--gold-50); }
    .bell svg { width: 18px; height: 18px; }
    .bell-badge {
      position: absolute;
      top: -6px;
      right: -6px;
      min-width: 1.1rem;
      height: 1.1rem;
      padding: 0 0.3rem;
      border-radius: 999px;
      background: var(--danger-600);
      color: #fff;
      font-size: 0.65rem;
      font-weight: 800;
      display: grid;
      place-items: center;
      border: 2px solid var(--surface);
      box-sizing: content-box;
    }
    .panel {
      position: absolute;
      right: 0;
      top: calc(100% + 0.5rem);
      z-index: 1100;
      width: min(400px, calc(100vw / var(--ui-zoom) - 2rem));
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      overflow: hidden;
    }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.8rem 1rem;
      border-bottom: 1px solid var(--border);
    }
    .panel-title { font-weight: 800; font-size: 0.92rem; }
    .mark-all {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      border: 0;
      background: transparent;
      color: var(--gold-700);
      font-size: 0.75rem;
      font-weight: 700;
      cursor: pointer;
    }
    .mark-all:disabled { opacity: 0.4; cursor: default; }
    .mark-all svg { width: 14px; height: 14px; }
    .panel-list { max-height: min(460px, calc(65vh / var(--ui-zoom))); overflow-y: auto; }
    .item {
      --accent: var(--gold-600);
      width: 100%;
      display: flex;
      gap: 0.75rem;
      align-items: flex-start;
      text-align: left;
      padding: 0.8rem 1rem;
      border: 0;
      border-bottom: 1px solid var(--gray-100);
      background: transparent;
      cursor: pointer;
      font: inherit;
      color: inherit;
    }
    .item:hover { background: var(--surface-muted); }
    .item--unread { background: var(--gold-50); }
    .item--unread:hover { background: var(--gold-100); }
    .item--success { --accent: var(--success-600); }
    .item--warning { --accent: var(--warning-600); }
    .item--danger { --accent: var(--danger-600); }
    .item-icon {
      flex-shrink: 0;
      width: 2rem;
      height: 2rem;
      border-radius: 0.55rem;
      display: grid;
      place-items: center;
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 12%, transparent);
    }
    .item-icon svg { width: 16px; height: 16px; }
    .item-body { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; flex: 1; }
    .item-title { font-weight: 700; font-size: 0.84rem; }
    .item-msg { font-size: 0.78rem; color: var(--gray-600); line-height: 1.4; overflow-wrap: anywhere; }
    .item-time { font-size: 0.7rem; color: var(--text-muted); margin-top: 0.15rem; }
    .item-dot { flex-shrink: 0; width: 8px; height: 8px; margin-top: 0.4rem; border-radius: 50%; background: var(--gold-500); }
    .empty { padding: 2.5rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem; }
    .empty svg { width: 28px; height: 28px; margin-bottom: 0.5rem; opacity: 0.5; }
  `,
})
export class NotificationBell {
  readonly notifications = inject(NotificationService);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly open = signal(false);
  readonly badge = computed(() => (this.notifications.unread() > 9 ? '9+' : String(this.notifications.unread())));

  toggle(): void {
    this.open.update((v) => !v);
  }

  select(n: AppNotification): void {
    this.open.set(false);
    this.notifications.open(n);
  }

  ago(iso: string): string {
    return relativeTime(iso);
  }

  @HostListener('document:click', ['$event'])
  onDocClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.open.set(false);
  }
}
