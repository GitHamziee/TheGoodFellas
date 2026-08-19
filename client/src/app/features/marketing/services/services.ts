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
} from '@lucide/angular';
import { Reveal } from '../../../shared/reveal.directive';

@Component({
  selector: 'app-services',
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
  ],
  templateUrl: './services.html',
})
export class Services {
  /** `tag` is set on every card so the eyebrow row is never blank — an empty
   *  reserved row left a visible gap. `highlight` marks the flagship only. */
  readonly serviceCards = [
    {
      num: '01',
      tag: 'Where it starts',
      highlight: false,
      title: 'Inbound Lead Generation',
      desc: 'We run our own campaigns and take the call when it comes in. Every lead starts as a real person who picked up the phone looking for coverage.',
      icon: 'phoneIncoming',
      checklist: [
        'Our own media, our own numbers — no purchased lists',
        'Inbound intent, not cold outbound dialling',
        'Campaigns tuned per vertical and per state',
        'Exclusive to one client — never resold',
      ],
    },
    {
      num: '02',
      tag: 'How we scale',
      highlight: false,
      title: 'AI Verification',
      desc: 'Real-time AI screening on every inbound call, scoring intent, eligibility and data quality before a human ever picks up.',
      icon: 'sparkles',
      checklist: [
        'Genuine coverage intent detected on the call',
        'Eligibility checked against the product they called about',
        'Phone, state and identity details validated',
        'Duplicates, recycled data and compliance flags caught early',
      ],
    },
    {
      num: '03',
      tag: 'Core product',
      highlight: true,
      title: 'Live Transfers',
      desc: 'A human Verifier confirms what the AI found, then warm-transfers the caller straight to Compliance — on the same call.',
      icon: 'phoneForwarded',
      checklist: [
        'Warm handoff while the caller is still engaged',
        'Qualified against your criteria before transfer',
        'No callbacks, no chasing, no cold follow-up',
        'Transfer windows and daily caps set by you',
      ],
    },
    {
      num: '04',
      tag: 'Where it ends',
      highlight: false,
      title: 'Compliance Handoff',
      desc: 'Our Compliance team takes the transfer, presents the plan, handles objections and writes the application end to end.',
      icon: 'handshake',
      checklist: [
        'Licensed Compliance specialists who know the product',
        'Beneficiary, health and billing detail captured in full',
        'Application submitted complete, nothing missing',
        'Delivered to your portal with a live status',
      ],
    },
  ] as const;

  /** The four live-transfer verticals, with what we actually qualify on before a transfer. */
  readonly verticals = [
    {
      name: 'Final Expense',
      icon: 'shieldCheck',
      desc: 'Seniors calling about burial, cremation and leave-behind coverage. Our oldest and highest-converting line.',
      checklist: [
        'Age band 50–85 confirmed on the call',
        'Health conditions and medications captured',
        'Coverage need — burial, cremation or leave money',
        'Income source and affordability checked',
      ],
    },
    {
      name: 'Medicare',
      icon: 'stethoscope',
      desc: 'Advantage and Supplement callers, verified for eligibility and enrolment window before they reach your desk.',
      checklist: [
        'Age 65+ or otherwise Medicare-eligible',
        'Part A and Part B status confirmed',
        'Enrolment window checked — AEP, OEP or SEP',
        'Zip matched to your licensed service area',
      ],
    },
    {
      name: 'Health Insurance',
      icon: 'heartPulse',
      desc: 'ACA and private health callers qualified on household, income and what they actually need covered.',
      checklist: [
        'Household size and dependants recorded',
        'Income band checked against subsidy thresholds',
        'Existing coverage and renewal date captured',
        'On-market or off-market fit established',
      ],
    },
    {
      name: 'Auto Insurance',
      icon: 'carFront',
      desc: 'Drivers actively shopping for a better rate, verified on vehicle, licence and current policy before transfer.',
      checklist: [
        'Valid licence and driver history confirmed',
        'Vehicle year, make and model captured',
        'Current carrier and renewal date recorded',
        'Coverage level and deductible preference noted',
      ],
    },
  ] as const;

  readonly whyItWorks = [
    {
      title: 'Field-level masking',
      desc: 'SSNs, routing numbers and account detail are masked by default and only ever shown to the role and step they belong to.',
      icon: 'shield',
    },
    {
      title: 'A channel for every team',
      desc: 'Verifiers and Compliance each stay in constant contact with Admin over real-time chat, so no transfer sits waiting on a handoff.',
      icon: 'message',
    },
    {
      title: 'Status you can trust',
      desc: 'New, Submitted, Assigned, Accepted, Rejected — every lead is always exactly one of these, visible live in your portal.',
      icon: 'clock',
    },
  ] as const;
}
