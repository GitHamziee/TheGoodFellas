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
  {
    path: 'register',
    loadComponent: () => import('./features/auth/register/register').then((m) => m.Register),
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
        path: 'chat',
        loadComponent: () => import('./features/chat/chat').then((m) => m.Chat),
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
      },
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
        path: 'leads/:id',
        loadComponent: () => import('./features/closer/enrich-lead/enrich-lead').then((m) => m.EnrichLead),
      },
      {
        path: 'history',
        loadComponent: () => import('./features/closer/history/history').then((m) => m.CloserHistory),
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
      {
        path: 'queue',
        loadComponent: () => import('./features/admin/queue/queue').then((m) => m.AdminQueue),
      },
      {
        path: 'leads',
        loadComponent: () => import('./features/admin/leads/leads').then((m) => m.AdminLeads),
      },
      {
        path: 'users',
        loadComponent: () => import('./features/admin/users/users').then((m) => m.AdminUsers),
      },
      {
        path: 'analytics/junior-closers',
        loadComponent: () => import('./features/admin/analytics-junior/analytics-junior').then((m) => m.AnalyticsJunior),
      },
      {
        path: 'analytics/closers',
        loadComponent: () => import('./features/admin/analytics-closer/analytics-closer').then((m) => m.AnalyticsCloser),
      },
      {
        path: 'analytics/overall',
        loadComponent: () => import('./features/admin/analytics-overall/analytics-overall').then((m) => m.AnalyticsOverall),
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

  {
    path: 'client',
    canMatch: [authGuard, roleGuard('CLIENT')],
    loadComponent: () => import('./layout/portal-shell/portal-shell').then((m) => m.PortalShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/client/dashboard/dashboard').then((m) => m.ClientDashboard),
      },
      {
        path: 'new-leads',
        loadComponent: () => import('./features/client/assigned-leads/assigned-leads').then((m) => m.AssignedLeads),
      },
      {
        path: 'lead-history',
        loadComponent: () => import('./features/client/lead-history/lead-history').then((m) => m.ClientLeadHistory),
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
      },
    ],
  },

  { path: '**', redirectTo: '' },
];
