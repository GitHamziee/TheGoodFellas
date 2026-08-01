import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideArrowRight,
  LucideCarFront,
  LucideCheck,
  LucideClock,
  LucideHandshake,
  LucideHeartPulse,
  LucideMessageSquare,
  LucidePhoneForwarded,
  LucidePhoneIncoming,
  LucideShield,
  LucideShieldCheck,
  LucideSparkles,
  LucideStethoscope,
  LucideUserCheck,
} from '@lucide/angular';
import { Reveal } from '../../../shared/reveal.directive';

@Component({
  selector: 'app-home',
  imports: [
    RouterLink,
    Reveal,
    LucideArrowRight,
    LucideCarFront,
    LucideCheck,
    LucideClock,
    LucideHandshake,
    LucideHeartPulse,
    LucideMessageSquare,
    LucidePhoneForwarded,
    LucidePhoneIncoming,
    LucideShield,
    LucideShieldCheck,
    LucideSparkles,
    LucideStethoscope,
    LucideUserCheck,
  ],
  templateUrl: './home.html',
})
export class Home {
  /** Hero console. Illustrative floor figures — swap for real reporting numbers. */
  readonly console = {
    headline: { value: '186', label: 'live transfers today' },
    kpis: [
      { value: '1,240', label: 'Inbound calls' },
      { value: '31', label: 'Policies closed' },
    ],
    meter: { label: 'AI clear rate', display: '89%', pct: 89 },
    feed: [
      { vertical: 'Final Expense', state: 'TX', status: 'Transferring', tone: 'gold' },
      { vertical: 'Medicare', state: 'FL', status: 'With Closer', tone: 'green' },
      { vertical: 'Auto Insurance', state: 'OH', status: 'AI verifying', tone: 'muted' },
      { vertical: 'Health Insurance', state: 'AZ', status: 'Cleared', tone: 'green' },
    ],
  } as const;

  /** The four live-transfer verticals we run campaigns on. */
  readonly verticals = [
    {
      name: 'Final Expense',
      icon: 'shieldCheck',
      desc: 'Seniors calling in about burial and final expense coverage, screened on age, health and budget before transfer.',
      tags: ['Ages 50–85', 'Health screened', 'Budget checked'],
    },
    {
      name: 'Medicare',
      icon: 'stethoscope',
      desc: 'Advantage and Supplement callers, checked for eligibility and enrolment window on the same call.',
      tags: ['65+ eligible', 'Part A & B', 'Zip matched'],
    },
    {
      name: 'Health Insurance',
      icon: 'heartPulse',
      desc: 'ACA and private health callers qualified on household size, income band and coverage need.',
      tags: ['Household', 'Income band', 'On-market'],
    },
    {
      name: 'Auto Insurance',
      icon: 'carFront',
      desc: 'Drivers shopping for a better rate, verified on vehicle, licence status and current policy.',
      tags: ['Licensed', 'Vehicle', 'Renewal date'],
    },
  ] as const;

  /** Rendered as a connected 5-node rail — keep descriptions short, the columns are narrow. */
  readonly steps = [
    {
      title: 'We generate the call',
      desc: 'Our own campaigns drive inbound calls — never purchased lists or recycled data.',
    },
    {
      title: 'AI verification',
      desc: 'Real-time screening for intent, eligibility and compliance before a human picks up.',
    },
    {
      title: 'A Verifier confirms',
      desc: 'A live Verifier confirms the detail and checks it against your criteria.',
    },
    {
      title: 'Live transfer',
      desc: 'Warm-transferred to a licensed Closer on the same call. No callbacks.',
    },
    {
      title: 'Close the policy',
      desc: 'The Closer presents, handles objections and writes the application end to end.',
    },
  ];

  /** Shown on the mock verification result card in the AI section. */
  readonly aiChecks = [
    { label: 'Genuine coverage intent', value: 'Confirmed' },
    { label: 'Age & eligibility', value: 'In range' },
    { label: 'Phone & state match', value: 'Verified' },
    { label: 'Duplicate / recycled check', value: 'Clean' },
    { label: 'Compliance flags', value: 'None' },
  ] as const;

  readonly aiPoints = [
    'Screens intent, eligibility and contact accuracy while the caller is still on the line',
    'Flags duplicates and recycled data before anyone spends a minute on the call',
    'Scores every call so Verifiers work the strongest ones first',
    'A human always makes the final call — the AI never transfers on its own',
  ];

  readonly roles = [
    {
      name: 'AI Verification',
      desc: 'Screens every inbound call in real time and scores it before a human ever picks up.',
      icon: 'sparkles',
    },
    {
      name: 'Verifiers',
      desc: 'Confirm intent and eligibility on the phone, then hand the caller straight to a Closer.',
      icon: 'userCheck',
    },
    {
      name: 'Closers',
      desc: 'Take the live transfer, present the plan, handle objections and close the policy.',
      icon: 'handshake',
    },
    {
      name: 'You, our client',
      desc: 'Receive the transfer or the written policy, and track every one of them in your portal.',
      icon: 'phoneForwarded',
    },
  ] as const;

  readonly features = [
    {
      title: 'Exclusive, never resold',
      desc: 'Every call we generate is worked once, for one client. Nothing is shared, recycled or sold on a second time.',
      icon: 'shield',
    },
    {
      title: 'Verified before it rings',
      desc: 'AI screening plus a live Verifier means the call that reaches your Closer is a real, qualified, in-market buyer.',
      icon: 'message',
    },
    {
      title: 'Live status, not a monthly report',
      desc: 'Every transfer and policy carries a status you can check any time — New through Accepted and Paid.',
      icon: 'clock',
    },
  ] as const;
}
