import { AfterViewInit, Component, ElementRef, OnDestroy, inject, viewChild } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { LucideMinus } from '@lucide/angular';
import { ZOOM_EMBED_URL, ZoomPhoneService } from '../../core/services/zoom-phone.service';

/** Floating Zoom Phone panel. Closing only hides it — the iframe stays mounted so an
 * in-progress call isn't dropped. */
@Component({
  selector: 'app-zoom-dialer',
  imports: [LucideMinus],
  template: `
    <div class="dialer" [class.dialer--open]="zoom.open()" role="dialog" aria-label="Dialer">
      <div class="dialer-head">
        <span>Dialer</span>
        <button type="button" class="dialer-min" (click)="zoom.open.set(false)" aria-label="Minimize dialer">
          <svg lucideMinus></svg>
        </button>
      </div>
      <iframe
        #frame
        [src]="src"
        title="Zoom Phone"
        allow="microphone; autoplay; clipboard-read; clipboard-write"
        (load)="zoom.onFrameLoad()"
      ></iframe>
    </div>
  `,
  styles: `
    .dialer {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 900;
      width: 360px;
      max-width: calc(100vw - 32px);
      /* Zoom needs at least 350×580 for the embed itself, plus our header bar. */
      height: 640px;
      max-height: calc(100vh - 32px);
      display: flex;
      flex-direction: column;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22);
      overflow: hidden;
      visibility: hidden;
      opacity: 0;
      transform: translateY(12px);
      transition: opacity 0.15s ease, transform 0.15s ease, visibility 0.15s;
    }
    .dialer--open {
      visibility: visible;
      opacity: 1;
      transform: none;
    }
    .dialer-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.6rem 0.5rem 0.9rem;
      background: var(--ink-900);
      color: var(--gold-300);
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .dialer-min {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: var(--radius-sm, 6px);
      background: transparent;
      color: inherit;
      cursor: pointer;
    }
    .dialer-min:hover {
      background: rgba(255, 255, 255, 0.08);
    }
    .dialer-min svg {
      width: 16px;
      height: 16px;
    }
    iframe {
      flex: 1;
      width: 100%;
      border: 0;
    }
  `,
})
export class ZoomDialer implements AfterViewInit, OnDestroy {
  readonly zoom = inject(ZoomPhoneService);
  readonly src = inject(DomSanitizer).bypassSecurityTrustResourceUrl(ZOOM_EMBED_URL);
  private readonly frame = viewChild.required<ElementRef<HTMLIFrameElement>>('frame');

  ngAfterViewInit(): void {
    this.zoom.attach(this.frame().nativeElement);
  }

  ngOnDestroy(): void {
    this.zoom.detach();
  }
}
