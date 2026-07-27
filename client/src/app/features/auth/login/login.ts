import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: '../auth-page.css',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  email = '';
  password = '';
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);

  async submit(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const user = await this.auth.login(this.email, this.password);
      this.router.navigateByUrl(this.auth.homeFor(user.role));
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Login failed');
    } finally {
      this.loading.set(false);
    }
  }
}
