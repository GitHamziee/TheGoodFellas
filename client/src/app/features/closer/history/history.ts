import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { LeadService } from '../../../core/services/lead.service';
import { LeadHistoryRow } from '../../../core/models/lead.model';
import { statusBadgeClass } from '../../../core/lead-status';

@Component({
  selector: 'app-closer-history',
  imports: [DatePipe],
  templateUrl: './history.html',
  styleUrl: '../../shared-page.css',
})
export class CloserHistory implements OnInit {
  private readonly leadService = inject(LeadService);

  readonly leads = signal<LeadHistoryRow[]>([]);
  readonly loading = signal(true);
  readonly statusBadgeClass = statusBadgeClass;

  async ngOnInit(): Promise<void> {
    this.leads.set(await this.leadService.closerHistory());
    this.loading.set(false);
  }
}
