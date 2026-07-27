import { LeadStatus } from './models/lead.model';

export function statusBadgeClass(status: LeadStatus): string {
  return `badge badge--${status.toLowerCase()}`;
}
