import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-register',
  imports: [FormsModule, RouterLink],
  templateUrl: './register.html',
  styleUrl: '../auth-page.css',
})
export class Register {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  name = '';
  email = '';
  password = '';
  phone = '';
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);

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
