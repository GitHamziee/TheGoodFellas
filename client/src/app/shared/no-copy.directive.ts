import { Directive, HostListener } from '@angular/core';

/** Blocks copy/cut anywhere inside the host (keyboard shortcut, right-click menu, or drag-select)
 * so intake data can't be lifted out of the form. Paste is untouched — the events bubble up from
 * every descendant input/textarea, so one listener on the wrapping <form> covers the whole page. */
@Directive({
  selector: '[appNoCopy]',
})
export class NoCopy {
  @HostListener('copy', ['$event'])
  @HostListener('cut', ['$event'])
  block(event: Event): void {
    event.preventDefault();
  }
}
