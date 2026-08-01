import { Directive, ElementRef, OnDestroy, OnInit, inject, signal } from '@angular/core';

/** Fades/slides an element in the first time it scrolls into view. Pair with the `.reveal` class in marketing-page.css. */
@Directive({
  selector: '[appReveal]',
  host: {
    class: 'reveal',
    '[class.is-visible]': 'visible()',
  },
})
export class Reveal implements OnInit, OnDestroy {
  private readonly el = inject(ElementRef<HTMLElement>);
  private observer?: IntersectionObserver;

  readonly visible = signal(false);

  ngOnInit(): void {
    this.observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          this.visible.set(true);
          this.observer?.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    this.observer.observe(this.el.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
