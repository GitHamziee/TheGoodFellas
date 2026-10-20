import { Directive, ElementRef, forwardRef, inject } from '@angular/core';
import {
  AbstractControl,
  ControlValueAccessor,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { isValidZip } from '../../core/format-utils';

/**
 * Zipcode input: digits only, capped at 5, and reports a `zip` validation error unless the
 * value is exactly 5 digits. Empty is valid — add `required` where the field is mandatory.
 * Use as `<input appZip ...>` together with ngModel.
 */
@Directive({
  selector: 'input[appZip]',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => ZipInput), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(() => ZipInput), multi: true },
  ],
  host: {
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'postal-code',
    maxlength: '5',
    placeholder: '12345',
    '[class.invalid]': 'invalid',
    '(input)': 'onInput($event)',
    '(blur)': 'onTouched()',
  },
})
export class ZipInput implements ControlValueAccessor, Validator {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private onChange: (v: string) => void = () => {};
  onTouched: () => void = () => {};
  invalid = false;

  writeValue(value: string | null): void {
    const text = value ?? '';
    this.el.nativeElement.value = text;
    this.invalid = !!text && !isValidZip(text);
  }
  registerOnChange(fn: (v: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void { this.el.nativeElement.disabled = disabled; }

  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 5);
    input.value = digits;
    this.invalid = !!digits && !isValidZip(digits);
    this.onChange(digits);
  }

  validate(control: AbstractControl): ValidationErrors | null {
    const v = control.value as string | null;
    return !v || isValidZip(v) ? null : { zip: true };
  }
}
