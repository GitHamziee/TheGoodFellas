import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideBanknote,
  LucideBriefcase,
  LucideBuilding2,
  LucideCircleCheck,
  LucideKeyRound,
  LucideMail,
  LucidePhone,
  LucideShieldCheck,
  LucideTriangleAlert,
  LucideUserPlus,
  LucideUsers,
  LucideX,
} from '@lucide/angular';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { AppUser, Role } from '../../../core/models/user.model';
import { ROLE_LABEL } from '../../../core/nav-config';
import { US_STATES } from '../../../core/us-states';
import { createListView } from '../../../core/list-view';
import { getAvatarTone, getInitials } from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import { EmptyState, Pagination, SearchBox, SkeletonRows, StatTile } from '../../../shared/ui/ui';
import { Select } from '../../../shared/ui/select';

const ROLE_TONE: Record<Role, string> = {
  ADMIN: 'tone-b',
  CLOSER: 'tone-c',
  JUNIOR_CLOSER: 'tone-d',
  CLIENT: 'tone-f',
  TEAM_LEAD: 'tone-e',
};

@Component({
  selector: 'app-admin-users',
  imports: [
    FormsModule,
    Modal,
    Select,
    StatTile,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideUsers,
    LucideUserPlus,
    LucideShieldCheck,
    LucideBanknote,
    LucideBriefcase,
    LucideMail,
    LucidePhone,
    LucideCircleCheck,
    LucideTriangleAlert,
    LucideKeyRound,
    LucideBuilding2,
    LucideX,
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
  readonly resettingPassword = signal(false);
  readonly savingPricing = signal(false);
  /** Licensed states + carriers auto-save on every change while the detail modal is open
   * (see toggleState/addCarrier/removeCarrier) — no separate "Save coverage" button to
   * remember to click. This just reflects that in-flight/settled state near the fields. */
  readonly coverageStatus = signal<'idle' | 'saving' | 'saved'>('idle');
  private coverageSaveTimer: ReturnType<typeof setTimeout> | null = null;

  readonly showCreate = signal(false);
  readonly selected = signal<AppUser | null>(null);
  /** Role chosen in the detail modal, pending confirmation. */
  readonly pendingRole = signal<Role | null>(null);
  /** Whether the reset-password form is expanded in the detail modal. */
  readonly showResetPassword = signal(false);

  readonly roles: Role[] = ['JUNIOR_CLOSER', 'CLOSER', 'ADMIN', 'CLIENT', 'TEAM_LEAD'];
  readonly roleLabel = ROLE_LABEL;
  readonly roleTone = ROLE_TONE;
  readonly roleOptions = this.roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }));
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  readonly roleFilters = [
    { label: 'All', value: '' },
    { label: 'Clients', value: 'CLIENT' },
    { label: 'Closers', value: 'CLOSER' },
    { label: 'Junior', value: 'JUNIOR_CLOSER' },
    { label: 'Team Leads', value: 'TEAM_LEAD' },
    { label: 'Admins', value: 'ADMIN' },
  ];

  name = '';
  email = '';
  password = '';
  phone = '';
  role: Role = 'JUNIOR_CLOSER';
  newPassword = '';

  /** Per-plan lead cost (USD) — only meaningful while `role` is CLIENT, on both the
   * create form and the detail modal's pricing editor. */
  levelCost: number | null = null;
  gradedCost: number | null = null;
  modifiedCost: number | null = null;
  giCost: number | null = null;

  /** Licensed states + carriers — only meaningful while `role`/the selected user is CLIENT.
   * Same create-form / detail-modal split as the pricing fields above. */
  readonly usStates = US_STATES;
  selectedStates: string[] = [];
  carriers: string[] = [];
  carrierInput = '';

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

  canSubmitCreate(): boolean {
    return this.name.trim() !== '' && this.email.trim() !== '' && this.password.length >= 8;
  }

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
    this.levelCost = null;
    this.gradedCost = null;
    this.modifiedCost = null;
    this.giCost = null;
    this.selectedStates = [];
    this.carriers = [];
    this.carrierInput = '';
    this.showCreate.set(true);
  }

  /** Toggles a state in/out of `selectedStates` — used by both the create form and the
   * detail modal's coverage editor. */
  toggleState(state: string): void {
    this.selectedStates = this.selectedStates.includes(state)
      ? this.selectedStates.filter((s) => s !== state)
      : [...this.selectedStates, state];
    this.queueCoverageAutoSave();
  }

  /** Carriers have no fixed list — the admin types each one in manually. */
  addCarrier(): void {
    this.addCarrierValue(this.carrierInput);
    this.carrierInput = '';
  }

  private addCarrierValue(raw: string): void {
    const value = raw.trim();
    if (!value || this.carriers.some((c) => c.toLowerCase() === value.toLowerCase())) return;
    this.carriers = [...this.carriers, value];
    this.queueCoverageAutoSave();
  }

  /** Bound via (ngModelChange) rather than [(ngModel)] so a typed/pasted comma can be
   * caught the moment it lands in the value — "Aetna, AIG," commits "Aetna" and "AIG"
   * immediately and leaves the trailing segment in the box, no Enter needed per carrier. */
  onCarrierInputChange(value: string): void {
    if (!value.includes(',')) {
      this.carrierInput = value;
      return;
    }
    const segments = value.split(',');
    this.carrierInput = segments.pop() ?? '';
    for (const segment of segments) this.addCarrierValue(segment);
  }

  removeCarrier(carrier: string): void {
    this.carriers = this.carriers.filter((c) => c !== carrier);
    this.queueCoverageAutoSave();
  }

  /** Debounced auto-save for the detail modal's coverage editor — only while an existing
   * account is open (`selected()`); the create form saves everything together on submit. */
  private queueCoverageAutoSave(): void {
    if (!this.selected()) return;
    this.coverageStatus.set('idle');
    if (this.coverageSaveTimer) clearTimeout(this.coverageSaveTimer);
    this.coverageSaveTimer = setTimeout(() => this.autoSaveCoverage(), 700);
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
        ...(this.role === 'CLIENT'
          ? {
              levelCost: this.levelCost,
              gradedCost: this.gradedCost,
              modifiedCost: this.modifiedCost,
              giCost: this.giCost,
              states: this.selectedStates,
              carriers: this.carriers,
            }
          : {}),
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
    this.showResetPassword.set(false);
    this.newPassword = '';
    this.levelCost = user.levelCost ?? null;
    this.gradedCost = user.gradedCost ?? null;
    this.modifiedCost = user.modifiedCost ?? null;
    this.giCost = user.giCost ?? null;
    this.selectedStates = user.states ?? [];
    this.carriers = user.carriers ?? [];
    this.carrierInput = '';
    if (this.coverageSaveTimer) clearTimeout(this.coverageSaveTimer);
    this.coverageSaveTimer = null;
    this.coverageStatus.set('idle');
    this.selected.set(user);
  }

  /** CLIENT accounts only — saves the per-plan lead cost from the detail modal. */
  async savePricing(): Promise<void> {
    const user = this.selected();
    if (!user) return;

    this.error.set(null);
    this.savingPricing.set(true);
    try {
      const updated = await this.userService.updatePricing(user.id, {
        levelCost: this.levelCost,
        gradedCost: this.gradedCost,
        modifiedCost: this.modifiedCost,
        giCost: this.giCost,
      });
      this.users.update((rows) => rows.map((u) => (u.id === user.id ? updated : u)));
      this.selected.set(updated);
      this.notice.set(`Updated plan pricing for ${updated.name}.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not update plan pricing.');
    } finally {
      this.savingPricing.set(false);
    }
  }

  /** CLIENT accounts only — auto-saves licensed states + carriers from the detail modal,
   * debounced via queueCoverageAutoSave() so every toggle/add/remove doesn't fire its own
   * request. */
  private async autoSaveCoverage(): Promise<void> {
    const user = this.selected();
    if (!user) return;

    this.error.set(null);
    this.coverageStatus.set('saving');
    try {
      const updated = await this.userService.updateCoverage(user.id, {
        states: this.selectedStates,
        carriers: this.carriers,
      });
      this.users.update((rows) => rows.map((u) => (u.id === user.id ? updated : u)));
      this.selected.set(updated);
      this.coverageStatus.set('saved');
      setTimeout(() => {
        if (this.coverageStatus() === 'saved') this.coverageStatus.set('idle');
      }, 2500);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not update coverage.');
      this.coverageStatus.set('idle');
    }
  }

  /** Flushes any pending debounced coverage save before the detail modal closes, so a
   * quick edit-then-close doesn't get dropped by the 700ms debounce window. */
  async closeDetail(): Promise<void> {
    if (this.coverageSaveTimer) {
      clearTimeout(this.coverageSaveTimer);
      this.coverageSaveTimer = null;
      await this.autoSaveCoverage();
    }
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
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not reset the password.');
    } finally {
      this.resettingPassword.set(false);
    }
  }
}
