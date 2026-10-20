import { Directive, ElementRef, Input, forwardRef, inject } from '@angular/core';
import {
  AbstractControl,
  ControlValueAccessor,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { formatPhoneInput, isValidUsPhone } from '../../core/format-utils';

/**
 * Phone input: formats as "555-234-567" while typing, caps at 9 digits, and reports a
 * `phone` validation error unless the value is exactly 9 digits. Empty is valid — add `required` where the field is mandatory.
 * Use as `<input appPhone ...>` together with ngModel.
 */
@Directive({
  selector: 'input[appPhone]',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => PhoneInput), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(() => PhoneInput), multi: true },
  ],
  host: {
    type: 'tel',
    inputmode: 'tel',
    autocomplete: 'tel',
    '[attr.maxlength]': 'maxDigits + 2',
    '[attr.placeholder]': "maxDigits === 10 ? '555-234-5678' : '555-234-567'",
    '[class.invalid]': 'invalid',
    '(input)': 'onInput($event)',
    '(blur)': 'onTouched()',
  },
})
export class PhoneInput implements ControlValueAccessor, Validator {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private onChange: (v: string) => void = () => {};
  onTouched: () => void = () => {};
  /** 9 everywhere except Retention, which takes a 10-digit US number: `<input appPhone [maxDigits]="10">`. */
  @Input() maxDigits = 9;
  invalid = false;

  writeValue(value: string | null): void {
    const text = value ? formatPhoneInput(value, this.maxDigits) || value : '';
    this.el.nativeElement.value = text;
    this.invalid = !!text && !isValidUsPhone(text, this.maxDigits);
  }
  registerOnChange(fn: (v: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void { this.el.nativeElement.disabled = disabled; }

  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const formatted = formatPhoneInput(input.value, this.maxDigits);
    input.value = formatted;
    this.invalid = !!formatted && !isValidUsPhone(formatted, this.maxDigits);
    this.onChange(formatted);
  }

  validate(control: AbstractControl): ValidationErrors | null {
    const v = control.value as string | null;
    return !v || isValidUsPhone(v, this.maxDigits) ? null : { phone: true };
  }
}
