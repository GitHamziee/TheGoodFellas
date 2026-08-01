import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideCircleAlert,
  LucideCircleCheck,
  LucideKeyRound,
  LucideMail,
  LucidePhone,
  LucideShieldCheck,
} from '@lucide/angular';
import { AuthService } from '../../core/services/auth.service';
import { ROLE_LABEL } from '../../core/nav-config';
import { getAvatarTone, getInitials } from '../../core/format-utils';

const MIN_LENGTH = 8;

@Component({
  selector: 'app-settings',
  imports: [
    FormsModule,
    LucideKeyRound,
    LucideShieldCheck,
    LucideMail,
    LucidePhone,
    LucideCircleAlert,
    LucideCircleCheck,
  ],
  templateUrl: './settings.html',
})
export class Settings {
  private readonly auth = inject(AuthService);

  readonly user = this.auth.user;
  readonly error = signal<string | null>(null);
  readonly success = signal(false);
  readonly submitting = signal(false);

  readonly roleLabel = ROLE_LABEL;
  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly minLength = MIN_LENGTH;

  /** Mirrored into signals so the checklist updates as the user types. */
  readonly currentPassword = signal('');
  readonly newPassword = signal('');
  readonly confirmPassword = signal('');

  readonly checks = computed(() => {
    const pwd = this.newPassword();
    return {
      length: pwd.length >= MIN_LENGTH,
      differs: pwd !== '' && pwd !== this.currentPassword(),
      matches: pwd !== '' && pwd === this.confirmPassword(),
    };
  });

  readonly canSubmit = computed(() => {
    const c = this.checks();
    return (
      this.currentPassword() !== '' && c.length && c.differs && c.matches && !this.submitting()
    );
  });

  async submit(): Promise<void> {
    this.error.set(null);
    this.success.set(false);

    const c = this.checks();
    if (!c.length) {
      this.error.set(`New password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (!c.matches) {
      this.error.set('New password and confirmation do not match.');
      return;
    }

    this.submitting.set(true);
    try {
      await this.auth.changePassword(this.currentPassword(), this.newPassword());
      this.success.set(true);
      // Changing the password bumps tokenVersion, so the current session is already dead.
      setTimeout(() => this.auth.logout(), 1800);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not change your password.');
    } finally {
      this.submitting.set(false);
    }
  }
}
