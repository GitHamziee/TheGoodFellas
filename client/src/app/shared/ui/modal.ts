import { Component, input, output } from '@angular/core';
import { LucideX } from '@lucide/angular';

/**
 * Centered dialog. Projects body content by default; extra footer actions go in
 * a `[footer]` slot and render to the left of the always-present Close button.
 */
@Component({
  selector: 'app-modal',
  imports: [LucideX],
  host: { '(document:keydown.escape)': 'close.emit()' },
  template: `
    <div class="backdrop" (click)="close.emit()">
      <div
        class="modal"
        [class.modal--wide]="wide()"
        role="dialog"
        aria-modal="true"
        (click)="$event.stopPropagation()"
      >
        <div class="head">
          <div class="head-text">
            <h3>{{ title() }}</h3>
            @if (subtitle()) {
              <p>{{ subtitle() }}</p>
            }
          </div>
          <button type="button" class="x" (click)="close.emit()" aria-label="Close">
            <svg lucideX></svg>
          </button>
        </div>

        <div class="body">
          <ng-content />
        </div>

        <div class="foot">
          <ng-content select="[footer]" />
          <button type="button" class="btn btn--ghost" (click)="close.emit()">Close</button>
        </div>
      </div>
    </div>
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 60;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      background: rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(3px);
      animation: fade 0.15s ease both;
    }

    .modal {
      width: 100%;
      max-width: 520px;
      max-height: calc(88dvh / var(--ui-zoom));
      display: flex;
      flex-direction: column;
      background: var(--surface);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-lg);
      overflow: hidden;
      animation: pop 0.18s ease both;
    }

    .modal--wide { max-width: 780px; }

    .head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding: 1.1rem 1.35rem;
      border-bottom: 1px solid var(--border);
    }

    .head h3 {
      margin: 0;
      font-size: 1rem;
      font-weight: 800;
      color: var(--text);
    }

    .head p {
      margin: 0.15rem 0 0;
      font-size: 0.78rem;
      color: var(--gray-500);
    }

    .x {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 1.85rem;
      height: 1.85rem;
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--gray-400);
      cursor: pointer;
      transition: background 0.13s ease, color 0.13s ease;
    }

    .x svg { width: 16px; height: 16px; }
    .x:hover { background: var(--gray-100); color: var(--text); }

    .body {
      padding: 1.25rem 1.35rem;
      overflow-y: auto;
      flex: 1;
    }

    .foot {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.5rem;
      flex-wrap: wrap;
      padding: 0.9rem 1.35rem;
      border-top: 1px solid var(--border);
      background: var(--gray-50);
    }

    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes pop {
      from { opacity: 0; transform: translateY(8px) scale(0.99); }
      to { opacity: 1; transform: none; }
    }

    @media (prefers-reduced-motion: reduce) {
      .backdrop, .modal { animation: none; }
    }
  `,
})
export class Modal {
  readonly title = input('');
  readonly subtitle = input('');
  readonly wide = input(false);
  readonly close = output<void>();
}
