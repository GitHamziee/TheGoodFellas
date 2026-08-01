import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LucideArrowRight, LucideMail, LucideMenu, LucideX } from '@lucide/angular';
import { AuthService } from '../../core/services/auth.service';

/** Chrome for the public site — nav + footer around Home/About/Services/Contact. Parallels PortalShell but ungated. */
@Component({
  selector: 'app-public-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, LucideArrowRight, LucideMail, LucideMenu, LucideX],
  templateUrl: './public-shell.html',
  styleUrl: './public-shell.css',
})
export class PublicShell {
  private readonly auth = inject(AuthService);

  readonly isAuthenticated = this.auth.isAuthenticated;
  readonly homeUrl = computed(() => {
    const role = this.auth.role();
    return role ? this.auth.homeFor(role) : '/login';
  });

  readonly scrolled = signal(false);
  readonly menuOpen = signal(false);
  readonly year = new Date().getFullYear();

  readonly navLinks = [
    { path: '/', label: 'Home', exact: true },
    { path: '/about', label: 'About', exact: false },
    { path: '/services', label: 'Services', exact: false },
    { path: '/contact', label: 'Contact', exact: false },
  ];

  @HostListener('window:scroll')
  onScroll(): void {
    this.scrolled.set(window.scrollY > 20);
  }

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }
}
