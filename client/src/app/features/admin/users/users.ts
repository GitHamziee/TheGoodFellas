import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideBriefcase,
  LucideCircleCheck,
  LucideMail,
  LucidePhone,
  LucideShieldCheck,
  LucideTriangleAlert,
  LucideUserPlus,
  LucideUsers,
} from '@lucide/angular';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { AppUser, Role } from '../../../core/models/user.model';
import { ROLE_LABEL } from '../../../core/nav-config';
import { createListView } from '../../../core/list-view';
import { getAvatarTone, getInitials } from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import { EmptyState, Pagination, SearchBox, SkeletonRows, StatTile } from '../../../shared/ui/ui';

const ROLE_TONE: Record<Role, string> = {
  ADMIN: 'tone-b',
  CLOSER: 'tone-c',
  JUNIOR_CLOSER: 'tone-d',
  CLIENT: 'tone-f',
};

@Component({
  selector: 'app-admin-users',
  imports: [
    FormsModule,
    Modal,
    StatTile,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideUsers,
    LucideUserPlus,
    LucideShieldCheck,
    LucideBriefcase,
    LucideMail,
    LucidePhone,
    LucideCircleCheck,
    LucideTriangleAlert,
  ],
  templateUrl: './users.html',
})
export class AdminUsers implements OnInit {
  private readonly userService = inject(UserService);
  private readonly auth = inject(AuthService);

  readonly users = signal<AppUser[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly creating = signal(false);
  readonly savingRole = signal(false);

  readonly showCreate = signal(false);
  readonly selected = signal<AppUser | null>(null);
  /** Role chosen in the detail modal, pending confirmation. */
  readonly pendingRole = signal<Role | null>(null);

  readonly roles: Role[] = ['JUNIOR_CLOSER', 'CLOSER', 'ADMIN', 'CLIENT'];
  readonly roleLabel = ROLE_LABEL;
  readonly roleTone = ROLE_TONE;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  readonly roleFilters = [
    { label: 'All', value: '' },
    { label: 'Clients', value: 'CLIENT' },
    { label: 'Closers', value: 'CLOSER' },
    { label: 'Junior', value: 'JUNIOR_CLOSER' },
    { label: 'Admins', value: 'ADMIN' },
  ];

  name = '';
  email = '';
  password = '';
  phone = '';
  role: Role = 'JUNIOR_CLOSER';

  readonly currentUserId = computed(() => this.auth.user()?.id ?? null);

  readonly view = createListView<AppUser>({
    source: this.users,
    searchFields: (u) => [u.name, u.email, u.phone],
    statusOf: (u) => u.role,
    sorters: {
      name: (u) => u.name,
      email: (u) => u.email,
      role: (u) => u.role,
    },
    initialSort: { key: 'name', dir: 'asc' },
    pageSize: 12,
  });

  readonly stats = computed(() => {
    const rows = this.users();
    const count = (r: Role) => rows.filter((u) => u.role === r).length;
    return {
      total: rows.length,
      clients: count('CLIENT'),
      closers: count('CLOSER'),
      juniors: count('JUNIOR_CLOSER'),
      admins: count('ADMIN'),
    };
  });

  readonly roleCounts = computed(() => {
    const rows = this.users();
    const counts: Record<string, number> = { '': rows.length };
    for (const r of this.roles) counts[r] = 0;
    for (const u of rows) counts[u.role] += 1;
    return counts;
  });

  readonly canSubmitCreate = computed(
    () => this.name.trim() !== '' && this.email.trim() !== '' && this.password.length >= 8,
  );

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.users.set(await this.userService.listUsers());
    } catch {
      this.error.set('Could not load accounts. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }

  openCreate(): void {
    this.error.set(null);
    this.name = '';
    this.email = '';
    this.password = '';
    this.phone = '';
    this.role = 'JUNIOR_CLOSER';
    this.showCreate.set(true);
  }

  async createUser(): Promise<void> {
    this.error.set(null);
    this.creating.set(true);
    try {
      const created = await this.userService.createUser({
        name: this.name.trim(),
        email: this.email.trim(),
        password: this.password,
        role: this.role,
        phone: this.phone.trim() || undefined,
      });
      this.users.update((rows) => [...rows, created]);
      this.showCreate.set(false);
      this.notice.set(`Created ${created.name} as ${ROLE_LABEL[created.role]}.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not create the account.');
    } finally {
      this.creating.set(false);
    }
  }

  openDetail(user: AppUser): void {
    this.error.set(null);
    this.pendingRole.set(null);
    this.selected.set(user);
  }

  /** Switching your own role would invalidate your token mid-session. */
  isSelf(user: AppUser): boolean {
    return user.id === this.currentUserId();
  }

  async confirmRoleChange(): Promise<void> {
    const user = this.selected();
    const role = this.pendingRole();
    if (!user || !role) return;

    this.error.set(null);
    this.savingRole.set(true);
    try {
      const updated = await this.userService.updateRole(user.id, role);
      this.users.update((rows) => rows.map((u) => (u.id === user.id ? updated : u)));
      this.selected.set(updated);
      this.pendingRole.set(null);
      this.notice.set(`${updated.name} is now ${ROLE_LABEL[updated.role]}. They'll need to sign in again.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not change the role.');
    } finally {
      this.savingRole.set(false);
    }
  }
}
