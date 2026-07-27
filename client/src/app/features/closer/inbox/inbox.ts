import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LeadService } from '../../../core/services/lead.service';
import { Lead } from '../../../core/models/lead.model';

@Component({
  selector: 'app-closer-inbox',
  imports: [RouterLink],
  templateUrl: './inbox.html',
  styleUrl: '../../shared-page.css',
})
export class CloserInbox implements OnInit {
  private readonly leadService = inject(LeadService);

  readonly leads = signal<Lead[]>([]);
  readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    this.leads.set(await this.leadService.inbox());
    this.loading.set(false);
  }
}
