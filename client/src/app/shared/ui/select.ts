import {
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  ViewChild,
  afterNextRender,
  computed,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { LucideCheck, LucideChevronDown } from '@lucide/angular';
import { uiZoom } from '../../core/ui-zoom';

export interface SelectOption {
  value: unknown;
  label: string;
  disabled?: boolean;
  /** Extra text the search box also matches against, e.g. a state's abbreviation. */
  keywords?: string;
}

/**
 * Styled stand-in for a native <select> — browsers don't let you restyle a native
 * option list cross-browser (it's an OS-drawn popup, not real DOM), so this draws
 * its own menu using the same `.dropdown-*` vocabulary every input field uses
 * (shared-page.css).
 *
 * Drop-in replacement: bind with [(ngModel)] and a `name`, exactly like <select>.
 *
 * The open menu is portalled to <body> (see `toggle`) rather than left where it's
 * declared. A menu nested inside an `app-modal` gets clipped by the modal's own
 * `overflow: hidden` (kept for its rounded corners), and `backdrop-filter` on the
 * modal's backdrop re-roots the containing block for `position: fixed` descendants,
 * so even fixed positioning doesn't escape it from inside. Angular resolves a moved
 * node's parent dynamically when tearing down its view, so relocating it is safe —
 * no manual bookkeeping beyond removing it in `ngOnDestroy` if still open.
 */
@Component({
  selector: 'app-select',
  imports: [LucideChevronDown, LucideCheck],
  host: {
    '(document:click)': 'close()',
    '(window:resize)': 'close()',
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => Select),
      multi: true,
    },
  ],
  template: `
    <div class="dropdown">
      <button
        type="button"
        class="dropdown-trigger"
        [class.open]="open()"
        [class.invalid]="invalid()"
        [disabled]="disabled()"
        [attr.aria-label]="ariaLabel() || null"
        (click)="toggle($event)"
        (keydown.escape)="close()"
      >
        <span [class.placeholder]="isPlaceholder()">{{ selectedLabel() ?? placeholder() }}</span>
        <svg class="dropdown-chevron" lucideChevronDown></svg>
      </button>
    </div>
    @if (open()) {
      <ul #menu class="dropdown-menu" role="listbox" [style]="menuStyle()" (click)="$event.stopPropagation()">
        @if (searchable()) {
          <li class="dropdown-search" style="padding:6px;list-style:none" (click)="$event.stopPropagation()">
            <input
              #search
              type="text"
              placeholder="Type to search…"
              autocomplete="off"
              style="width:100%"
              [value]="query()"
              (input)="query.set($any($event.target).value)"
              (keydown.enter)="$event.preventDefault(); pickFirst()"
              (keydown.escape)="close()"
            />
          </li>
          @if (filteredOptions().length === 0) {
            <li class="dropdown-option disabled"><span>No matches</span></li>
          }
        }
        @for (opt of filteredOptions(); track $index) {
          <li
            role="option"
            class="dropdown-option"
            [class.selected]="opt.value === value()"
            [class.disabled]="opt.disabled"
            (click)="pick(opt)"
          >
            <span>{{ opt.label }}</span>
            @if (opt.value === value()) {
              <svg lucideCheck></svg>
            }
          </li>
        }
      </ul>
    }
  `,
})
export class Select implements ControlValueAccessor, OnDestroy {
  private readonly injector = inject(Injector);

  @ViewChild('menu') private menuRef?: ElementRef<HTMLUListElement>;

  readonly options = input<SelectOption[]>([]);
  readonly placeholder = input('Select…');
  readonly ariaLabel = input('');
  readonly invalid = input(false);
  /** Shows a type-to-filter box at the top of the open menu. */
  readonly searchable = input(false);
  readonly query = signal('');
  readonly filteredOptions = computed(() => {
    const q = this.query().trim().toLowerCase();
    return q ? this.options().filter((o) => o.label.toLowerCase().includes(q) || !!o.keywords?.toLowerCase().includes(q)) : this.options();
  });

  readonly open = signal(false);
  readonly menuStyle = signal<Record<string, string>>({});
  readonly value = signal<unknown>(undefined);
  readonly disabled = signal(false);

  readonly selectedLabel = computed(() => this.options().find((o) => o.value === this.value())?.label);
  readonly isPlaceholder = computed(() => this.selectedLabel() === undefined);

  private onChange: (value: unknown) => void = () => {};
  private onTouched: () => void = () => {};

  toggle(event: Event): void {
    if (this.disabled()) return;
    event.stopPropagation();
    if (this.open()) {
      this.closeMenu();
      return;
    }

    const z = uiZoom();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.menuStyle.set({
      position: 'fixed',
      top: `${rect.bottom / z + 6}px`,
      left: `${rect.left / z}px`,
      width: `${rect.width / z}px`,
    });
    this.open.set(true);
    // Scroll events don't bubble, and every portal page scrolls an inner `.content` div
    // rather than the window — a bubble-phase `window:scroll` listener never sees that.
    // Capture-phase listeners on window *do* see scrolling from any descendant, so this
    // is attached (and removed in closeMenu/ngOnDestroy) rather than declared as a host
    // binding, which only supports the bubble phase.
    window.addEventListener('scroll', this.onScroll, true);
    afterNextRender(
      () => {
        if (this.menuRef) {
          document.body.appendChild(this.menuRef.nativeElement);
          this.menuRef.nativeElement.querySelector<HTMLInputElement>('.dropdown-search input')?.focus();
        }
      },
      { injector: this.injector },
    );
  }

  pick(opt: SelectOption): void {
    if (opt.disabled) return;
    this.value.set(opt.value);
    this.onChange(opt.value);
    this.closeMenu();
  }

  pickFirst(): void {
    const first = this.filteredOptions().find((o) => !o.disabled);
    if (first) this.pick(first);
  }

  /** Closes on any click/resize outside the menu, or a scroll anywhere (see toggle). */
  close(): void {
    if (this.open()) this.closeMenu();
  }

  /** The capture-phase listener also sees the menu scrolling itself — that must not close it. */
  private readonly onScroll = (event: Event) => {
    const menu = this.menuRef?.nativeElement;
    if (menu && event.target instanceof Node && menu.contains(event.target)) return;
    this.close();
  };

  private closeMenu(): void {
    this.open.set(false);
    this.query.set('');
    this.onTouched();
    window.removeEventListener('scroll', this.onScroll, true);
  }

  writeValue(value: unknown): void {
    this.value.set(value);
  }

  registerOnChange(fn: (value: unknown) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  ngOnDestroy(): void {
    window.removeEventListener('scroll', this.onScroll, true);
    this.menuRef?.nativeElement.remove();
  }
}
