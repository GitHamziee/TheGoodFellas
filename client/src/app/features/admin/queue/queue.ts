import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LeadService } from '../../../core/services/lead.service';
import { UserService } from '../../../core/services/user.service';
import { Lead } from '../../../core/models/lead.model';
import { statusBadgeClass } from '../../../core/lead-status';

@Component({
  selector: 'app-admin-queue',
  imports: [FormsModule],
  templateUrl: './queue.html',
  styleUrl: '../../shared-page.css',
})
export class AdminQueue implements OnInit {
  private readonly leadService = inject(LeadService);
  private readonly userService = inject(UserService);

  readonly leads = signal<Lead[]>([]);
  readonly clients = signal<{ id: string; name: string; email: string }[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);
  readonly statusBadgeClass = statusBadgeClass;

  clientChoice: Record<string, string> = {};
  editDraft: Record<string, { customerName: string; phone: string }> = {};

  async ngOnInit(): Promise<void> {
    this.clients.set(await this.userService.listClients());
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.leads.set(await this.leadService.queue());
    this.loading.set(false);
  }

  draftFor(lead: Lead) {
    if (!this.editDraft[lead.id]) {
      this.editDraft[lead.id] = { customerName: lead.customerName, phone: lead.phone };
    }
    return this.editDraft[lead.id];
  }

  async saveEdit(lead: Lead): Promise<void> {
    this.error.set(null);
    this.busyId.set(lead.id);
    try {
      const draft = this.editDraft[lead.id];
      await this.leadService.editLead(lead.id, { customerName: draft.customerName, phone: draft.phone });
      await this.refresh();
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Failed to update lead');
    } finally {
      this.busyId.set(null);
    }
  }

  async assign(lead: Lead): Promise<void> {
    this.error.set(null);
    const clientId = this.clientChoice[lead.id];
    if (!clientId) {
      this.error.set('Select a client first');
      return;
    }
    this.busyId.set(lead.id);
    try {
      await this.leadService.assignLead(lead.id, clientId);
      await this.refresh();
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Failed to assign lead');
    } finally {
      this.busyId.set(null);
    }
  }
}
