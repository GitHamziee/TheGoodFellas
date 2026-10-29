import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideKeyRound,
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
import { PageHero, EmptyState, Pagination, SearchBox, SkeletonRows, StatTile } from '../../../shared/ui/ui';
import { Select } from '../../../shared/ui/select';
import { isSilentReload, reloadOnChange } from '../../../core/live-reload';
import { apiErrorMessage } from '../../../core/api';
import { toastNotice } from '../../../core/toast-notice';
import { TeamBonuses } from './team-bonuses';

const ROLE_TONE: Record<Role, string> = {
  ADMIN: 'tone-b',
  CLOSER: 'tone-c',
  JUNIOR_CLOSER: 'tone-d',
  CLIENT: 'tone-f',
  TEAM_LEAD: 'tone-e',
  QA_JUNIOR_CLOSER: 'tone-info',
  QA_CLOSER: 'tone-neutral',
  RETENTION: 'tone-a',
  MANAGER: 'tone-gold',
  RETENTION_MANAGER: 'tone-gold',
};

/** Internal staff roster — Junior Closer, Closer, Team Lead, and Admin accounts. Client
 * accounts (pricing, licensed states, carriers) live on the separate Clients page instead;
 * this page has no pricing/coverage editor because none of these roles carry that data. */
@Component({
  selector: 'app-admin-team',
  imports: [PageHero,
    FormsModule,
    Modal,
    Select,
    StatTile,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    TeamBonuses,
    LucideUsers,
    LucideUserPlus,
    LucideShieldCheck,
    LucideMail,
    LucidePhone,
    LucideTriangleAlert,
    LucideKeyRound,
  ],
  templateUrl: './team.html',
})
export class AdminTeam implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.refresh());
  private readonly userService = inject(UserService);
  private readonly auth = inject(AuthService);

  /** Bonuses carry PKR figures, so the tab is ADMIN-only (this page is also mounted for Managers). */
  readonly canSeeBonuses = computed(() => this.auth.role() === 'ADMIN');
  readonly tab = signal<'accounts' | 'bonuses'>('accounts');

  readonly team = signal<AppUser[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = toastNotice();
  readonly creating = signal(false);
  readonly savingRole = signal(false);
  readonly resettingPassword = signal(false);

  readonly showCreate = signal(false);
  readonly selected = signal<AppUser | null>(null);
  /** Role chosen in the detail modal, pending confirmation. */
  readonly pendingRole = signal<Role | null>(null);
  /** Whether the reset-password form is expanded in the detail modal. */
  readonly showResetPassword = signal(false);

  /** The internal-staff roles this page manages — CLIENT is deliberately excluded, it lives
   * on the Clients page. */
  readonly roles: Role[] = ['JUNIOR_CLOSER', 'CLOSER', 'TEAM_LEAD', 'RETENTION', 'QA_JUNIOR_CLOSER', 'QA_CLOSER', 'MANAGER', 'RETENTION_MANAGER', 'ADMIN'];
  readonly roleLabel = ROLE_LABEL;
  readonly roleTone = ROLE_TONE;
  readonly roleOptions = this.roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }));
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  readonly roleFilters = [
    { label: 'All', value: '' },
    { label: 'Junior Closers', value: 'JUNIOR_CLOSER' },
    { label: 'Closers', value: 'CLOSER' },
    { label: 'Team Leads', value: 'TEAM_LEAD' },
    { label: 'Retention', value: 'RETENTION' },
    { label: 'QA — Junior Closer', value: 'QA_JUNIOR_CLOSER' },
    { label: 'QA — Closer', value: 'QA_CLOSER' },
    { label: 'Managers', value: 'MANAGER' },
    { label: 'Retention Managers', value: 'RETENTION_MANAGER' },
    { label: 'Admins', value: 'ADMIN' },
  ];

  name = '';
  email = '';
  password = '';
  role: Role = 'JUNIOR_CLOSER';
  newPassword = '';

  readonly currentUserId = computed(() => this.auth.user()?.id ?? null);

  readonly view = createListView<AppUser>({
    source: this.team,
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
    const rows = this.team();
    const count = (r: Role) => rows.filter((u) => u.role === r).length;
    return {
      total: rows.length,
      closers: count('CLOSER'),
      juniors: count('JUNIOR_CLOSER'),
      teamLeads: count('TEAM_LEAD'),
      managers: count('MANAGER'),
      admins: count('ADMIN'),
    };
  });

  readonly roleCounts = computed(() => {
    const rows = this.team();
    const counts: Record<string, number> = { '': rows.length };
    for (const r of this.roles) counts[r] = 0;
    for (const u of rows) counts[u.role] += 1;
    return counts;
  });

  canSubmitCreate(): boolean {
    return this.name.trim() !== '' && this.email.trim() !== '' && this.password.length >= 8;
  }

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!isSilentReload()) this.loading.set(true);
    try {
      const users = await this.userService.listUsers();
      this.team.set(users.filter((u) => u.role !== 'CLIENT'));
    } catch {
      this.error.set('Could not load team members. Refresh to try again.');
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
      });
      this.team.update((rows) => [...rows, created]);
      this.showCreate.set(false);
      this.notice.set(`Created ${created.name} as ${ROLE_LABEL[created.role]}.`);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not create the account.'));
    } finally {
      this.creating.set(false);
    }
  }

  openDetail(user: AppUser): void {
    this.error.set(null);
    this.pendingRole.set(null);
    this.showResetPassword.set(false);
    this.newPassword = '';
    this.selected.set(user);
  }

  closeDetail(): void {
    this.selected.set(null);
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
      if (updated.role === 'CLIENT') {
        // Moved off the Team roster entirely — drop it from this list.
        this.team.update((rows) => rows.filter((u) => u.id !== user.id));
        this.selected.set(null);
      } else {
        this.team.update((rows) => rows.map((u) => (u.id === user.id ? updated : u)));
        this.selected.set(updated);
      }
      this.pendingRole.set(null);
      this.notice.set(`${updated.name} is now ${ROLE_LABEL[updated.role]}. They'll need to sign in again.`);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not change the role.'));
    } finally {
      this.savingRole.set(false);
    }
  }

  async resetPassword(): Promise<void> {
    const user = this.selected();
    if (!user || this.newPassword.length < 8) return;

    this.error.set(null);
    this.resettingPassword.set(true);
    try {
      const updated = await this.userService.resetPassword(user.id, this.newPassword);
      this.selected.set(updated);
      this.showResetPassword.set(false);
      this.newPassword = '';
      this.notice.set(`Password reset for ${updated.name}. They'll need to sign in again.`);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Could not reset the password.'));
    } finally {
      this.resettingPassword.set(false);
    }
  }
}
