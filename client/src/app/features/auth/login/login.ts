import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideCheck, LucideEye, LucideEyeOff } from '@lucide/angular';
import { AuthService } from '../../../core/services/auth.service';
import { apiErrorMessage } from '../../../core/api';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink, LucideArrowLeft, LucideCheck, LucideEye, LucideEyeOff],
  templateUrl: './login.html',
  styleUrl: '../auth-page.css',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Copy for the ink brand panel — mirrors the marketing site's positioning. */
  readonly asidePoints = [
    'Every call AI-verified before a human picks up',
    'Warm transfers to a licensed Closer on the same call',
    'Exclusive to one client — never resold',
  ];

  readonly verticals = ['Final Expense', 'Medicare', 'Health Insurance', 'Auto Insurance'];

  email = '';
  password = '';
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
      const user = await this.auth.login(this.email, this.password);
      this.router.navigateByUrl(this.auth.homeFor(user.role));
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Login failed'));
    } finally {
      this.loading.set(false);
    }
  }
}
