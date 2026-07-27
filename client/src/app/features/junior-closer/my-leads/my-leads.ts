import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { LeadService } from '../../../core/services/lead.service';
import { LeadHistoryRow } from '../../../core/models/lead.model';
import { statusBadgeClass } from '../../../core/lead-status';

@Component({
  selector: 'app-my-leads',
  imports: [DatePipe],
  templateUrl: './my-leads.html',
  styleUrl: '../../shared-page.css',
})
export class MyLeads implements OnInit {
  private readonly leadService = inject(LeadService);

  readonly leads = signal<LeadHistoryRow[]>([]);
  readonly loading = signal(true);
  readonly statusBadgeClass = statusBadgeClass;

  async ngOnInit(): Promise<void> {
    this.leads.set(await this.leadService.myLeads());
    this.loading.set(false);
  }
}
