import { AfterViewInit, Component, DestroyRef, ElementRef, inject, input, signal } from '@angular/core';
import { ControlContainer } from '@angular/forms';
import { LucideCheck } from '@lucide/angular';

interface SectionState {
  label: string;
  filled: number;
  total: number;
}

const isFilled = (v: unknown): boolean => v !== null && v !== undefined && v !== '';

/**
 * Section index beside a long lead form — progress bar, one entry per section with a
 * filled/total count, click to scroll, highlights the section in view.
 *
 * Place it as the first child of an `ngForm` with the `form-layout` class. It needs no
 * per-form config: sections are the `.section` blocks with a direct `h2.section-title`,
 * and a section's fields are the named controls of the parent NgForm inside that block.
 * Conditional fields (`@if`) are picked up as they appear, via a MutationObserver.
 */
@Component({
  selector: 'app-form-sections',
  imports: [LucideCheck],
  template: `
    <nav class="form-sections" aria-label="Form sections">
      @if (percent() !== null) {
        <div class="fs-progress">
          <span class="fs-track"><span class="fs-bar" [style.width.%]="percent()"></span></span>
          <strong>{{ percent() }}%</strong>
        </div>
      }
      <ul>
        @for (s of sections(); track $index) {
          <li>
            <button
              type="button"
              class="fs-item"
              [class.active]="active() === $index"
              [attr.aria-current]="active() === $index ? 'true' : null"
              (click)="go($index)"
            >
              <span
                class="fs-mark"
                [class.done]="s.total > 0 && s.filled === s.total"
                [class.partial]="s.filled > 0 && s.filled < s.total"
              >
                @if (s.total > 0 && s.filled === s.total) {
                  <svg lucideCheck></svg>
                }
              </span>
              <span class="fs-label">{{ s.label }}</span>
              @if (s.total > 0) {
                <span class="fs-count">{{ s.filled }}/{{ s.total }}</span>
              }
            </button>
          </li>
        }
      </ul>
    </nav>
  `,
})
export class FormSections implements AfterViewInit {
  /** Overall completeness from the host form's own tracked-field set; null hides the bar. */
  readonly percent = input<number | null>(null);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly container = inject(ControlContainer, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  readonly sections = signal<SectionState[]>([]);
  readonly active = signal(0);

  private elements: HTMLElement[] = [];
  private visible = new Set<HTMLElement>();
  private spy?: IntersectionObserver;
  private queued = false;
  private pinnedUntil = 0;

  ngAfterViewInit(): void {
    const form = this.host.nativeElement.closest('form');
    if (!form) return;

    const mutations = new MutationObserver(() => this.schedule());
    mutations.observe(form, { childList: true, subtree: true });
    const sub = this.container?.control?.valueChanges.subscribe(() => this.schedule());

    this.destroyRef.onDestroy(() => {
      mutations.disconnect();
      sub?.unsubscribe();
      this.spy?.disconnect();
    });

    this.refresh();
  }

  go(index: number): void {
    this.active.set(index);
    // The clicked entry stays highlighted through the smooth scroll — and when the last
    // sections can't reach the top because the page bottoms out first.
    this.pinnedUntil = Date.now() + 1000;
    this.elements[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Coalesces a burst of mutations / value changes into one recount. */
  private schedule(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.refresh();
    });
  }

  private refresh(): void {
    const form = this.host.nativeElement.closest('form');
    if (!form) return;
    const controls = this.controlValues();

    const elements = Array.from(form.querySelectorAll<HTMLElement>('.section')).filter((el) =>
      el.querySelector(':scope > h2.section-title'),
    );

    this.sections.set(
      elements.map((el) => {
        const names = new Set(
          Array.from(el.querySelectorAll('[name]'), (n) => n.getAttribute('name') ?? '').filter((n) => n in controls),
        );
        return {
          label: el.querySelector(':scope > h2.section-title')?.textContent?.trim() ?? '',
          filled: [...names].filter((n) => isFilled(controls[n])).length,
          total: names.size,
        };
      }),
    );

    if (elements.length !== this.elements.length || elements.some((el, i) => el !== this.elements[i])) {
      this.elements = elements;
      this.observe();
    }
  }

  private controlValues(): Record<string, unknown> {
    const group = this.container?.control as { controls?: Record<string, { value: unknown }> } | null;
    return Object.fromEntries(Object.entries(group?.controls ?? {}).map(([k, c]) => [k, c.value]));
  }

  /** The first section (in page order) that's on screen is the active one. */
  private observe(): void {
    this.spy?.disconnect();
    this.visible.clear();
    this.spy = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) this.visible.add(e.target as HTMLElement);
          else this.visible.delete(e.target as HTMLElement);
        }
        if (Date.now() < this.pinnedUntil) return;
        const first = this.elements.findIndex((el) => this.visible.has(el));
        if (first >= 0) this.active.set(first);
      },
      { rootMargin: '0px 0px -55% 0px' },
    );
    for (const el of this.elements) this.spy.observe(el);
  }
}
