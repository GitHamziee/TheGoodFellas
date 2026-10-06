import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

/** Attaches the bearer token to every request and logs out on a 401 (expired/invalid session)
 * or an IP_NOT_WHITELISTED 403 (see middleware/auth.ts — the server re-checks the caller's IP
 * on every request, not just at login, so a session started in the office stops working the
 * moment the device leaves it). */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.getToken();

  const authedReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authedReq).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && auth.isAuthenticated()) {
        const isExpiredSession = err.status === 401;
        const isIpBlocked = err.status === 403 && err.error?.code === 'IP_NOT_WHITELISTED';
        if (isExpiredSession || isIpBlocked) auth.logout();
      }
      return throwError(() => err);
    })
  );
};
