import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { LeadService, CloserLeadInput } from '../../../core/services/lead.service';
import { Lead } from '../../../core/models/lead.model';
import { ACCOUNT_TYPE_OPTIONS, PAYER_OPTIONS } from '../../../core/lead-options';

@Component({
  selector: 'app-enrich-lead',
  imports: [FormsModule],
  templateUrl: './enrich-lead.html',
  styleUrl: '../../shared-page.css',
})
export class EnrichLead implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly leadService = inject(LeadService);

  readonly leadId = this.route.snapshot.paramMap.get('id')!;
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);

  readonly accountTypeOptions = ACCOUNT_TYPE_OPTIONS;
  readonly payerOptions = PAYER_OPTIONS;

  form: CloserLeadInput = {};

  async ngOnInit(): Promise<void> {
    try {
      const lead: Lead = await this.leadService.getLead(this.leadId);
      this.form = {
        customerName: lead.customerName,
        maritalStatus: lead.maritalStatus ?? undefined,
        phone: lead.phone,
        state: lead.state,
        zipcode: lead.zipcode ?? undefined,
        birthState: lead.birthState ?? undefined,
        smoker: lead.smoker ?? undefined,
        dob: lead.dob ? lead.dob.substring(0, 10) : undefined,
        age: lead.age ?? undefined,
        height: lead.height ?? undefined,
        weight: lead.weight ?? undefined,
        healthConditions: lead.healthConditions ?? undefined,
      };
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Failed to load lead');
    } finally {
      this.loading.set(false);
    }
  }

  async submit(): Promise<void> {
    this.error.set(null);
    this.submitting.set(true);
    try {
      await this.leadService.enrichLead(this.leadId, this.form);
      this.router.navigateByUrl('/closer/inbox');
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Failed to submit lead');
    } finally {
      this.submitting.set(false);
    }
  }
}
