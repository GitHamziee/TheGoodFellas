import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import {
  LucideBanknoteArrowUp,
  LucideBuilding2,
  LucideChartColumn,
  LucideChevronDown,
  LucideClipboardList,
  LucideClock,
  LucideFileText,
  LucideInbox,
  LucideLayoutDashboard,
  LucideListChecks,
  LucideUndo2,
  LucideLogOut,
  LucideMapPin,
  LucideMenu,
  LucideMessageSquare,
  LucideSend,
  LucideSettings,
  LucideTag,
  LucideUsers,
  LucideWallet,
  LucideX,
} from '@lucide/angular';
import { AuthService } from '../../core/services/auth.service';
import { ChatService } from '../../core/services/chat.service';
import { NAV_BY_ROLE, ROLE_LABEL } from '../../core/nav-config';

@Component({
  selector: 'app-portal-shell',
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    LucideLayoutDashboard,
    LucideSend,
    LucideClock,
    LucideInbox,
    LucideUsers,
    LucideBuilding2,
    LucideListChecks,
    LucideUndo2,
    LucideBanknoteArrowUp,
    LucideFileText,
    LucideClipboardList,
    LucideChartColumn,
    LucideChevronDown,
    LucideMapPin,
    LucideMessageSquare,
    LucideSettings,
    LucideTag,
    LucideWallet,
    LucideLogOut,
    LucideMenu,
    LucideX,
  ],
  templateUrl: './portal-shell.html',
  styleUrl: './portal-shell.css',
})
export class PortalShell {
  private readonly auth = inject(AuthService);
  private readonly chat = inject(ChatService);
  private readonly router = inject(Router);

  readonly user = this.auth.user;
  /** Sidebar chat badge — kept live by the socket even while you're on another page. */
  readonly chatUnread = this.chat.totalUnread;
  readonly roleLabel = computed(() => {
    const role = this.auth.role();
    return role ? ROLE_LABEL[role] : '';
  });
  readonly navItems = computed(() => {
    const role = this.auth.role();
    return role ? NAV_BY_ROLE[role] : [];
  });

  readonly drawerOpen = signal(false);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  readonly pageTitle = computed(() => {
    const url = this.currentUrl();
    for (const item of this.navItems()) {
      const child = item.children?.find((c) => url.startsWith(c.path));
      if (child) return `${item.label} — ${child.label}`;
      if (url.startsWith(item.path)) return item.label;
    }
    return '';
  });

  /** Groups the user has explicitly collapsed/expanded; unset means "follow the active route". */
  private readonly groupOverrides = signal<Record<string, boolean>>({});

  isGroupActive(path: string): boolean {
    return this.currentUrl().startsWith(path);
  }

  isGroupOpen(path: string): boolean {
    return this.groupOverrides()[path] ?? this.isGroupActive(path);
  }

  toggleGroup(path: string): void {
    const open = this.isGroupOpen(path);
    this.groupOverrides.update((state) => ({ ...state, [path]: !open }));
  }

  readonly initials = computed(() => {
    const name = this.user()?.name ?? '';
    return name
      .split(' ')
      .filter(Boolean)
      .map((part) => part[0].toUpperCase())
      .slice(0, 2)
      .join('');
  });

  toggleDrawer(): void {
    this.drawerOpen.update((open) => !open);
  }

  closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  logout(): void {
    this.auth.logout();
  }
}
