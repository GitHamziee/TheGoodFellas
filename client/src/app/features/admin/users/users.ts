import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UserService } from '../../../core/services/user.service';
import { AppUser, Role } from '../../../core/models/user.model';

@Component({
  selector: 'app-admin-users',
  imports: [FormsModule],
  templateUrl: './users.html',
  styleUrl: '../../shared-page.css',
})
export class AdminUsers implements OnInit {
  private readonly userService = inject(UserService);

  readonly users = signal<AppUser[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly creating = signal(false);

  readonly roles: Role[] = ['JUNIOR_CLOSER', 'CLOSER', 'ADMIN', 'CLIENT'];

  name = '';
  email = '';
  password = '';
  role: Role = 'JUNIOR_CLOSER';

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.users.set(await this.userService.listUsers());
    this.loading.set(false);
  }

  async createUser(): Promise<void> {
    this.error.set(null);
    this.creating.set(true);
    try {
      await this.userService.createUser({ name: this.name, email: this.email, password: this.password, role: this.role });
      this.name = '';
      this.email = '';
      this.password = '';
      await this.refresh();
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Failed to create user');
    } finally {
      this.creating.set(false);
    }
  }

  async changeRole(user: AppUser, role: Role): Promise<void> {
    await this.userService.updateRole(user.id, role);
    await this.refresh();
  }
}
