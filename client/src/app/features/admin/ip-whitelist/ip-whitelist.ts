import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideCircleCheck, LucidePlus, LucideShield, LucideTrash2, LucideWifi } from '@lucide/angular';
import { IpWhitelistService } from '../../../core/services/ip-whitelist.service';
import { WhitelistedIp } from '../../../core/models/ip-whitelist.model';
import { formatDate, pluralize } from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import { EmptyState, SkeletonRows } from '../../../shared/ui/ui';

@Component({
  selector: 'app-admin-ip-whitelist',
  imports: [
    FormsModule,
    Modal,
    EmptyState,
    SkeletonRows,
    LucideCircleCheck,
    LucidePlus,
    LucideShield,
    LucideTrash2,
    LucideWifi,
  ],
  templateUrl: './ip-whitelist.html',
})
export class AdminIpWhitelist implements OnInit {
  private readonly ipWhitelistService = inject(IpWhitelistService);

  readonly ips = signal<WhitelistedIp[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly creating = signal(false);
  readonly deletingId = signal<string | null>(null);
  readonly showCreate = signal(false);
  readonly detecting = signal(false);
  /** Raw IP behind the pre-filled `ipAddress` when opened via "Add this network" — shown as a
   * note so the admin can see what was widened/why, rather than just a mystery value. */
  readonly detectedIp = signal<string | null>(null);

  readonly formatDate = formatDate;
  readonly pluralize = pluralize;

  ipAddress = '';
  label = '';

  /** A plain method, not computed() — ipAddress is an ngModel-bound plain field, not a
   * signal, so a computed() here would never see it change after its first read. */
  canSubmitCreate(): boolean {
    return this.ipAddress.trim() !== '';
  }

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.ips.set(await this.ipWhitelistService.list());
    } catch {
      this.error.set('Could not load whitelisted IPs. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  openCreate(): void {
    this.error.set(null);
    this.ipAddress = '';
    this.label = '';
    this.detectedIp.set(null);
    this.showCreate.set(true);
  }

  /** Detects the admin's own current connection and pre-fills the form with it — for IPv6
   * this is already widened to a /64, since the exact address rotates under privacy extensions
   * and would silently stop matching within a day. Nobody has to know or type their own IP. */
  async addCurrentNetwork(): Promise<void> {
    this.error.set(null);
    this.detecting.set(true);
    try {
      const { ip, suggested } = await this.ipWhitelistService.detect();
      this.ipAddress = suggested;
      this.label = '';
      this.detectedIp.set(ip);
      this.showCreate.set(true);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not detect this connection.');
    } finally {
      this.detecting.set(false);
    }
  }

  async createIp(): Promise<void> {
    if (!this.canSubmitCreate()) return;

    this.error.set(null);
    this.creating.set(true);
    try {
      const created = await this.ipWhitelistService.create({
        ipAddress: this.ipAddress.trim(),
        label: this.label.trim() || undefined,
      });
      this.ips.update((rows) => [created, ...rows]);
      this.showCreate.set(false);
      this.notice.set(`Whitelisted ${created.ipAddress}.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not add this IP.');
    } finally {
      this.creating.set(false);
    }
  }

  async deleteIp(ip: WhitelistedIp): Promise<void> {
    this.error.set(null);
    this.deletingId.set(ip.id);
    try {
      await this.ipWhitelistService.delete(ip.id);
      this.ips.update((rows) => rows.filter((r) => r.id !== ip.id));
      this.notice.set(`Removed ${ip.ipAddress}.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not remove this IP.');
    } finally {
      this.deletingId.set(null);
    }
  }
}
