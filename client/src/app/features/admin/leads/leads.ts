import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { LeadService } from '../../../core/services/lead.service';
import { Lead, PaymentStatus } from '../../../core/models/lead.model';
import { statusBadgeClass } from '../../../core/lead-status';

@Component({
  selector: 'app-admin-leads',
  imports: [DatePipe],
  templateUrl: './leads.html',
  styleUrl: '../../shared-page.css',
})
export class AdminLeads implements OnInit {
  private readonly leadService = inject(LeadService);

  readonly leads = signal<Lead[]>([]);
  readonly loading = signal(true);
  readonly busyId = signal<string | null>(null);
  readonly statusBadgeClass = statusBadgeClass;

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.leads.set(await this.leadService.allLeads());
    this.loading.set(false);
  }

  async togglePayment(lead: Lead): Promise<void> {
    const next: PaymentStatus = lead.paymentStatus === 'PAID' ? 'UNPAID' : 'PAID';
    this.busyId.set(lead.id);
    try {
      await this.leadService.setPaymentStatus(lead.id, next);
      await this.refresh();
    } finally {
      this.busyId.set(null);
    }
  }
}
