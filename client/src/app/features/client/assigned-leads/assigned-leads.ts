import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LeadService } from '../../../core/services/lead.service';
import { LeadPreview } from '../../../core/models/lead.model';

@Component({
  selector: 'app-assigned-leads',
  imports: [FormsModule],
  templateUrl: './assigned-leads.html',
  styleUrl: '../../shared-page.css',
})
export class AssignedLeads implements OnInit {
  private readonly leadService = inject(LeadService);

  readonly leads = signal<LeadPreview[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);

  rejectReasonDraft: Record<string, string> = {};

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.leads.set(await this.leadService.assignedPreviews());
    this.loading.set(false);
  }

  async accept(leadId: string): Promise<void> {
    this.error.set(null);
    this.busyId.set(leadId);
    try {
      await this.leadService.acceptLead(leadId);
      await this.refresh();
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Failed to accept lead');
    } finally {
      this.busyId.set(null);
    }
  }

  async reject(leadId: string): Promise<void> {
    this.error.set(null);
    this.busyId.set(leadId);
    try {
      await this.leadService.rejectLead(leadId, this.rejectReasonDraft[leadId] || undefined);
      await this.refresh();
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Failed to reject lead');
    } finally {
      this.busyId.set(null);
    }
  }
}
