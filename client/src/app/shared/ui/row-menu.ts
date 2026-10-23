import { Component, DestroyRef, ElementRef, HostListener, inject, signal } from '@angular/core';
import { LucideEllipsis } from '@lucide/angular';
import { uiZoom } from '../../core/ui-zoom';

/**
 * "⋯" overflow menu for table-row actions. Projected children are the menu items (plain
 * `<button class="menu-item">`s). The panel is `position: fixed`, so it never gets clipped by
 * the table's overflow wrapper, and it closes on any outside click, scroll, resize or Escape.
 */
@Component({
  selector: 'app-row-menu',
  imports: [LucideEllipsis],
  template: `
    <button type="button" class="btn btn--sm btn--icon btn--ghost" aria-label="More actions" title="More" aria-haspopup="menu" [attr.aria-expanded]="open()" (click)="toggle($event)">
      <svg lucideEllipsis></svg>
    </button>
    @if (open()) {
      <div class="panel" role="menu" [style.top.px]="top()" [style.left.px]="left()" (click)="open.set(false)">
        <ng-content />
      </div>
    }
  `,
  styles: `
    :host { display: inline-flex; }
    .panel {
      position: fixed; z-index: 60; min-width: 11.5rem; padding: 0.3rem;
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16); display: flex; flex-direction: column;
    }
    .panel ::ng-deep .menu-item {
      display: flex; align-items: center; gap: 0.55rem; padding: 0.5rem 0.65rem; border: 0;
      border-radius: var(--radius-sm); background: transparent; color: var(--text);
      font: inherit; font-size: 0.82rem; font-weight: 600; text-align: left; cursor: pointer;
    }
    .panel ::ng-deep .menu-item:hover { background: var(--gray-50); }
    .panel ::ng-deep .menu-item svg { width: 15px; height: 15px; color: var(--gray-500); }
  `,
})
export class RowMenu {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly open = signal(false);
  protected readonly top = signal(0);
  protected readonly left = signal(0);

  protected toggle(event: Event): void {
    event.stopPropagation();
    if (this.open()) return this.open.set(false);
    const z = uiZoom();
    const r = this.host.nativeElement.getBoundingClientRect();
    const panelHeight = 150;
    // Open upward when there isn't room below, so the last rows' menus stay on screen.
    this.top.set((r.bottom + panelHeight * z > window.innerHeight ? Math.max(8, r.top - (panelHeight + 4) * z) : r.bottom + 4 * z) / z);
    this.left.set(Math.max(8, r.right / z - 184));
    this.open.set(true);
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: Event): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  @HostListener('window:resize')
  close(): void {
    this.open.set(false);
  }

  // The page scrolls inside the shell's content pane, not the window, so listen in the
  // capture phase to catch a scroll on any ancestor.
  private readonly onScroll = () => this.open.set(false);

  constructor() {
    window.addEventListener('scroll', this.onScroll, true);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('scroll', this.onScroll, true));
  }
}
