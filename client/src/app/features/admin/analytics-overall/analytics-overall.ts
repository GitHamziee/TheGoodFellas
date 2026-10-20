import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LucideChartColumn } from '@lucide/angular';
import {
  AnalyticsService,
  OverallAnalytics as OverallAnalyticsData,
} from '../../../core/services/analytics.service';
import { LeadStatus, LeadType } from '../../../core/models/lead.model';
import { Role } from '../../../core/models/user.model';
import { EmptyState, SkeletonRows } from '../../../shared/ui/ui';
import { reloadOnChange } from '../../../core/live-reload';
import { bucketIndex, lastWeeks } from '../../qa-reports/qa-stats';

type Period = '7' | '30' | '90' | 'all';
type Source = '' | LeadType;

const DAY = 86400000;
const WEEKS = 12;

const PERIODS: { label: string; value: Period }[] = [
  { label: '7d', value: '7' },
  { label: '30d', value: '30' },
  { label: '90d', value: '90' },
  { label: 'All', value: 'all' },
];

const SOURCES: { label: string; value: LeadType; cls: string }[] = [
  { label: 'CPA', value: 'CPA', cls: 'src--cpa' },
  { label: 'CPL', value: 'CPL', cls: 'src--cpl' },
  { label: 'Retention', value: 'RETENTION', cls: 'src--ret' },
];

/**
 * Every status lands in exactly one stage, so the stages always sum to the lead total — the
 * old flat status list skipped drafts, sent-back and charged-back leads and didn't add up.
 */
const STAGES: { key: string; label: string; cls: string; parts: { status: LeadStatus; label: string }[] }[] = [
  {
    key: 'progress',
    label: 'In progress',
    cls: 'stage--idle',
    parts: [
      { status: 'NEW', label: 'new' },
      { status: 'DRAFT', label: 'drafts' },
      { status: 'RETURNED_TO_JUNIOR', label: 'sent back' },
      { status: 'RETURNED_TO_CLOSER', label: 'sent back' },
      { status: 'RETURNED_TO_RETENTION', label: 'sent back' },
    ],
  },
  {
    key: 'admin',
    label: 'With admin',
    cls: 'stage--wait',
    parts: [
      { status: 'SUBMITTED', label: 'to assign' },
      { status: 'REJECTED', label: 'declined, to fix' },
    ],
  },
  {
    key: 'client',
    label: 'With client',
    cls: 'stage--wait',
    parts: [
      { status: 'ASSIGNED', label: 'assigned' },
      { status: 'ASSIGNED_EXTERNAL', label: 'external' },
    ],
  },
  { key: 'approved', label: 'Approved', cls: 'stage--good', parts: [{ status: 'ACCEPTED', label: 'approved' }] },
  { key: 'cb', label: 'Charged back', cls: 'stage--bad', parts: [{ status: 'CHARGED_BACK', label: 'charged back' }] },
];

const TEAM: { label: string; roles: Role[] }[] = [
  { label: 'Junior Closers', roles: ['JUNIOR_CLOSER'] },
  { label: 'Closers', roles: ['CLOSER'] },
  { label: 'Team Leads', roles: ['TEAM_LEAD'] },
  { label: 'Retention', roles: ['RETENTION'] },
  { label: 'QA', roles: ['QA_JUNIOR_CLOSER', 'QA_CLOSER'] },
  { label: 'Admin & Manager', roles: ['ADMIN', 'MANAGER'] },
  { label: 'Clients', roles: ['CLIENT'] },
];

interface Span {
  start: number | null;
  end: number;
}

type LeadRow = OverallAnalyticsData['leads'][number];

function inSpan(iso: string, span: Span | null): boolean {
  if (!span) return true;
  const t = new Date(iso).getTime();
  return (span.start === null || t >= span.start) && t < span.end;
}

function outcomes(rows: LeadRow[]) {
  const approved = rows.filter((l) => l.status === 'ACCEPTED' || l.status === 'CHARGED_BACK').length;
  const declined = rows.filter((l) => l.status === 'REJECTED').length;
  return {
    leads: rows.length,
    approved,
    declined,
    rate: approved + declined ? Math.round((approved / (approved + declined)) * 100) : null,
  };
}

/**
 * Overall analytics — is volume growing, are we converting, which source performs, and are
 * we collecting. Period + source scope the KPIs, weekly chart and source table; "Where leads
 * are now" is always the live pipeline. Built from one light row per lead, sliced in memory.
 * Approved counts include leads later charged back (they were approved first).
 */
@Component({
  selector: 'app-analytics-overall',
  imports: [RouterLink, EmptyState, SkeletonRows, LucideChartColumn],
  templateUrl: './analytics-overall.html',
  styleUrl: './analytics-overall.css',
})
export class AnalyticsOverall implements OnInit {
  private readonly liveReload = reloadOnChange(() => this.ngOnInit());
  private readonly analyticsService = inject(AnalyticsService);
  private readonly router = inject(Router);

  readonly overall = signal<OverallAnalyticsData | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly period = signal<Period>('30');
  readonly source = signal<Source>('');
  readonly periods = PERIODS;
  readonly sources = SOURCES;

  /** Admin and Manager both mount this page; Team exists only in the admin portal. */
  readonly isAdmin = this.router.url.startsWith('/admin');

  private readonly span = computed<Span | null>(() => {
    const p = this.period();
    if (p === 'all') return null;
    const end = Date.now();
    return { start: end - Number(p) * DAY, end };
  });

  private readonly priorSpan = computed<Span | null>(() => {
    const s = this.span();
    return s && s.start !== null ? { start: s.start - (s.end - s.start), end: s.start } : null;
  });

  readonly priorLabel = computed(() => (this.period() === 'all' ? '' : `vs prior ${this.period()}d`));

  /** All leads of the chosen source, any date. */
  private readonly sourceLeads = computed(() => {
    const src = this.source();
    return (this.overall()?.leads ?? []).filter((l) => !src || l.leadType === src);
  });

  private readonly sourceChargeBacks = computed(() => {
    const src = this.source();
    return (this.overall()?.chargeBacks ?? []).filter((c) => !src || c.leadType === src);
  });

  readonly kpis = computed(() => {
    const span = this.span();
    const prior = this.priorSpan();
    const all = this.sourceLeads();
    const now = outcomes(all.filter((l) => inSpan(l.createdAt, span)));
    const before = prior ? outcomes(all.filter((l) => inSpan(l.createdAt, prior))) : null;
    const cbNow = this.sourceChargeBacks().filter((c) => inSpan(c.createdAt, span)).length;
    const cbBefore = prior ? this.sourceChargeBacks().filter((c) => inSpan(c.createdAt, prior)).length : null;
    const accepted = all.filter((l) => l.status === 'ACCEPTED');
    const unpaid = accepted.filter((l) => l.paymentStatus === 'UNPAID').length;
    return {
      leads: now.leads,
      leadsDelta: this.delta(before ? now.leads - before.leads : null),
      rate: now.rate,
      rateTone: now.rate === null ? '' : now.rate >= 80 ? 'good' : now.rate >= 65 ? 'mid' : 'bad',
      rateDelta: this.delta(now.rate !== null && before?.rate != null ? now.rate - before.rate : null, ' pts'),
      approved: now.approved,
      approvedDelta: this.delta(before ? now.approved - before.approved : null),
      unpaid,
      collected: accepted.length ? Math.round(((accepted.length - unpaid) / accepted.length) * 100) : null,
      chargeBacks: cbNow,
      cbDelta: this.delta(cbBefore === null ? null : cbNow - cbBefore, '', false),
    };
  });

  /** Leads created per week (last 12), stacked by source. Ignores the period on purpose. */
  readonly weeks = computed(() => {
    const weeks = lastWeeks(WEEKS);
    const rows = weeks.map((w) => ({ label: w.label, CPA: 0, CPL: 0, RETENTION: 0, total: 0 }));
    for (const l of this.sourceLeads()) {
      const i = bucketIndex(l.createdAt, weeks);
      if (i < 0) continue;
      rows[i][l.leadType] += 1;
      rows[i].total += 1;
    }
    const max = Math.max(1, ...rows.map((r) => r.total));
    return rows.map((r) => ({
      ...r,
      heightPct: (r.total / max) * 100,
      segs: SOURCES.filter((s) => r[s.value] > 0).map((s) => ({ cls: s.cls, pct: (r[s.value] / (r.total || 1)) * 100 })),
      title: `${r.label}: ${SOURCES.map((s) => `${r[s.value]} ${s.label}`).join(', ')}`,
    }));
  });

  /** The live pipeline — every lead in exactly one stage. */
  readonly stages = computed(() => {
    const leads = this.sourceLeads();
    const count = (s: LeadStatus) => leads.filter((l) => l.status === s).length;
    const rows = STAGES.map((stage) => {
      // Merge parts sharing a label (the three "sent back" statuses) for the detail line.
      const byLabel = new Map<string, number>();
      for (const p of stage.parts) byLabel.set(p.label, (byLabel.get(p.label) ?? 0) + count(p.status));
      const n = [...byLabel.values()].reduce((a, b) => a + b, 0);
      let detail = [...byLabel].filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(' · ');
      if (stage.key === 'approved') {
        const paid = leads.filter((l) => l.status === 'ACCEPTED' && l.paymentStatus === 'PAID').length;
        detail = `${paid} paid · ${n - paid} to collect`;
      }
      return { ...stage, n, detail };
    });
    const max = Math.max(1, ...rows.map((r) => r.n));
    return rows.map((r) => ({ ...r, pct: (r.n / max) * 100 }));
  });

  readonly totalLeads = computed(() => this.sourceLeads().length);

  /** Per-source performance for the period (all three rows regardless of the source filter;
   * the unselected ones are dimmed). */
  readonly bySource = computed(() => {
    const span = this.span();
    const leads = this.overall()?.leads ?? [];
    const cbs = this.overall()?.chargeBacks ?? [];
    return SOURCES.map((s) => {
      const inPeriod = leads.filter((l) => l.leadType === s.value && inSpan(l.createdAt, span));
      const o = outcomes(inPeriod);
      // Same cohort as the other columns, so "paid of approved" never exceeds "approved".
      const accepted = inPeriod.filter((l) => l.status === 'ACCEPTED');
      return {
        ...s,
        ...o,
        rateTone: o.rate === null ? '' : o.rate >= 80 ? 'good' : o.rate >= 65 ? 'mid' : 'bad',
        paid: accepted.filter((l) => l.paymentStatus === 'PAID').length,
        acceptedNow: accepted.length,
        chargeBacks: cbs.filter((c) => c.leadType === s.value && inSpan(c.createdAt, span)).length,
      };
    });
  });

  readonly team = computed(() => {
    const counts = this.overall()?.roleCounts ?? {};
    return TEAM.map((t) => ({ label: t.label, n: t.roles.reduce((sum, r) => sum + (counts[r] ?? 0), 0) }));
  });

  async ngOnInit(): Promise<void> {
    try {
      this.overall.set(await this.analyticsService.overall());
    } catch {
      this.error.set('Could not load analytics. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  /** ▲/▼ chip; `upIsGood` false for charge-backs. */
  private delta(d: number | null, unit = '', upIsGood = true): { text: string; cls: string } | null {
    if (d === null) return null;
    if (d === 0) return { text: 'No change', cls: 'delta' };
    const good = d > 0 === upIsGood;
    return { text: `${d > 0 ? '▲' : '▼'} ${Math.abs(d)}${unit}`, cls: good ? 'delta delta--up' : 'delta delta--down' };
  }
}
