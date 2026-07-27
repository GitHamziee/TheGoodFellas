import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LeadService } from '../../../core/services/lead.service';
import { LeadHistoryRow } from '../../../core/models/lead.model';

@Component({
  selector: 'app-junior-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: '../../shared-page.css',
})
export class JuniorDashboard implements OnInit {
  private readonly leadService = inject(LeadService);

  readonly leads = signal<LeadHistoryRow[]>([]);
  readonly loading = signal(true);

  readonly total = computed(() => this.leads().length);
  readonly awaitingCloser = computed(() => this.leads().filter((l) => l.status === 'NEW').length);
  readonly inAdminQueue = computed(() => this.leads().filter((l) => l.status === 'SUBMITTED' || l.status === 'REJECTED').length);
  readonly resolved = computed(() => this.leads().filter((l) => l.status === 'ASSIGNED' || l.status === 'ACCEPTED').length);

  async ngOnInit(): Promise<void> {
    this.leads.set(await this.leadService.myLeads());
    this.loading.set(false);
  }
}
