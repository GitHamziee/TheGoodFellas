import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  LucideArrowRight,
  LucideCheck,
  LucideMail,
  LucideMapPin,
  LucideMessageSquare,
  LucidePhoneForwarded,
  LucideSend,
  LucideSparkles,
} from '@lucide/angular';
import { Reveal } from '../../../shared/reveal.directive';
import { Select } from '../../../shared/ui/select';
import { PhoneInput } from '../../../shared/ui/phone-input';

@Component({
  selector: 'app-contact',
  imports: [PhoneInput, 
    FormsModule,
    RouterLink,
    Reveal,
    Select,
    LucideArrowRight,
    LucideCheck,
    LucideMail,
    LucideMapPin,
    LucideMessageSquare,
    LucidePhoneForwarded,
    LucideSend,
    LucideSparkles,
  ],
  templateUrl: './contact.html',
})
export class Contact {
  name = '';
  company = '';
  email = '';
  phone = '';
  vertical = '';
  states = '';
  volume = '';
  message = '';

  readonly submitted = signal(false);

  /** Mirrors the four live-transfer lines the site sells. */
  readonly verticals = ['Final Expense', 'Medicare', 'Health Insurance', 'Auto Insurance', 'More than one'];

  readonly volumes = ['1–10 / day', '10–25 / day', '25–50 / day', '50+ / day', 'Not sure yet'];

  readonly verticalOptions = this.verticals.map((v) => ({ value: v, label: v }));
  readonly volumeOptions = this.volumes.map((v) => ({ value: v, label: v }));

  /** Enough to scope a campaign — everything else can come on the call. */
  readonly required = computed(() => ({
    name: this.name.trim().length > 0,
    email: this.email.trim().length > 0,
    vertical: this.vertical.length > 0,
  }));

  readonly nextSteps = [
    {
      title: 'We reply',
      desc: 'A real person reads your message and comes back with questions specific to your vertical and states.',
      icon: 'message',
    },
    {
      title: 'We scope the volume',
      desc: 'We agree transfer windows, daily caps and the qualification criteria a call has to clear before it reaches you.',
      icon: 'sparkles',
    },
    {
      title: 'Transfers start',
      desc: 'We begin at a volume you can staff, then scale. You track every transfer and policy in your portal.',
      icon: 'transfer',
    },
  ] as const;

  readonly faqs = [
    {
      q: 'Are the leads exclusive?',
      a: 'Yes. Every call we generate is worked once, for one client. Nothing is shared with a second buyer, resold later, or recycled from an older campaign.',
    },
    {
      q: 'What counts as a live transfer?',
      a: 'A caller who came in through our own campaign, cleared AI verification, was confirmed by a human Verifier against your criteria, and is warm-transferred to Compliance on that same call — not a callback.',
    },
    {
      q: 'Which verticals do you run?',
      a: 'Final Expense, Medicare, Health Insurance and Auto Insurance. Each is qualified against its own criteria — age band and health for Final Expense, Part A/B and enrolment window for Medicare, and so on.',
    },
    {
      q: 'Can you work only in the states we are licensed in?',
      a: 'Yes. Transfers are matched to your licensed service area, and you set the transfer windows and daily caps.',
    },
    {
      q: 'What do we get besides the call?',
      a: 'A client portal account. You review each lead we assign, approve or decline it, and track everything through to a written policy with a live status on each one.',
    },
    {
      q: 'How is our customer data handled?',
      a: 'Sensitive detail — SSNs, bank and routing numbers — is masked by default and only ever visible to the role and step that needs it. That rule is enforced in the API, not just hidden in the interface.',
    },
  ] as const;

  submit(): void {
    const r = this.required();
    if (!r.name || !r.email || !r.vertical) return;
    // No /api/contact endpoint exists yet — this is a UI-only confirmation.
    // Wire this up to a real server route if submissions need to go somewhere.
    this.submitted.set(true);
  }
}
