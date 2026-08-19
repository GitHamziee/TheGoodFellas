import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideBuilding2, LucideCircleCheck, LucideUserPlus } from '@lucide/angular';
import { ExternalClientService } from '../../../core/services/external-client.service';
import { ExternalClient } from '../../../core/models/external-client.model';
import { createListView } from '../../../core/list-view';
import { formatDate, getAvatarTone, getInitials } from '../../../core/format-utils';
import { Modal } from '../../../shared/ui/modal';
import { EmptyState, Pagination, SearchBox, SkeletonRows, StatTile } from '../../../shared/ui/ui';

interface Draft {
  name: string;
  company: string;
  email: string;
  phone: string;
  notes: string;
}

@Component({
  selector: 'app-admin-external-clients',
  imports: [
    FormsModule,
    Modal,
    StatTile,
    SearchBox,
    Pagination,
    EmptyState,
    SkeletonRows,
    LucideBuilding2,
    LucideUserPlus,
    LucideCircleCheck,
  ],
  templateUrl: './external-clients.html',
})
export class AdminExternalClients implements OnInit {
  private readonly externalClientService = inject(ExternalClientService);

  readonly externalClients = signal<ExternalClient[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly creating = signal(false);
  readonly saving = signal(false);

  readonly showCreate = signal(false);
  readonly selected = signal<ExternalClient | null>(null);
  readonly draft = signal<Draft | null>(null);

  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly formatDate = formatDate;

  name = '';
  company = '';
  email = '';
  phone = '';
  notes = '';
  levelCost: number | null = null;
  gradedCost: number | null = null;
  modifiedCost: number | null = null;
  giCost: number | null = null;

  readonly view = createListView<ExternalClient>({
    source: this.externalClients,
    searchFields: (c) => [c.name, c.company, c.email, c.phone],
    sorters: {
      name: (c) => c.name,
      company: (c) => c.company ?? '',
      createdAt: (c) => new Date(c.createdAt).getTime(),
    },
    initialSort: { key: 'name', dir: 'asc' },
    pageSize: 12,
  });

  readonly stats = computed(() => ({ total: this.externalClients().length }));

  canSubmitCreate(): boolean {
    return this.name.trim() !== '';
  }

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.externalClients.set(await this.externalClientService.list());
    } catch {
      this.error.set('Could not load external clients. Refresh to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  sortArrow(key: string): string {
    if (this.view.sortKey() !== key) return '';
    return this.view.sortDir() === 'asc' ? '↑' : '↓';
  }

  openCreate(): void {
    this.error.set(null);
    this.name = '';
    this.company = '';
    this.email = '';
    this.phone = '';
    this.notes = '';
    this.levelCost = null;
    this.gradedCost = null;
    this.modifiedCost = null;
    this.giCost = null;
    this.showCreate.set(true);
  }

  async createExternalClient(): Promise<void> {
    this.error.set(null);
    this.creating.set(true);
    try {
      const created = await this.externalClientService.create({
        name: this.name.trim(),
        company: this.company.trim() || undefined,
        email: this.email.trim() || undefined,
        phone: this.phone.trim() || undefined,
        notes: this.notes.trim() || undefined,
        levelCost: this.levelCost,
        gradedCost: this.gradedCost,
        modifiedCost: this.modifiedCost,
        giCost: this.giCost,
      });
      this.externalClients.update((rows) => [...rows, created]);
      this.showCreate.set(false);
      this.notice.set(`Created ${created.name}.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not create the external client.');
    } finally {
      this.creating.set(false);
    }
  }

  openDetail(client: ExternalClient): void {
    this.error.set(null);
    this.draft.set({
      name: client.name,
      company: client.company ?? '',
      email: client.email ?? '',
      phone: client.phone ?? '',
      notes: client.notes ?? '',
    });
    this.levelCost = client.levelCost ?? null;
    this.gradedCost = client.gradedCost ?? null;
    this.modifiedCost = client.modifiedCost ?? null;
    this.giCost = client.giCost ?? null;
    this.selected.set(client);
  }

  updateDraft<K extends keyof Draft>(key: K, value: string): void {
    this.draft.update((d) => (d ? { ...d, [key]: value } : d));
  }

  async saveEdit(): Promise<void> {
    const client = this.selected();
    const draft = this.draft();
    if (!client || !draft) return;

    this.error.set(null);
    this.saving.set(true);
    try {
      const updated = await this.externalClientService.update(client.id, {
        name: draft.name.trim(),
        company: draft.company.trim(),
        email: draft.email.trim(),
        phone: draft.phone.trim(),
        notes: draft.notes.trim(),
        levelCost: this.levelCost,
        gradedCost: this.gradedCost,
        modifiedCost: this.modifiedCost,
        giCost: this.giCost,
      });
      this.externalClients.update((rows) => rows.map((c) => (c.id === client.id ? updated : c)));
      this.selected.set(null);
      this.notice.set(`Saved changes to ${updated.name}.`);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Could not save changes.');
    } finally {
      this.saving.set(false);
    }
  }
}
