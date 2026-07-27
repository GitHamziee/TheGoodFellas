import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-settings',
  imports: [FormsModule],
  templateUrl: './settings.html',
  styleUrl: '../shared-page.css',
})
export class Settings {
  private readonly auth = inject(AuthService);

  readonly user = this.auth.user;
  readonly error = signal<string | null>(null);
  readonly success = signal(false);
  readonly submitting = signal(false);

  currentPassword = '';
  newPassword = '';
  confirmPassword = '';

  async submit(): Promise<void> {
    this.error.set(null);
    this.success.set(false);

    if (this.newPassword !== this.confirmPassword) {
      this.error.set('New password and confirmation do not match');
      return;
    }

    this.submitting.set(true);
    try {
      await this.auth.changePassword(this.currentPassword, this.newPassword);
      this.success.set(true);
      setTimeout(() => this.auth.logout(), 1500);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Failed to change password');
    } finally {
      this.submitting.set(false);
    }
  }
}
