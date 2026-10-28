import { inject } from '@angular/core';
import { NotificationService } from './services/notification.service';

/**
 * Success confirmation shown as a toast (top-right, auto-dismissing) instead of an inline banner
 * that pushes the page down. Drop-in for the old `notice = signal<string | null>(null)`:
 * `notice.set('Saved.')` pops a toast, `notice.set(null)` does nothing. Toast-only — it never
 * lands in the notification bell. Create it as a field initializer (needs an injection context).
 */
export function toastNotice() {
  const notifications = inject(NotificationService);
  let seq = 0;
  return {
    set(message: string | null): void {
      if (!message) return;
      notifications.showToast({
        id: `local-${Date.now()}-${seq++}`,
        kind: 'success',
        title: message,
        message: '',
        link: null,
        createdAt: new Date().toISOString(),
      });
    },
  };
}
