import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiService } from '../core/api.service';
import { buildLocalConfig } from '../core/local-config';
import { GROUP_LABELS, GroupCode, SessionCreatePayload } from '../core/models';
import { SessionStore } from '../core/session-store.service';

@Component({
  selector: 'app-operator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './operator.component.html',
  styleUrl: './operator.component.scss',
})
export class OperatorComponent {
  private api = inject(ApiService);
  private store = inject(SessionStore);
  private router = inject(Router);

  externalId = '';
  age: number | null = null;
  sex = '';
  group = ''; // vazio = balanceado
  devMode = false;
  submitting = false;
  errorMsg = '';

  readonly groupOptions: { value: string; label: string }[] = [
    { value: '', label: 'Automático (balanceado)' },
    ...(['EXT', 'RC1000', 'SOM2', 'SOM5'] as GroupCode[]).map((g) => ({
      value: g,
      label: GROUP_LABELS[g],
    })),
  ];

  start(): void {
    if (!this.externalId.trim() || this.submitting) return;
    this.submitting = true;
    this.errorMsg = '';

    const payload: SessionCreatePayload = {
      external_id: this.externalId.trim(),
      age: this.age,
      sex: this.sex,
      group: this.group,
    };

    this.api.createSession(payload).subscribe({
      next: (res) => {
        this.store.config = res.config;
        this.store.devMode = this.devMode;
        this.store.offline = false;
        this.router.navigate(['/run']);
      },
      error: (err) => {
        // Fallback offline: roda a tarefa localmente e permite baixar o log.
        console.warn('Backend indisponível, usando config local.', err);
        this.store.config = buildLocalConfig(
          (this.group || undefined) as GroupCode | undefined
        );
        this.store.devMode = this.devMode;
        this.store.offline = true;
        this.router.navigate(['/run']);
      },
    });
  }
}
