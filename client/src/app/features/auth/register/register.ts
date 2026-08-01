import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideCheck, LucideEye, LucideEyeOff } from '@lucide/angular';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-register',
  imports: [FormsModule, RouterLink, LucideArrowLeft, LucideCheck, LucideEye, LucideEyeOff],
  templateUrl: './register.html',
  styleUrl: '../auth-page.css',
})
export class Register {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Copy for the ink brand panel — mirrors the marketing site's positioning. */
  readonly asidePoints = [
    'Review every lead before you accept it',
    'Full detail once accepted — nothing missing',
    'Live status on every transfer and policy',
  ];

  readonly verticals = ['Final Expense', 'Medicare', 'Health Insurance', 'Auto Insurance'];

  name = '';
  email = '';
  password = '';
  phone = '';
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly showPassword = signal(false);

  constructor() {
    const role = this.auth.role();
    if (role) {
      this.router.navigateByUrl(this.auth.homeFor(role));
    }
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((show) => !show);
  }

  async submit(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const user = await this.auth.register({ name: this.name, email: this.email, password: this.password, phone: this.phone || undefined });
      this.router.navigateByUrl(this.auth.homeFor(user.role));
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Registration failed');
    } finally {
      this.loading.set(false);
    }
  }
}
