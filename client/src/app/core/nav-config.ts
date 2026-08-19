import { Role } from './models/user.model';

export type NavIcon =
  | 'dashboard'
  | 'send'
  | 'history'
  | 'inbox'
  | 'users'
  | 'queue'
  | 'returned'
  | 'leads'
  | 'drafts'
  | 'chargeback'
  | 'cpl'
  | 'building'
  | 'analytics'
  | 'expenses'
  | 'states'
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
    { label: 'Sent Back to Me', path: '/junior/returned', icon: 'returned' },
    { label: 'My Lead History', path: '/junior/my-leads', icon: 'history' },
    { label: 'Team Chat', path: '/junior/chat', icon: 'chat', badge: 'chat' },
  ],
  CLOSER: [
    { label: 'Dashboard', path: '/closer/dashboard', icon: 'dashboard' },
    { label: 'New Lead', path: '/closer/new-lead', icon: 'send' },
    { label: 'Assigned Leads', path: '/closer/inbox', icon: 'inbox' },
    { label: 'Drafts', path: '/closer/drafts', icon: 'drafts' },
    { label: 'Sent Back to Me', path: '/closer/returned', icon: 'returned' },
    { label: 'Lead History', path: '/closer/history', icon: 'history' },
    { label: 'State Sheet', path: '/closer/state-sheet', icon: 'states' },
    { label: 'Team Chat', path: '/closer/chat', icon: 'chat', badge: 'chat' },
  ],
  ADMIN: [
    { label: 'Dashboard', path: '/admin/dashboard', icon: 'dashboard' },
    { label: 'Clients', path: '/admin/users', icon: 'users' },
    { label: 'External Clients', path: '/admin/external-clients', icon: 'building' },
    { label: 'State Sheet', path: '/admin/state-sheet', icon: 'states' },
    { label: 'Queue', path: '/admin/queue', icon: 'queue' },
    { label: 'Leads', path: '/admin/leads', icon: 'leads' },
    { label: 'CPL Leads', path: '/admin/cpl-leads', icon: 'cpl' },
    { label: 'Charge Backs', path: '/admin/charge-backs', icon: 'chargeback' },
    { label: 'Expenses', path: '/admin/expenses', icon: 'expenses' },
    {
      label: 'Analytics',
      path: '/admin/analytics',
      icon: 'analytics',
      children: [
        { label: 'Overall', path: '/admin/analytics/overall' },
        { label: 'Junior Closers', path: '/admin/analytics/junior-closers' },
        { label: 'Closers', path: '/admin/analytics/closers' },
        { label: 'Clients', path: '/admin/analytics/clients' },
        { label: 'Drafts', path: '/admin/analytics/drafts' },
        { label: 'Charge Backs', path: '/admin/analytics/charge-backs' },
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
  TEAM_LEAD: [
    { label: 'Dashboard', path: '/team-lead/dashboard', icon: 'dashboard' },
    { label: 'Submitted Leads', path: '/team-lead/submitted-leads', icon: 'queue' },
    { label: 'State Sheet', path: '/team-lead/state-sheet', icon: 'states' },
    {
      label: 'Analytics',
      path: '/team-lead/analytics',
      icon: 'analytics',
      children: [
        { label: 'Junior Closers', path: '/team-lead/analytics/junior-closers' },
        { label: 'Closers', path: '/team-lead/analytics/closers' },
      ],
    },
    { label: 'Team Chat', path: '/team-lead/chat', icon: 'chat', badge: 'chat' },
  ],
};

export const ROLE_LABEL: Record<Role, string> = {
  JUNIOR_CLOSER: 'Junior Closer',
  CLOSER: 'Closer',
  ADMIN: 'Admin',
  CLIENT: 'Client',
  TEAM_LEAD: 'Team Lead',
};
