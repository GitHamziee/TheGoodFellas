import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LeadService, JuniorLeadInput } from '../../../core/services/lead.service';
import { UserService } from '../../../core/services/user.service';
import { NEED_OPTIONS, INCOME_SOURCE_OPTIONS, RETIRED_INCOME_OPTIONS } from '../../../core/lead-options';

@Component({
  selector: 'app-submit-lead',
  imports: [FormsModule],
  templateUrl: './submit-lead.html',
  styleUrl: '../../shared-page.css',
})
export class SubmitLead implements OnInit {
  private readonly leadService = inject(LeadService);
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);

  closers = signal<{ id: string; name: string; email: string }[]>([]);
  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);

  readonly needOptions = NEED_OPTIONS;
  readonly incomeSourceOptions = INCOME_SOURCE_OPTIONS;
  readonly retiredIncomeOptions = RETIRED_INCOME_OPTIONS;
  readonly maritalStatusOptions = ['Single', 'Married', 'Divorced', 'Widowed'];

  form: JuniorLeadInput & { smoker?: boolean | 'true' | 'false' } = { closerId: '' };

  async ngOnInit(): Promise<void> {
    this.closers.set(await this.userService.listClosers());
  }

  async submit(): Promise<void> {
    this.error.set(null);
    this.submitting.set(true);
    try {
      await this.leadService.submitLead({ ...this.form } as JuniorLeadInput);
      this.router.navigateByUrl('/junior/my-leads');
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Failed to submit lead');
    } finally {
      this.submitting.set(false);
    }
  }
}
