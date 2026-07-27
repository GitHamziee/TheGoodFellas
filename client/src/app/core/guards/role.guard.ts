import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Role } from '../models/user.model';

/** Blocks route matching unless the current user's role is in the allowed list. */
export function roleGuard(...allowed: Role[]): CanMatchFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    const role = auth.role();
    if (role && allowed.includes(role)) return true;

    return router.createUrlTree([role ? auth.homeFor(role) : '/login']);
  };
}
