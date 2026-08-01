import { Role } from './models/user.model';

export type NavIcon =
  | 'dashboard'
  | 'send'
  | 'history'
  | 'inbox'
  | 'users'
  | 'queue'
  | 'leads'
  | 'analytics'
  | 'chat'
  | 'settings';

export interface NavItem {
  label: string;
  path: string;
  icon: NavIcon;
  /** Marks the item that carries the unread-message badge. */
  badge?: 'chat';
  /** Sub-links rendered under an expandable parent. The parent is not itself a destination. */
  children?: { label: string; path: string }[];
}

export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  JUNIOR_CLOSER: [
    { label: 'Dashboard', path: '/junior/dashboard', icon: 'dashboard' },
    { label: 'New Lead', path: '/junior/submit-lead', icon: 'send' },
    { label: 'My Lead History', path: '/junior/my-leads', icon: 'history' },
    { label: 'Team Chat', path: '/junior/chat', icon: 'chat', badge: 'chat' },
    { label: 'Settings', path: '/junior/settings', icon: 'settings' },
  ],
  CLOSER: [
    { label: 'Dashboard', path: '/closer/dashboard', icon: 'dashboard' },
    { label: 'Assigned Leads', path: '/closer/inbox', icon: 'inbox' },
    { label: 'Lead History', path: '/closer/history', icon: 'history' },
    { label: 'Team Chat', path: '/closer/chat', icon: 'chat', badge: 'chat' },
    { label: 'Settings', path: '/closer/settings', icon: 'settings' },
  ],
  ADMIN: [
    { label: 'Dashboard', path: '/admin/dashboard', icon: 'dashboard' },
    { label: 'Clients', path: '/admin/users', icon: 'users' },
    { label: 'Queue', path: '/admin/queue', icon: 'queue' },
    { label: 'Leads', path: '/admin/leads', icon: 'leads' },
    {
      label: 'Analytics',
      path: '/admin/analytics',
      icon: 'analytics',
      children: [
        { label: 'Overall', path: '/admin/analytics/overall' },
        { label: 'Junior Closers', path: '/admin/analytics/junior-closers' },
        { label: 'Closers', path: '/admin/analytics/closers' },
      ],
    },
    { label: 'Team Chat', path: '/admin/chat', icon: 'chat', badge: 'chat' },
    { label: 'Settings', path: '/admin/settings', icon: 'settings' },
  ],
  CLIENT: [
    { label: 'Dashboard', path: '/client/dashboard', icon: 'dashboard' },
    { label: 'New Leads', path: '/client/new-leads', icon: 'inbox' },
    { label: 'Lead History', path: '/client/lead-history', icon: 'history' },
    { label: 'Settings', path: '/client/settings', icon: 'settings' },
  ],
};

export const ROLE_LABEL: Record<Role, string> = {
  JUNIOR_CLOSER: 'Junior Closer',
  CLOSER: 'Closer',
  ADMIN: 'Admin',
  CLIENT: 'Client',
};
