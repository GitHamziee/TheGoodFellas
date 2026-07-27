import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LeadService } from '../../../core/services/lead.service';

@Component({
  selector: 'app-client-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: '../../shared-page.css',
})
export class ClientDashboard implements OnInit {
  private readonly leadService = inject(LeadService);

  readonly pending = signal(0);
  readonly accepted = signal(0);
  readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    const [previews, history] = await Promise.all([this.leadService.assignedPreviews(), this.leadService.clientHistory()]);
    this.pending.set(previews.length);
    this.accepted.set(history.length);
    this.loading.set(false);
  }
}
