import { Component, input, signal } from '@angular/core';
import { formatPhone } from '../../core/format-utils';

/** Phone number that copies the raw number to the clipboard when clicked. */
@Component({
  selector: 'app-copy-phone',
  template: `
    <button type="button" class="copy-phone" title="Click to copy" (click)="copy($event)">
      {{ copied() ? 'Copied!' : formatPhone(phone()) }}
    </button>
  `,
  styles: `
    .copy-phone {
      background: none;
      border: 0;
      padding: 0;
      font: inherit;
      color: inherit;
      cursor: pointer;
      text-decoration: underline dotted;
      text-underline-offset: 2px;
    }
    .copy-phone:hover {
      text-decoration-style: solid;
    }
  `,
})
export class CopyPhone {
  readonly phone = input<string | null | undefined>('');
  readonly copied = signal(false);
  readonly formatPhone = formatPhone;

  async copy(event: Event): Promise<void> {
    event.stopPropagation();
    const value = this.phone();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      // clipboard unavailable (insecure context / denied) — nothing to do
    }
  }
}
