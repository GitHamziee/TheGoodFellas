import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./layout/public-shell/public-shell').then((m) => m.PublicShell),
    children: [
      { path: '', loadComponent: () => import('./features/marketing/home/home').then((m) => m.Home) },
      { path: 'about', loadComponent: () => import('./features/marketing/about/about').then((m) => m.About) },
      {
        path: 'services',
        loadComponent: () => import('./features/marketing/services/services').then((m) => m.Services),
      },
      { path: 'contact', loadComponent: () => import('./features/marketing/contact/contact').then((m) => m.Contact) },
    ],
  },

  {
    path: 'login',
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
  },

  // Public, no login — external form for logging AI-sourced ("Retention") leads,
  // replaces the old Google Sheet these used to be logged into by hand.
  {
    path: 'retention-intake',
    loadComponent: () =>
      import('./features/retention-intake/retention-intake').then((m) => m.RetentionIntake),
  },

  {
    path: 'junior',
    canMatch: [authGuard, roleGuard('JUNIOR_CLOSER')],
    loadComponent: () => import('./layout/portal-shell/portal-shell').then((m) => m.PortalShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/junior-closer/dashboard/dashboard').then((m) => m.JuniorDashboard),
      },
      {
        path: 'submit-lead',
        loadComponent: () => import('./features/junior-closer/submit-lead/submit-lead').then((m) => m.SubmitLead),
      },
      {
        path: 'my-leads',
        loadComponent: () => import('./features/junior-closer/my-leads/my-leads').then((m) => m.MyLeads),
      },
      {
        path: 'returned',
        loadComponent: () => import('./features/junior-closer/returned/returned').then((m) => m.JuniorReturned),
      },
      {
        // Correction mode of the intake form — same component as submit-lead.
        path: 'leads/:id/edit',
        loadComponent: () => import('./features/junior-closer/submit-lead/submit-lead').then((m) => m.SubmitLead),
      },
      {
        path: 'chat',
        loadComponent: () => import('./features/chat/chat').then((m) => m.Chat),
      },
      // Settings removed from this portal's nav — redirect stray bookmarks/links rather
      // than letting them 404 all the way out to the public marketing site.
      { path: 'settings', redirectTo: 'dashboard' },
    ],
  },

  {
    path: 'closer',
    canMatch: [authGuard, roleGuard('CLOSER')],
    loadComponent: () => import('./layout/portal-shell/portal-shell').then((m) => m.PortalShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/closer/dashboard/dashboard').then((m) => m.CloserDashboard),
      },
      {
        path: 'inbox',
        loadComponent: () => import('./features/closer/inbox/inbox').then((m) => m.CloserInbox),
      },
      {
        path: 'new-lead',
        loadComponent: () => import('./features/closer/new-lead/new-lead').then((m) => m.NewLead),
      },
      {
        path: 'drafts',
        loadComponent: () => import('./features/closer/drafts/drafts').then((m) => m.CloserDrafts),
      },
      {
        path: 'leads/:id',
        loadComponent: () => import('./features/closer/enrich-lead/enrich-lead').then((m) => m.EnrichLead),
      },
      {
        path: 'history',
        loadComponent: () => import('./features/closer/history/history').then((m) => m.CloserHistory),
      },
      {
        path: 'state-sheet',
        loadComponent: () => import('./features/admin/state-sheet/state-sheet').then((m) => m.StateSheet),
      },
      {
        path: 'toolkit',
        loadComponent: () => import('./features/toolkit/toolkit').then((m) => m.Toolkit),
      },
      {
        path: 'returned',
        loadComponent: () => import('./features/closer/returned/returned').then((m) => m.CloserReturned),
      },
      {
        path: 'chat',
        loadComponent: () => import('./features/chat/chat').then((m) => m.Chat),
      },
      // Settings removed from this portal's nav — redirect stray bookmarks/links rather
      // than letting them 404 all the way out to the public marketing site.
      { path: 'settings', redirectTo: 'dashboard' },
    ],
  },

  {
    path: 'admin',
    canMatch: [authGuard, roleGuard('ADMIN')],
    loadComponent: () => import('./layout/portal-shell/portal-shell').then((m) => m.PortalShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/admin/dashboard/dashboard').then((m) => m.AdminDashboard),
      },
      { path: 'queue', redirectTo: 'leads', pathMatch: 'full' },
      {
        path: 'leads',
        loadComponent: () => import('./features/admin/leads/leads').then((m) => m.AdminLeads),
      },
      {
        path: 'charge-backs',
        loadComponent: () => import('./features/admin/charge-backs/charge-backs').then((m) => m.AdminChargeBacks),
      },
      {
        path: 'retention',
        loadComponent: () => import('./features/admin/retention/retention').then((m) => m.AdminRetention),
      },
      {
        path: 'retention-history',
        loadComponent: () =>
          import('./features/admin/retention-history/retention-history').then((m) => m.RetentionHistory),
      },
      { path: 'retention-leads', redirectTo: 'leads', pathMatch: 'full' },
      {
        path: 'cpl-leads',
        loadComponent: () => import('./features/admin/cpl-leads/cpl-leads').then((m) => m.AdminCplLeads),
      },
      {
        path: 'drafts',
        loadComponent: () => import('./features/admin/drafts/drafts').then((m) => m.AdminDrafts),
      },
      {
        path: 'clients',
        loadComponent: () => import('./features/admin/clients/clients').then((m) => m.AdminClients),
      },
      {
        path: 'team',
        loadComponent: () => import('./features/admin/team/team').then((m) => m.AdminTeam),
      },
      {
        path: 'external-clients',
        loadComponent: () =>
          import('./features/admin/external-clients/external-clients').then((m) => m.AdminExternalClients),
      },
      {
        path: 'state-sheet',
        loadComponent: () => import('./features/admin/state-sheet/state-sheet').then((m) => m.StateSheet),
      },
      {
        path: 'toolkit',
        loadComponent: () => import('./features/toolkit/toolkit').then((m) => m.Toolkit),
      },
      {
        path: 'expenses',
        loadComponent: () => import('./features/admin/expenses/expenses').then((m) => m.AdminExpenses),
      },
      {
        path: 'ip-whitelist',
        loadComponent: () => import('./features/admin/ip-whitelist/ip-whitelist').then((m) => m.AdminIpWhitelist),
      },
      {
        path: 'analytics/junior-closers',
        loadComponent: () => import('./features/admin/analytics-junior/analytics-junior').then((m) => m.AnalyticsJunior),
      },
      {
        path: 'analytics/junior-closers/:id',
        loadComponent: () => import('./features/admin/analytics-junior/junior-detail').then((m) => m.JuniorDetail),
      },
      {
        path: 'analytics/closers',
        loadComponent: () => import('./features/admin/analytics-closer/analytics-closer').then((m) => m.AnalyticsCloser),
      },
      {
        path: 'analytics/retention',
        loadComponent: () =>
          import('./features/admin/analytics-retention/analytics-retention').then((m) => m.AnalyticsRetention),
      },
      {
        path: 'analytics/clients',
        loadComponent: () => import('./features/admin/analytics-client/analytics-client').then((m) => m.AnalyticsClient),
      },
      {
        path: 'analytics/overall',
        loadComponent: () => import('./features/admin/analytics-overall/analytics-overall').then((m) => m.AnalyticsOverall),
      },
      // These two moved out of Analytics onto their own pages — keep old links working.
      { path: 'analytics/drafts', redirectTo: 'drafts', pathMatch: 'full' },
      { path: 'analytics/charge-backs', redirectTo: 'charge-backs', pathMatch: 'full' },
      {
        path: 'qa-reports/transfer-junior-closers',
        loadComponent: () =>
          import('./features/qa-reports/transfer-junior/transfer-junior').then((m) => m.QaTransferJunior),
      },
      {
        path: 'qa-reports/transfer-closers',
        loadComponent: () =>
          import('./features/qa-reports/transfer-closer/transfer-closer').then((m) => m.QaTransferCloser),
      },
      {
        path: 'qa-reports/live-call-junior-closers',
        loadComponent: () =>
          import('./features/qa-reports/live-call-junior/live-call-junior').then((m) => m.QaLiveCallJunior),
      },
      {
        path: 'qa-reports/live-call-closers',
        loadComponent: () =>
          import('./features/qa-reports/live-call-closer/live-call-closer').then((m) => m.QaLiveCallCloser),
      },
      {
        path: 'chat',
        loadComponent: () => import('./features/chat/chat').then((m) => m.Chat),
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
      },
    ],
  },

  // Reuses the same admin-page components as /admin above, minus Clients, Team, External
  // Clients, and Expenses — see nav-config.ts's MANAGER entry for the exact list this mirrors.
  {
    path: 'manager',
    canMatch: [authGuard, roleGuard('MANAGER')],
    loadComponent: () => import('./layout/portal-shell/portal-shell').then((m) => m.PortalShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/admin/dashboard/dashboard').then((m) => m.AdminDashboard),
      },
      { path: 'queue', redirectTo: 'leads', pathMatch: 'full' },
      {
        path: 'leads',
        loadComponent: () => import('./features/admin/leads/leads').then((m) => m.AdminLeads),
      },
      {
        path: 'charge-backs',
        loadComponent: () => import('./features/admin/charge-backs/charge-backs').then((m) => m.AdminChargeBacks),
      },
      {
        path: 'retention',
        loadComponent: () => import('./features/admin/retention/retention').then((m) => m.AdminRetention),
      },
      {
        path: 'retention-history',
        loadComponent: () =>
          import('./features/admin/retention-history/retention-history').then((m) => m.RetentionHistory),
      },
      { path: 'retention-leads', redirectTo: 'leads', pathMatch: 'full' },
      {
        path: 'cpl-leads',
        loadComponent: () => import('./features/admin/cpl-leads/cpl-leads').then((m) => m.AdminCplLeads),
      },
      {
        path: 'drafts',
        loadComponent: () => import('./features/admin/drafts/drafts').then((m) => m.AdminDrafts),
      },
      {
        path: 'state-sheet',
        loadComponent: () => import('./features/admin/state-sheet/state-sheet').then((m) => m.StateSheet),
      },
      {
        path: 'toolkit',
        loadComponent: () => import('./features/toolkit/toolkit').then((m) => m.Toolkit),
      },
      {
        path: 'analytics/junior-closers',
        loadComponent: () => import('./features/admin/analytics-junior/analytics-junior').then((m) => m.AnalyticsJunior),
      },
      {
        path: 'analytics/junior-closers/:id',
        loadComponent: () => import('./features/admin/analytics-junior/junior-detail').then((m) => m.JuniorDetail),
      },
      {
        path: 'analytics/closers',
        loadComponent: () => import('./features/admin/analytics-closer/analytics-closer').then((m) => m.AnalyticsCloser),
      },
      {
        path: 'analytics/retention',
        loadComponent: () =>
          import('./features/admin/analytics-retention/analytics-retention').then((m) => m.AnalyticsRetention),
      },
      {
        path: 'analytics/clients',
        loadComponent: () => import('./features/admin/analytics-client/analytics-client').then((m) => m.AnalyticsClient),
      },
      {
        path: 'analytics/overall',
        loadComponent: () => import('./features/admin/analytics-overall/analytics-overall').then((m) => m.AnalyticsOverall),
      },
      // These two moved out of Analytics onto their own pages — keep old links working.
      { path: 'analytics/drafts', redirectTo: 'drafts', pathMatch: 'full' },
      { path: 'analytics/charge-backs', redirectTo: 'charge-backs', pathMatch: 'full' },
      {
        path: 'qa-reports/transfer-junior-closers',
        loadComponent: () =>
          import('./features/qa-reports/transfer-junior/transfer-junior').then((m) => m.QaTransferJunior),
      },
      {
        path: 'qa-reports/transfer-closers',
        loadComponent: () =>
          import('./features/qa-reports/transfer-closer/transfer-closer').then((m) => m.QaTransferCloser),
      },
      {
        path: 'qa-reports/live-call-junior-closers',
        loadComponent: () =>
          import('./features/qa-reports/live-call-junior/live-call-junior').then((m) => m.QaLiveCallJunior),
      },
      {
        path: 'qa-reports/live-call-closers',
        loadComponent: () =>
          import('./features/qa-reports/live-call-closer/live-call-closer').then((m) => m.QaLiveCallCloser),
      },
      {
        path: 'chat',
        loadComponent: () => import('./features/chat/chat').then((m) => m.Chat),
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
      },
      // Excluded from this role — redirect stray bookmarks/links rather than 404ing.
      { path: 'clients', redirectTo: 'dashboard' },
      { path: 'team', redirectTo: 'dashboard' },
      { path: 'external-clients', redirectTo: 'dashboard' },
      { path: 'expenses', redirectTo: 'dashboard' },
      { path: 'ip-whitelist', redirectTo: 'dashboard' },
    ],
  },

  {
    path: 'client',
    canMatch: [authGuard, roleGuard('CLIENT')],
    loadComponent: () => import('./layout/portal-shell/portal-shell').then((m) => m.PortalShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'chat',
        loadComponent: () => import('./features/chat/chat').then((m) => m.Chat),
      },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/client/dashboard/dashboard').then((m) => m.ClientDashboard),
      },
      // Old URLs (bookmarks, dashboard links) land on the renamed pages.
      { path: 'new-leads', redirectTo: 'cpa-leads' },
      { path: 'lead-history', redirectTo: 'cpa-leads' },
      { path: 'cpl-history', redirectTo: 'cpl-leads' },
      {
        path: 'cpa-leads',
        data: { kind: 'CPA' },
        loadComponent: () => import('./features/client/lead-history/lead-history').then((m) => m.ClientLeadHistory),
      },
      {
        path: 'cpl-leads',
        data: { kind: 'CPL' },
        loadComponent: () => import('./features/client/lead-history/lead-history').then((m) => m.ClientLeadHistory),
      },
      // Settings removed from this portal's nav — redirect stray bookmarks/links rather
      // than letting them 404 all the way out to the public marketing site.
      { path: 'settings', redirectTo: 'dashboard' },
    ],
  },

  {
    path: 'team-lead',
    canMatch: [authGuard, roleGuard('TEAM_LEAD')],
    loadComponent: () => import('./layout/portal-shell/portal-shell').then((m) => m.PortalShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/team-lead/dashboard/dashboard').then((m) => m.TeamLeadDashboard),
      },
      {
        path: 'submitted-leads',
        loadComponent: () =>
          import('./features/team-lead/submitted-leads/submitted-leads').then((m) => m.TeamLeadSubmittedLeads),
      },
      {
        path: 'analytics/junior-closers',
        loadComponent: () => import('./features/admin/analytics-junior/analytics-junior').then((m) => m.AnalyticsJunior),
      },
      {
        path: 'analytics/junior-closers/:id',
        loadComponent: () => import('./features/admin/analytics-junior/junior-detail').then((m) => m.JuniorDetail),
      },
      {
        path: 'qa-reports/transfer-junior-closers',
        loadComponent: () =>
          import('./features/qa-reports/transfer-junior/transfer-junior').then((m) => m.QaTransferJunior),
      },
      {
        path: 'qa-reports/live-call-junior-closers',
        loadComponent: () =>
          import('./features/qa-reports/live-call-junior/live-call-junior').then((m) => m.QaLiveCallJunior),
      },
      {
        path: 'chat',
        loadComponent: () => import('./features/chat/chat').then((m) => m.Chat),
      },
      // Removed from this portal's nav — Closer oversight (State Sheet, Closer analytics/QA)
      // and Settings — redirect stray bookmarks/links rather than letting them 404 all the
      // way out to the public marketing site.
      { path: 'state-sheet', redirectTo: 'dashboard' },
      { path: 'analytics/closers', redirectTo: 'dashboard' },
      { path: 'qa-reports/transfer-closers', redirectTo: 'dashboard' },
      { path: 'qa-reports/live-call-closers', redirectTo: 'dashboard' },
      { path: 'settings', redirectTo: 'dashboard' },
    ],
  },

  {
    path: 'qa-junior',
    canMatch: [authGuard, roleGuard('QA_JUNIOR_CLOSER')],
    loadComponent: () => import('./layout/portal-shell/portal-shell').then((m) => m.PortalShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'review-queue' },
      {
        path: 'chat',
        loadComponent: () => import('./features/chat/chat').then((m) => m.Chat),
      },
      {
        path: 'review-queue',
        loadComponent: () => import('./features/qa/review-queue/review-queue').then((m) => m.QaReviewQueue),
      },
      {
        path: 'review-history',
        loadComponent: () => import('./features/qa/review-history/review-history').then((m) => m.QaReviewHistory),
      },
      {
        path: 'write-review',
        loadComponent: () => import('./features/qa/write-review/write-review').then((m) => m.QaWriteReview),
      },
      // Settings removed from this portal's nav — redirect stray bookmarks/links rather
      // than letting them 404 all the way out to the public marketing site.
      { path: 'settings', redirectTo: 'review-queue' },
    ],
  },

  {
    path: 'qa-closer',
    canMatch: [authGuard, roleGuard('QA_CLOSER')],
    loadComponent: () => import('./layout/portal-shell/portal-shell').then((m) => m.PortalShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'review-queue' },
      {
        path: 'chat',
        loadComponent: () => import('./features/chat/chat').then((m) => m.Chat),
      },
      {
        path: 'review-queue',
        loadComponent: () => import('./features/qa/review-queue/review-queue').then((m) => m.QaReviewQueue),
      },
      {
        path: 'review-history',
        loadComponent: () => import('./features/qa/review-history/review-history').then((m) => m.QaReviewHistory),
      },
      {
        path: 'write-review',
        loadComponent: () => import('./features/qa/write-review/write-review').then((m) => m.QaWriteReview),
      },
      {
        path: 'toolkit',
        loadComponent: () => import('./features/toolkit/toolkit').then((m) => m.Toolkit),
      },
      // Settings removed from this portal's nav — redirect stray bookmarks/links rather
      // than letting them 404 all the way out to the public marketing site.
      { path: 'settings', redirectTo: 'review-queue' },
    ],
  },

  {
    path: 'retention',
    canMatch: [authGuard, roleGuard('RETENTION')],
    loadComponent: () => import('./layout/portal-shell/portal-shell').then((m) => m.PortalShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/retention/dashboard/dashboard').then((m) => m.RetentionDashboard),
      },
      {
        path: 'new-lead',
        loadComponent: () => import('./features/retention/new-lead/new-lead').then((m) => m.RetentionNewLead),
      },
      {
        path: 'leads',
        loadComponent: () => import('./features/retention/leads/leads').then((m) => m.RetentionLeads),
      },
      {
        path: 'leads/:id',
        loadComponent: () => import('./features/retention/lead-edit/lead-edit').then((m) => m.RetentionLeadEdit),
      },
      { path: 'queue', redirectTo: 'leads', pathMatch: 'full' },
      {
        path: 'history',
        loadComponent: () => import('./features/retention/history/history').then((m) => m.RetentionHistory),
      },
      {
        path: 'state-sheet',
        loadComponent: () => import('./features/admin/state-sheet/state-sheet').then((m) => m.StateSheet),
      },
      {
        path: 'chat',
        loadComponent: () => import('./features/chat/chat').then((m) => m.Chat),
      },
      // Settings removed from this portal's nav — redirect stray bookmarks/links rather
      // than letting them 404 all the way out to the public marketing site.
      { path: 'settings', redirectTo: 'dashboard' },
    ],
  },

  { path: '**', redirectTo: '' },
];
