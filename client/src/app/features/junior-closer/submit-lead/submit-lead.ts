import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  LucideArrowLeft,
  LucideCircleAlert,
  LucideHeartPulse,
  LucideNotebookPen,
  LucideSend,
  LucideUser,
  LucideUsers,
  LucideWallet,
} from '@lucide/angular';
import { JuniorLeadInput, LeadService } from '../../../core/services/lead.service';
import { UserService } from '../../../core/services/user.service';
import {
  INCOME_SOURCE_OPTIONS,
  NEED_OPTIONS,
  RETIRED_INCOME_OPTIONS,
} from '../../../core/lead-options';
import { getAvatarTone, getInitials } from '../../../core/format-utils';

interface LookupUser {
  id: string;
  name: string;
  email: string;
}

@Component({
  selector: 'app-submit-lead',
  imports: [
    FormsModule,
    RouterLink,
    LucideSend,
    LucideUser,
    LucideUsers,
    LucideHeartPulse,
    LucideWallet,
    LucideNotebookPen,
    LucideCircleAlert,
    LucideArrowLeft,
  ],
  templateUrl: './submit-lead.html',
})
export class SubmitLead implements OnInit {
  private readonly leadService = inject(LeadService);
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);

  readonly closers = signal<LookupUser[]>([]);
  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);
  /** Set once the user tries to submit, so errors don't shout at an untouched form. */
  readonly showErrors = signal(false);

  readonly needOptions = NEED_OPTIONS;
  readonly incomeSourceOptions = INCOME_SOURCE_OPTIONS;
  readonly retiredIncomeOptions = RETIRED_INCOME_OPTIONS;
  readonly maritalStatusOptions = ['Single', 'Married', 'Divorced', 'Widowed'];

  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;

  form: JuniorLeadInput = { closerId: '' };
  /** Mirrors form.closerId — kept as a signal so the picker highlight is reactive. */
  readonly closerId = signal('');

  readonly missing = computed(() => {
    const f = this.form;
    const missing: string[] = [];
    if (!this.closerId()) missing.push('Closer');
    if (!f.customerName?.trim()) missing.push("Customer's name");
    if (!f.phone?.trim()) missing.push('Phone number');
    if (!f.state?.trim()) missing.push('State');
    return missing;
  });

  readonly canSubmit = computed(() => this.missing().length === 0 && !this.submitting());

  async ngOnInit(): Promise<void> {
    try {
      this.closers.set(await this.userService.listClosers());
    } catch {
      this.error.set('Could not load the closer list. Refresh to try again.');
    }
  }

  chooseCloser(id: string): void {
    this.closerId.set(id);
    this.form.closerId = id;
  }

  /** Signals feed off `form`, which template-driven bindings mutate in place. */
  touch(): void {
    if (this.showErrors()) this.showErrors.set(true);
  }

  async submit(): Promise<void> {
    this.showErrors.set(true);
    if (this.missing().length > 0) {
      this.error.set(`Still needed: ${this.missing().join(', ')}.`);
      return;
    }

    this.error.set(null);
    this.submitting.set(true);
    try {
      // Blank optional selects come through as '' — strip them so the API sees absent, not empty.
      const payload = Object.fromEntries(
        Object.entries({ ...this.form, closerId: this.closerId() }).filter(
          ([, v]) => v !== '' && v !== null && v !== undefined,
        ),
      ) as JuniorLeadInput;
      await this.leadService.submitLead(payload);
      this.router.navigateByUrl('/junior/my-leads');
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not submit the lead.');
    } finally {
      this.submitting.set(false);
    }
  }
}
