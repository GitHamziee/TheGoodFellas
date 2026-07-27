import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { NAV_BY_ROLE, ROLE_LABEL } from '../../core/nav-config';

@Component({
  selector: 'app-portal-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './portal-shell.html',
  styleUrl: './portal-shell.css',
})
export class PortalShell {
  private readonly auth = inject(AuthService);

  readonly user = this.auth.user;
  readonly roleLabel = computed(() => {
    const role = this.auth.role();
    return role ? ROLE_LABEL[role] : '';
  });
  readonly navItems = computed(() => {
    const role = this.auth.role();
    return role ? NAV_BY_ROLE[role] : [];
  });
  readonly isAdmin = computed(() => this.auth.role() === 'ADMIN');

  logout(): void {
    this.auth.logout();
  }
}
