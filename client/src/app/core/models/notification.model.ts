export type NotificationKind = 'success' | 'info' | 'warning' | 'danger';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  message: string;
  /** Portal page to open when clicked, resolved by the server from the recipient's role. */
  link: string | null;
  read: boolean;
  createdAt: string;
}
