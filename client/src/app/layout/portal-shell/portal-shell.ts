import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, HostListener, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import {
  LucideBanknoteArrowUp,
  LucideBriefcase,
  LucideBuilding2,
  LucideChartColumn,
  LucideChevronDown,
  LucideClipboardCheck,
  LucideClipboardList,
  LucideClock,
  LucideFileText,
  LucideHeadset,
  LucideInbox,
  LucideLayoutDashboard,
  LucideListChecks,
  LucideUndo2,
  LucideLogOut,
  LucideMapPin,
  LucideMenu,
  LucideMessageSquare,
  LucidePanelLeftClose,
  LucidePanelLeftOpen,
  LucidePhoneCall,
  LucideSend,
  LucideSettings,
  LucideShield,
  LucideTag,
  LucideToolbox,
  LucideUsers,
  LucideWallet,
  LucideX,
} from '@lucide/angular';
import { NotificationBell, ToastHost } from '../../shared/ui/notifications';
import { ZoomDialer } from '../../shared/ui/zoom-dialer';
import { ZoomPhoneService } from '../../core/services/zoom-phone.service';
import { AuthService } from '../../core/services/auth.service';
import { ChatService } from '../../core/services/chat.service';
import { NAV_BY_ROLE, NavItem, ROLE_LABEL } from '../../core/nav-config';

const COLLAPSED_KEY = 'tgf.sidebarCollapsed';

/** Collapsed by default — only an explicit "expanded" choice ('0') opens it on load. */
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) !== '0';
  } catch {
    return true;
  }
}

@Component({
  selector: 'app-portal-shell',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    NotificationBell,
    ToastHost,
    ZoomDialer,
    LucideLayoutDashboard,
    LucideSend,
    LucideClock,
    LucideInbox,
    LucideUsers,
    LucideBriefcase,
    LucideBuilding2,
    LucideListChecks,
    LucideUndo2,
    LucideBanknoteArrowUp,
    LucideFileText,
    LucideHeadset,
    LucideClipboardCheck,
    LucideClipboardList,
    LucideChartColumn,
    LucideChevronDown,
    LucideMapPin,
    LucideMessageSquare,
    LucidePhoneCall,
    LucideSettings,
    LucideShield,
    LucideTag,
    LucideToolbox,
    LucideWallet,
    LucideLogOut,
    LucideMenu,
    LucidePanelLeftClose,
    LucidePanelLeftOpen,
    LucideX,
  ],
  templateUrl: './portal-shell.html',
  styleUrl: './portal-shell.css',
})
export class PortalShell {
  private readonly auth = inject(AuthService);
  private readonly chat = inject(ChatService);
  private readonly router = inject(Router);
  readonly zoom = inject(ZoomPhoneService);

  readonly user = this.auth.user;
  /** Sidebar chat badge — kept live by the socket even while you're on another page. */
  readonly chatUnread = this.chat.totalUnread;
  readonly roleLabel = computed(() => {
    const role = this.auth.role();
    return role ? ROLE_LABEL[role] : '';
  });
  /** Only Retention and its manager dial out — the Zoom Phone embed is mounted for them alone. */
  readonly hasDialer = computed(() => this.auth.role() === 'RETENTION' || this.auth.role() === 'RETENTION_MANAGER');
  readonly navItems = computed(() => {
    const role = this.auth.role();
    return role ? NAV_BY_ROLE[role] : [];
  });

  readonly drawerOpen = signal(false);
  readonly userMenuOpen = signal(false);
  private readonly userMenu = viewChild<ElementRef<HTMLElement>>('userMenu');

  /** Close the user menu on any click outside it. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.userMenuOpen() && !this.userMenu()?.nativeElement.contains(event.target as Node)) {
      this.userMenuOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.userMenuOpen.set(false);
  }

  /** Desktop only: sidebar shrunk to an icon rail. Collapsed by default and remembered per
   * browser — a viewer convenience, so blocked/empty storage just falls back to collapsed. */
  readonly collapsed = signal(readCollapsed());

  toggleCollapsed(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      /* storage unavailable — the toggle still works for this session */
    }
  }

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  private matches(url: string, path: string): boolean {
    return url === path || url.startsWith(path + '/') || url.startsWith(path + '?');
  }

  /** The tabbed section (Analytics, QA Reports) the current page belongs to, if any. */
  readonly activeTabs = computed(() => {
    const url = this.currentUrl();
    const item = this.navItems().find(
      (i) => i.tabs && i.children?.some((c) => this.matches(url, c.path)),
    );
    return item?.children ?? [];
  });

  readonly pageTitle = computed(() => {
    const url = this.currentUrl();
    for (const item of this.navItems()) {
      const child = item.children?.find((c) => this.matches(url, c.path));
      if (child) return item.tabs ? `${item.label} — ${child.label}` : child.label;
      if (!item.children && this.matches(url, item.path)) return item.label;
    }
    return '';
  });

  /** Groups the user has explicitly collapsed/expanded; unset means "follow the active route". */
  private readonly groupOverrides = signal<Record<string, boolean>>({});

  isGroupActive(item: NavItem): boolean {
    const url = this.currentUrl();
    return !!item.children?.some((c) => this.matches(url, c.path));
  }

  isGroupOpen(item: NavItem): boolean {
    return this.groupOverrides()[item.label] ?? this.isGroupActive(item);
  }

  toggleGroup(item: NavItem): void {
    // A group's sub-pages can't fit in the icon rail, so clicking one expands the sidebar
    // with that group open instead of toggling something the user can't see.
    if (this.collapsed() && window.matchMedia('(min-width: 881px)').matches) {
      this.toggleCollapsed();
      this.groupOverrides.update((state) => ({ ...state, [item.label]: true }));
      return;
    }
    const open = this.isGroupOpen(item);
    this.groupOverrides.update((state) => ({ ...state, [item.label]: !open }));
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
    this.userMenuOpen.set(false);
    this.auth.logout();
  }
}
