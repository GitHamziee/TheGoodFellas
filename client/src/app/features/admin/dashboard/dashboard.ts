import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LeadService } from '../../../core/services/lead.service';
import { Lead } from '../../../core/models/lead.model';

@Component({
  selector: 'app-admin-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: '../../shared-page.css',
})
export class AdminDashboard implements OnInit {
  private readonly leadService = inject(LeadService);

  readonly leads = signal<Lead[]>([]);
  readonly loading = signal(true);

  readonly queueCount = computed(() => this.leads().filter((l) => l.status === 'SUBMITTED' || l.status === 'REJECTED').length);
  readonly assignedCount = computed(() => this.leads().filter((l) => l.status === 'ASSIGNED').length);
  readonly acceptedCount = computed(() => this.leads().filter((l) => l.status === 'ACCEPTED').length);

  async ngOnInit(): Promise<void> {
    this.leads.set(await this.leadService.allLeads());
    this.loading.set(false);
  }
}
