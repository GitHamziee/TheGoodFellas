import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { LeadService } from '../../../core/services/lead.service';
import { Lead } from '../../../core/models/lead.model';

@Component({
  selector: 'app-client-lead-history',
  imports: [DatePipe],
  templateUrl: './lead-history.html',
  styleUrl: '../../shared-page.css',
})
export class ClientLeadHistory implements OnInit {
  private readonly leadService = inject(LeadService);

  readonly leads = signal<Lead[]>([]);
  readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    this.leads.set(await this.leadService.clientHistory());
    this.loading.set(false);
  }
}
