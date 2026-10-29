import { Component, ElementRef, ViewChild, forwardRef, input, signal } from '@angular/core';
import {
  AbstractControl,
  ControlValueAccessor,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { LucideCalendar } from '@lucide/angular';

const US_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** "2026-03-09" -> "03/09/2026" */
function isoToUs(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
}

/** "03/09/2026" -> "2026-03-09", or '' when incomplete or not a real calendar date. */
function usToIso(us: string): string {
  const m = US_DATE.exec(us);
  if (!m) return '';
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return '';
  return `${m[3]}-${m[1]}-${m[2]}`;
}

/**
 * Date field that always reads and types as US MM/DD/YYYY, whatever the browser locale is
 * (a native `<input type="date">` follows the OS/browser region and can't be overridden).
 * The model value stays an ISO `yyyy-MM-dd` string, so it is a drop-in for the native input:
 * `<app-date-input name="dob" [min]="minDob" [max]="todayIso" [(ngModel)]="form.dob">`.
 * The calendar button opens the browser's day-picker through a hidden native date input.
 */
@Component({
  selector: 'app-date-input',
  imports: [LucideCalendar],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DateInput), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(() => DateInput), multi: true },
  ],
  template: `
    <input
      #text
      type="text"
      inputmode="numeric"
      autocomplete="off"
      maxlength="10"
      placeholder="MM/DD/YYYY"
      [class.invalid]="invalid() || flagged()"
      [attr.aria-label]="ariaLabel() || null"
      [disabled]="disabled()"
      (input)="onInput($event)"
      (blur)="onTouched()"
    />
    <button type="button" class="cal-btn" tabindex="-1" aria-label="Open calendar" [disabled]="disabled()" (click)="openPicker()">
      <svg lucideCalendar></svg>
    </button>
    <input
      #picker
      class="native-picker"
      type="date"
      tabindex="-1"
      aria-hidden="true"
      [min]="min()"
      [max]="max()"
      (change)="onPick($event)"
    />
  `,
  styles: `
    :host { position: relative; display: block; }
    :host input[type='text'] { width: 100%; box-sizing: border-box; padding-right: 2.25rem; }
    .cal-btn {
      position: absolute; right: 0.35rem; top: 50%; transform: translateY(-50%);
      display: grid; place-items: center; width: 1.7rem; height: 1.7rem;
      border: 0; background: transparent; color: var(--gray-600, #6b7280); cursor: pointer; border-radius: 6px;
    }
    .cal-btn:hover { color: var(--gold-500, #d4af37); }
    .cal-btn svg { width: 1rem; height: 1rem; }
    .native-picker { position: absolute; left: 0; bottom: 0; width: 100%; height: 0; padding: 0; border: 0; opacity: 0; pointer-events: none; }
  `,
})
export class DateInput implements ControlValueAccessor, Validator {
  readonly min = input<string>('');
  readonly max = input<string>('');
  readonly ariaLabel = input<string>('', { alias: 'aria-label' });
  /** Lets the parent form highlight it, e.g. a required date left empty. */
  readonly flagged = input(false, { alias: 'invalid' });

  @ViewChild('text', { static: true }) private text!: ElementRef<HTMLInputElement>;
  @ViewChild('picker', { static: true }) private picker!: ElementRef<HTMLInputElement>;

  protected readonly invalid = signal(false);
  protected readonly disabled = signal(false);
  private onChange: (v: string) => void = () => {};
  onTouched: () => void = () => {};

  writeValue(iso: string | null): void {
    const us = isoToUs(iso);
    this.text.nativeElement.value = us;
    this.picker.nativeElement.value = us ? (iso as string).slice(0, 10) : '';
    this.invalid.set(false);
  }
  registerOnChange(fn: (v: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(d: boolean): void { this.disabled.set(d); }

  /** Auto-inserts the slashes as digits are typed. */
  protected onInput(event: Event): void {
    const el = event.target as HTMLInputElement;
    const digits = el.value.replace(/\D/g, '').slice(0, 8);
    let out = digits;
    if (digits.length > 4) out = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    else if (digits.length > 2) out = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    el.value = out;
    const iso = this.inRange(usToIso(out));
    this.invalid.set(out.length > 0 && !iso);
    this.picker.nativeElement.value = iso;
    this.onChange(iso);
  }

  protected openPicker(): void {
    const p = this.picker.nativeElement;
    try { p.showPicker(); } catch { p.focus(); }
  }

  protected onPick(event: Event): void {
    const iso = (event.target as HTMLInputElement).value;
    this.text.nativeElement.value = isoToUs(iso);
    this.invalid.set(false);
    this.onChange(iso);
    this.onTouched();
  }

  validate(_: AbstractControl): ValidationErrors | null {
    return this.invalid() ? { date: true } : null;
  }

  private inRange(iso: string): string {
    if (!iso) return '';
    if (this.min() && iso < this.min()) return '';
    if (this.max() && iso > this.max()) return '';
    return iso;
  }
}
