import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideArrowRight, LucideClock, LucideEye, LucideShield, LucideTarget } from '@lucide/angular';
import { Reveal } from '../../../shared/reveal.directive';

@Component({
  selector: 'app-about',
  imports: [RouterLink, Reveal, LucideArrowRight, LucideClock, LucideEye, LucideShield, LucideTarget],
  templateUrl: './about.html',
})
export class About {
  readonly values = [
    {
      title: 'Exclusivity',
      desc: 'Every call we generate is worked once, for one client. Nothing is shared, recycled or sold on a second time.',
      icon: 'target',
    },
    {
      title: 'Security & Privacy',
      desc: 'Sensitive customer detail — SSNs, bank and policy information — is handled and masked with care at every stage.',
      icon: 'shield',
    },
    {
      title: 'Speed',
      desc: 'AI screening plus a live Verifier means the transfer happens on the first call, not on a follow-up three days later.',
      icon: 'clock',
    },
    {
      title: 'Transparency',
      desc: 'You see live status on every transfer and policy we deliver, not a stale report at the end of the month.',
      icon: 'eye',
    },
  ] as const;
}
