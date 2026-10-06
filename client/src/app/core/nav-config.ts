import { Role } from './models/user.model';

export type NavIcon =
  | 'dashboard'
  | 'send'
  | 'history'
  | 'inbox'
  | 'users'
  | 'briefcase'
  | 'queue'
  | 'returned'
  | 'leads'
  | 'drafts'
  | 'chargeback'
  | 'cpl'
  | 'headset'
  | 'building'
  | 'analytics'
  | 'expenses'
  | 'states'
  | 'chat'
  | 'settings'
  | 'review'
  | 'call'
  | 'shield';

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
    { label: 'Clients', path: '/admin/clients', icon: 'briefcase' },
    { label: 'Team', path: '/admin/team', icon: 'users' },
    { label: 'External Clients', path: '/admin/external-clients', icon: 'building' },
    { label: 'State Sheet', path: '/admin/state-sheet', icon: 'states' },
    { label: 'Queue', path: '/admin/queue', icon: 'queue' },
    { label: 'CPA Leads', path: '/admin/leads', icon: 'leads' },
    { label: 'CPL Leads', path: '/admin/cpl-leads', icon: 'cpl' },
    { label: 'Drafts', path: '/admin/drafts', icon: 'drafts' },
    { label: 'Charge Backs', path: '/admin/charge-backs', icon: 'chargeback' },
    { label: 'Retention Imports', path: '/admin/retention', icon: 'inbox' },
    { label: 'Retention Leads', path: '/admin/retention-leads', icon: 'headset' },
    { label: 'Expenses', path: '/admin/expenses', icon: 'expenses' },
    {
      label: 'Analytics',
      path: '/admin/analytics',
      icon: 'analytics',
      children: [
        { label: 'Overall', path: '/admin/analytics/overall' },
        { label: 'Junior Closers', path: '/admin/analytics/junior-closers' },
        { label: 'Closers', path: '/admin/analytics/closers' },
        { label: 'Retention', path: '/admin/analytics/retention' },
        { label: 'Clients', path: '/admin/analytics/clients' },
        { label: 'Drafts', path: '/admin/analytics/drafts' },
        { label: 'Charge Backs', path: '/admin/analytics/charge-backs' },
      ],
    },
    {
      label: 'QA Reports',
      path: '/admin/qa-reports',
      icon: 'review',
      children: [
        { label: 'Transfer Report — Junior Closers', path: '/admin/qa-reports/transfer-junior-closers' },
        { label: 'Transfer Report — Closers', path: '/admin/qa-reports/transfer-closers' },
        { label: 'Live Call Report — Junior Closers', path: '/admin/qa-reports/live-call-junior-closers' },
        { label: 'Live Call Report — Closers', path: '/admin/qa-reports/live-call-closers' },
      ],
    },
    { label: 'Team Chat', path: '/admin/chat', icon: 'chat', badge: 'chat' },
    { label: 'IP Whitelist', path: '/admin/ip-whitelist', icon: 'shield' },
    { label: 'Settings', path: '/admin/settings', icon: 'settings' },
  ],
  // Everything ADMIN has except Clients, Team, External Clients, Expenses, and IP
  // Whitelist — see
  // the client's own request: full run of the pipeline/reporting pages, none of the
  // account-management ones.
  MANAGER: [
    { label: 'Dashboard', path: '/manager/dashboard', icon: 'dashboard' },
    { label: 'State Sheet', path: '/manager/state-sheet', icon: 'states' },
    { label: 'Queue', path: '/manager/queue', icon: 'queue' },
    { label: 'CPA Leads', path: '/manager/leads', icon: 'leads' },
    { label: 'CPL Leads', path: '/manager/cpl-leads', icon: 'cpl' },
    { label: 'Drafts', path: '/manager/drafts', icon: 'drafts' },
    { label: 'Charge Backs', path: '/manager/charge-backs', icon: 'chargeback' },
    { label: 'Retention Imports', path: '/manager/retention', icon: 'inbox' },
    { label: 'Retention Leads', path: '/manager/retention-leads', icon: 'headset' },
    {
      label: 'Analytics',
      path: '/manager/analytics',
      icon: 'analytics',
      children: [
        { label: 'Overall', path: '/manager/analytics/overall' },
        { label: 'Junior Closers', path: '/manager/analytics/junior-closers' },
        { label: 'Closers', path: '/manager/analytics/closers' },
        { label: 'Retention', path: '/manager/analytics/retention' },
        { label: 'Clients', path: '/manager/analytics/clients' },
        { label: 'Drafts', path: '/manager/analytics/drafts' },
        { label: 'Charge Backs', path: '/manager/analytics/charge-backs' },
      ],
    },
    {
      label: 'QA Reports',
      path: '/manager/qa-reports',
      icon: 'review',
      children: [
        { label: 'Transfer Report — Junior Closers', path: '/manager/qa-reports/transfer-junior-closers' },
        { label: 'Transfer Report — Closers', path: '/manager/qa-reports/transfer-closers' },
        { label: 'Live Call Report — Junior Closers', path: '/manager/qa-reports/live-call-junior-closers' },
        { label: 'Live Call Report — Closers', path: '/manager/qa-reports/live-call-closers' },
      ],
    },
    { label: 'Team Chat', path: '/manager/chat', icon: 'chat', badge: 'chat' },
    { label: 'Settings', path: '/manager/settings', icon: 'settings' },
  ],
  CLIENT: [
    { label: 'Dashboard', path: '/client/dashboard', icon: 'dashboard' },
    { label: 'New Leads', path: '/client/new-leads', icon: 'inbox' },
    { label: 'Lead History', path: '/client/lead-history', icon: 'history' },
  ],
  // Trimmed to Junior-Closer oversight only, per the client's ask — Team Lead no longer
  // sees anything Closer-scoped (State Sheet, Closer analytics/QA) on this nav.
  TEAM_LEAD: [
    { label: 'Dashboard', path: '/team-lead/dashboard', icon: 'dashboard' },
    { label: 'Submitted Leads', path: '/team-lead/submitted-leads', icon: 'queue' },
    { label: 'Analytics', path: '/team-lead/analytics/junior-closers', icon: 'analytics' },
    {
      label: 'QA Reports',
      path: '/team-lead/qa-reports',
      icon: 'review',
      children: [
        { label: 'Transfer Report — Junior Closers', path: '/team-lead/qa-reports/transfer-junior-closers' },
        { label: 'Live Call Report — Junior Closers', path: '/team-lead/qa-reports/live-call-junior-closers' },
      ],
    },
    { label: 'Team Chat', path: '/team-lead/chat', icon: 'chat', badge: 'chat' },
  ],
  QA_JUNIOR_CLOSER: [
    { label: 'Review Queue', path: '/qa-junior/review-queue', icon: 'review' },
    { label: 'Review History', path: '/qa-junior/review-history', icon: 'history' },
    { label: 'Write a Review', path: '/qa-junior/write-review', icon: 'call' },
  ],
  QA_CLOSER: [
    { label: 'Review Queue', path: '/qa-closer/review-queue', icon: 'review' },
    { label: 'Review History', path: '/qa-closer/review-history', icon: 'history' },
    { label: 'Write a Review', path: '/qa-closer/write-review', icon: 'call' },
  ],
  RETENTION: [
    { label: 'Dashboard', path: '/retention/dashboard', icon: 'dashboard' },
    { label: 'New Lead', path: '/retention/new-lead', icon: 'send' },
    { label: 'Retention Queue', path: '/retention/queue', icon: 'queue' },
    { label: 'History', path: '/retention/history', icon: 'history' },
    { label: 'State Sheet', path: '/retention/state-sheet', icon: 'states' },
    { label: 'Team Chat', path: '/retention/chat', icon: 'chat', badge: 'chat' },
  ],
};

export const ROLE_LABEL: Record<Role, string> = {
  JUNIOR_CLOSER: 'Junior Closer',
  CLOSER: 'Closer',
  ADMIN: 'Admin',
  CLIENT: 'Client',
  TEAM_LEAD: 'Team Lead',
  QA_JUNIOR_CLOSER: 'QA — Junior Closer',
  QA_CLOSER: 'QA — Closer',
  RETENTION: 'Retention',
  MANAGER: 'Manager',
};
