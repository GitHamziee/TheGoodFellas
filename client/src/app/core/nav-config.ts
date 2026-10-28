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
  | 'shield'
  | 'toolkit';

export interface NavChild {
  label: string;
  path: string;
}

export interface NavItem {
  label: string;
  path: string;
  icon: NavIcon;
  /** Marks the item that carries the unread-message badge. */
  badge?: 'chat';
  /** Sub-pages. The parent is not itself a destination unless `tabs` is set. */
  children?: NavChild[];
  /**
   * With `children`: render ONE sidebar link (to the first child) and show the children as a
   * tab bar above the page instead of nesting them in the sidebar.
   */
  tabs?: boolean;
}

/** One sidebar link; its children appear as a tab bar above the page. */
const tabs = (label: string, icon: NavIcon, children: NavChild[]): NavItem => ({
  label,
  icon,
  tabs: true,
  children,
  path: children[0].path,
});

/** A collapsible sidebar section; `path` is only a stable key, the parent is not a link. */
const group = (label: string, icon: NavIcon, children: NavChild[]): NavItem => ({
  label,
  icon,
  children,
  path: children[0].path,
});

const analyticsTabs = (p: string) =>
  tabs('Analytics', 'analytics', [
    { label: 'Overall', path: `${p}/analytics/overall` },
    { label: 'Junior Closers', path: `${p}/analytics/junior-closers` },
    { label: 'Closers', path: `${p}/analytics/closers` },
    { label: 'Retention', path: `${p}/analytics/retention` },
    { label: 'Clients', path: `${p}/analytics/clients` },
  ]);

const qaTabs = (p: string) =>
  tabs('QA Reports', 'review', [
    { label: 'Junior Transfer', path: `${p}/qa-reports/transfer-junior-closers` },
    { label: 'Closer Transfer', path: `${p}/qa-reports/transfer-closers` },
    { label: 'Junior Live Call', path: `${p}/qa-reports/live-call-junior-closers` },
    { label: 'Closer Live Call', path: `${p}/qa-reports/live-call-closers` },
  ]);

const resources = (p: string) =>
  group('Resources', 'toolkit', [
    { label: 'State Sheet', path: `${p}/state-sheet` },
    { label: 'Toolkit', path: `${p}/toolkit` },
  ]);

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
    group('My Leads', 'history', [
      { label: 'Re-Writes', path: '/closer/returned' },
      { label: 'Drafts', path: '/closer/drafts' },
      { label: 'Lead History', path: '/closer/history' },
    ]),
    resources('/closer'),
    { label: 'Team Chat', path: '/closer/chat', icon: 'chat', badge: 'chat' },
  ],
  ADMIN: [
    { label: 'Dashboard', path: '/admin/dashboard', icon: 'dashboard' },
    group('Leads', 'leads', [
      { label: 'CPA & Retention Leads', path: '/admin/leads' },
      { label: 'CPL Leads', path: '/admin/cpl-leads' },
      { label: 'Drafts', path: '/admin/drafts' },
      { label: 'Retention Imports', path: '/admin/retention' },
      { label: 'Retention History', path: '/admin/retention-history' },
    ]),
    group('People', 'users', [
      { label: 'Team', path: '/admin/team' },
      { label: 'Clients', path: '/admin/clients' },
      { label: 'External Clients', path: '/admin/external-clients' },
    ]),
    group('Money', 'expenses', [
      { label: 'Expenses', path: '/admin/expenses' },
      { label: 'Charge Backs', path: '/admin/charge-backs' },
    ]),
    analyticsTabs('/admin'),
    qaTabs('/admin'),
    resources('/admin'),
    { label: 'Team Chat', path: '/admin/chat', icon: 'chat', badge: 'chat' },
    group('System', 'settings', [
      { label: 'Settings', path: '/admin/settings' },
      { label: 'IP Whitelist', path: '/admin/ip-whitelist' },
    ]),
  ],
  // Everything ADMIN has except Clients, Team, External Clients, Expenses, and IP
  // Whitelist — full run of the pipeline/reporting pages, none of the account-management ones.
  MANAGER: [
    { label: 'Dashboard', path: '/manager/dashboard', icon: 'dashboard' },
    group('Leads', 'leads', [
      { label: 'CPA & Retention Leads', path: '/manager/leads' },
      { label: 'CPL Leads', path: '/manager/cpl-leads' },
      { label: 'Drafts', path: '/manager/drafts' },
      { label: 'Retention Imports', path: '/manager/retention' },
      { label: 'Retention History', path: '/manager/retention-history' },
      { label: 'Charge Backs', path: '/manager/charge-backs' },
    ]),
    analyticsTabs('/manager'),
    qaTabs('/manager'),
    resources('/manager'),
    { label: 'Team Chat', path: '/manager/chat', icon: 'chat', badge: 'chat' },
    { label: 'Settings', path: '/manager/settings', icon: 'settings' },
  ],
  CLIENT: [
    { label: 'Dashboard', path: '/client/dashboard', icon: 'dashboard' },
    { label: 'CPA Leads', path: '/client/cpa-leads', icon: 'leads' },
    { label: 'CPL Leads', path: '/client/cpl-leads', icon: 'cpl' },
    { label: 'Chat', path: '/client/chat', icon: 'chat', badge: 'chat' },
  ],
  // Trimmed to Junior-Closer oversight only — Team Lead no longer sees anything
  // Closer-scoped (State Sheet, Closer analytics/QA) on this nav.
  TEAM_LEAD: [
    { label: 'Dashboard', path: '/team-lead/dashboard', icon: 'dashboard' },
    { label: 'Junior Closer Leads', path: '/team-lead/submitted-leads', icon: 'queue' },
    { label: 'Analytics', path: '/team-lead/analytics/junior-closers', icon: 'analytics' },
    tabs('QA Reports', 'review', [
      { label: 'Transfer', path: '/team-lead/qa-reports/transfer-junior-closers' },
      { label: 'Live Call', path: '/team-lead/qa-reports/live-call-junior-closers' },
    ]),
    { label: 'Team Chat', path: '/team-lead/chat', icon: 'chat', badge: 'chat' },
  ],
  QA_JUNIOR_CLOSER: [
    { label: 'Review Queue', path: '/qa-junior/review-queue', icon: 'review' },
    { label: 'Review History', path: '/qa-junior/review-history', icon: 'history' },
    { label: 'Write a Review', path: '/qa-junior/write-review', icon: 'call' },
    { label: 'Chat', path: '/qa-junior/chat', icon: 'chat', badge: 'chat' },
  ],
  QA_CLOSER: [
    { label: 'Review Queue', path: '/qa-closer/review-queue', icon: 'review' },
    { label: 'Review History', path: '/qa-closer/review-history', icon: 'history' },
    { label: 'Write a Review', path: '/qa-closer/write-review', icon: 'call' },
    { label: 'Toolkit', path: '/qa-closer/toolkit', icon: 'toolkit' },
    { label: 'Chat', path: '/qa-closer/chat', icon: 'chat', badge: 'chat' },
  ],
  // Read-only view of every lead plus per-lead follow-up notes — no pipeline actions.
  RETENTION_MANAGER: [
    { label: 'Charge Backs', path: '/retention-manager/charge-backs', icon: 'chargeback' },
    group('Leads', 'leads', [
      { label: 'Retention Leads', path: '/retention-manager/leads' },
      { label: 'Retention History', path: '/retention-manager/retention-history' },
    ]),
    { label: 'Team Chat', path: '/retention-manager/chat', icon: 'chat', badge: 'chat' },
  ],
  RETENTION: [
    { label: 'Dashboard', path: '/retention/dashboard', icon: 'dashboard' },
    { label: 'New Lead', path: '/retention/new-lead', icon: 'send' },
    { label: 'Leads', path: '/retention/leads', icon: 'queue' },
    { label: 'History', path: '/retention/history', icon: 'analytics' },
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
  RETENTION_MANAGER: 'Retention Manager',
};
