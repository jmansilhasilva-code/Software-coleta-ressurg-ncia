import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';

import { ApiService } from '../core/api.service';
import {
  ClientConfig,
  EventLog,
  EventType,
  Role,
} from '../core/models';
import { SessionStore } from '../core/session-store.service';
import { AudioService } from './audio.service';
import { VISchedule } from './vi-schedule';

/**
 * Ambiguidade no PDF: o "custo de resposta universal (−1)" é descrito como válido
 * "em todas as fases", mas a Fase 3 é descrita como extinção total (sem
 * consequências). O padrão experimental para um teste de ressurgência é Fase 3 em
 * extinção pura. Mantemos isso configurável aqui — confirmar com o orientador.
 */
const UNIVERSAL_COST_IN_PHASE3 = false;

const BUTTON_SIZE = 72; // px

interface ButtonState {
  role: Role;
  symbol: string;
  x: number;
  y: number;
  opacity: number;
}

@Component({
  selector: 'app-experiment',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './experiment.component.html',
  styleUrl: './experiment.component.scss',
})
export class ExperimentComponent implements OnInit, AfterViewInit, OnDestroy {
  private store = inject(SessionStore);
  private api = inject(ApiService);
  private audio = inject(AudioService);
  private router = inject(Router);
  private zone = inject(NgZone);

  @ViewChild('arena') arenaRef!: ElementRef<HTMLDivElement>;

  config!: ClientConfig;
  buttons: ButtonState[] = [];
  points = 0;

  // Estados de tela
  prestart = true;
  finished = false;

  // Feedback visual
  barFlash: 'green' | 'red' | null = null;
  showReinforcement = false;
  costText = '';

  // DevMode / depuração
  get devMode() {
    return this.store.devMode;
  }
  phase = 1;
  remainingS = 0;

  // Internos
  private params!: ClientConfig['params'];
  private phaseDurationMs = 0;
  private startMs = 0;
  private rafId = 0;
  private lastMoveMs = 0;
  private vi = new VISchedule(2);
  private reinforcedRole: Role | null = null;
  private arenaW = 0;
  private arenaH = 0;

  // Log
  private events: EventLog[] = [];
  private uploadedUntil = 0; // índice já enviado ao backend
  private flashToken = 0;

  ngOnInit(): void {
    // Config deve estar disponível antes da primeira renderização (o template a usa).
    if (!this.store.config) {
      this.router.navigate(['/']);
      return;
    }
    this.config = this.store.config;
    this.params = this.config.params;
    this.phaseDurationMs =
      (this.devMode
        ? this.params.dev_phase_duration_s
        : this.params.phase_duration_s) * 1000;
    this.vi = new VISchedule(this.params.vi_seconds);
  }

  ngAfterViewInit(): void {
    if (!this.config) return; // redirecionado em ngOnInit
    // Defere para o próximo tick: garante layout estabilizado e dispara um ciclo
    // de detecção de mudanças (setTimeout é interceptado pelo zone.js) para
    // renderizar os botões recém-posicionados.
    setTimeout(() => {
      this.measureArena();
      this.placeButtonsInitial();
    }, 0);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.rafId);
  }

  /** Inicia a tarefa (gesto do usuário: desbloqueia áudio). */
  async begin(): Promise<void> {
    this.prestart = false;
    await this.audio.preload();
    this.startMs = performance.now();
    this.lastMoveMs = 0;
    this.enterPhase(1);
    if (!this.store.offline) {
      this.api
        .patchSession(this.config.session_id, { status: 'running' })
        .subscribe({ error: () => {} });
    }
    // Loop fora da zona Angular para não disparar CD a cada frame.
    this.zone.runOutsideAngular(() => this.loop());
  }

  private loop = (): void => {
    const now = performance.now() - this.startMs;
    const totalMs = this.phaseDurationMs * this.params.n_phases;

    if (now >= totalMs) {
      this.zone.run(() => this.finish());
      return;
    }

    const newPhase = Math.min(
      this.params.n_phases,
      Math.floor(now / this.phaseDurationMs) + 1
    );
    if (newPhase !== this.phase) {
      this.zone.run(() => this.enterPhase(newPhase));
    }

    if (this.reinforcedRole) this.vi.tick(now);

    if (now - this.lastMoveMs >= this.params.move_interval_ms) {
      this.moveButtons();
      this.lastMoveMs += this.params.move_interval_ms;
      // evita acumular atraso após pausas longas (aba em segundo plano)
      if (now - this.lastMoveMs > this.params.move_interval_ms * 5) {
        this.lastMoveMs = now;
      }
      this.zone.run(() => {
        this.remainingS = Math.ceil((this.phaseDurationMs - (now % this.phaseDurationMs)) / 1000);
      });
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  private enterPhase(phase: number): void {
    // envia eventos da fase anterior
    this.flushEvents();
    this.phase = phase;
    if (phase === 1) {
      this.reinforcedRole = 'R1';
      this.vi.reset(performance.now() - this.startMs);
    } else if (phase === 2) {
      this.reinforcedRole = 'R2';
      this.vi.reset(performance.now() - this.startMs);
    } else {
      this.reinforcedRole = null; // Fase 3: extinção total
    }
  }

  // ---------------------------------------------------------------------------
  // Resposta do participante
  // ---------------------------------------------------------------------------
  onResponse(role: Role, ev: Event): void {
    ev.preventDefault();
    if (this.prestart || this.finished) return;
    const t = Math.round(performance.now() - this.startMs);

    // 1) registra a resposta
    this.log('response', role, t, 0);

    // 2) controle de estímulo por opacidade
    this.applyOpacity(role);

    // 3) consequências por fase
    if (this.phase === 1) {
      this.phase1Consequences(role, t);
    } else if (this.phase === 2) {
      this.phase2Consequences(role, t);
    } else {
      this.phase3Consequences(role, t);
    }
  }

  private phase1Consequences(role: Role, t: number): void {
    // reforço primeiro (se R1 e VI disponível), depois custo universal
    if (role === 'R1' && this.vi.consume(performance.now() - this.startMs)) {
      this.reinforce(role, t);
    }
    this.cost(role, t, this.params.response_cost_points);
  }

  private phase2Consequences(role: Role, t: number): void {
    if (role === 'R2' && this.vi.consume(performance.now() - this.startMs)) {
      this.reinforce(role, t);
    }
    if (role === 'R1') {
      const c = this.params.phase2_contingency;
      if (c.sound_ms > 0) {
        this.audio.play(c.sound_ms);
        this.log('sound', role, t, 0, c.sound_ms);
      }
      this.cost(role, t, c.cost_points);
    } else {
      this.cost(role, t, this.params.response_cost_points);
    }
  }

  private phase3Consequences(role: Role, t: number): void {
    if (UNIVERSAL_COST_IN_PHASE3) {
      this.cost(role, t, this.params.response_cost_points);
    }
    // caso contrário: extinção pura (nenhuma consequência)
  }

  private reinforce(role: Role, t: number): void {
    this.points += this.params.reinforcement_points;
    this.log('reinforcement', role, t, this.params.reinforcement_points);
    this.flashBar('green');
    this.banner();
  }

  private cost(role: Role, t: number, amount: number): void {
    this.points -= amount;
    this.log('cost', role, t, -amount);
    this.flashBar('red');
    this.flashCost(amount);
  }

  // ---------------------------------------------------------------------------
  // Feedback visual
  // ---------------------------------------------------------------------------
  private flashBar(color: 'green' | 'red'): void {
    this.zone.run(() => {
      this.barFlash = color;
      const token = ++this.flashToken;
      setTimeout(() => {
        if (this.flashToken === token) this.barFlash = null;
      }, this.params.feedback_flash_ms);
    });
  }

  private banner(): void {
    this.zone.run(() => {
      this.showReinforcement = true;
      setTimeout(
        () => (this.showReinforcement = false),
        this.params.feedback_flash_ms
      );
    });
  }

  private flashCost(amount: number): void {
    this.zone.run(() => {
      this.costText = `−${amount}`;
      setTimeout(() => (this.costText = ''), this.params.feedback_flash_ms);
    });
  }

  // ---------------------------------------------------------------------------
  // Movimento e geometria
  // ---------------------------------------------------------------------------
  private measureArena(): void {
    const el = this.arenaRef.nativeElement;
    this.arenaW = el.clientWidth;
    this.arenaH = el.clientHeight;
  }

  private placeButtonsInitial(): void {
    const cb = this.config.counterbalance;
    const roles: Role[] = ['R1', 'R2', 'CONTROL'];
    this.buttons = roles.map((role) => {
      const p = cb[role];
      return {
        role,
        symbol: p.symbol,
        x: p.x * (this.arenaW - BUTTON_SIZE),
        y: p.y * (this.arenaH - BUTTON_SIZE),
        opacity: 1,
      };
    });
  }

  private moveButtons(): void {
    const step = this.params.move_step_px;
    const maxX = this.arenaW - BUTTON_SIZE;
    const maxY = this.arenaH - BUTTON_SIZE;
    for (const b of this.buttons) {
      const dir = Math.floor(Math.random() * 4);
      if (dir === 0) b.y -= step;
      else if (dir === 1) b.y += step;
      else if (dir === 2) b.x -= step;
      else b.x += step;
      b.x = Math.max(0, Math.min(maxX, b.x));
      b.y = Math.max(0, Math.min(maxY, b.y));
    }
  }

  private applyOpacity(role: Role): void {
    for (const b of this.buttons) {
      b.opacity = b.role === role ? 1 : 0.5;
    }
  }

  @HostListener('window:resize')
  onResize(): void {
    if (!this.arenaRef) return;
    this.measureArena();
    const maxX = this.arenaW - BUTTON_SIZE;
    const maxY = this.arenaH - BUTTON_SIZE;
    for (const b of this.buttons) {
      b.x = Math.max(0, Math.min(maxX, b.x));
      b.y = Math.max(0, Math.min(maxY, b.y));
    }
  }

  // ---------------------------------------------------------------------------
  // Log e finalização
  // ---------------------------------------------------------------------------
  private log(
    type: EventType,
    role: Role | '',
    t: number,
    delta: number,
    soundMs?: number
  ): void {
    this.events.push({
      phase: this.phase,
      event_type: type,
      button_role: role,
      t_ms: t,
      points_delta: delta,
      points_total: this.points,
      sound_ms: soundMs ?? null,
    });
  }

  private flushEvents(): void {
    if (this.store.offline) return;
    const batch = this.events.slice(this.uploadedUntil);
    if (!batch.length) return;
    this.uploadedUntil = this.events.length;
    this.api
      .uploadEvents(this.config.session_id, batch)
      .subscribe({ error: (e) => console.warn('upload falhou', e) });
  }

  private finish(): void {
    cancelAnimationFrame(this.rafId);
    this.finished = true;
    this.flushEvents();
    if (!this.store.offline) {
      this.api
        .patchSession(this.config.session_id, { status: 'finished' })
        .subscribe({ error: () => {} });
    }
  }

  downloadData(): void {
    const payload = {
      session_id: this.config.session_id,
      group: this.config.group,
      counterbalance: this.config.counterbalance,
      offline: this.store.offline,
      events: this.events,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session_${this.config.session_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  backToOperator(): void {
    this.router.navigate(['/']);
  }
}
