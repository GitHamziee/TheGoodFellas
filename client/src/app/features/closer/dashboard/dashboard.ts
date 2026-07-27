import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LeadService } from '../../../core/services/lead.service';
import { Lead } from '../../../core/models/lead.model';

@Component({
  selector: 'app-closer-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: '../../shared-page.css',
})
export class CloserDashboard implements OnInit {
  private readonly leadService = inject(LeadService);

  readonly inbox = signal<Lead[]>([]);
  readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    this.inbox.set(await this.leadService.inbox());
    this.loading.set(false);
  }
}
