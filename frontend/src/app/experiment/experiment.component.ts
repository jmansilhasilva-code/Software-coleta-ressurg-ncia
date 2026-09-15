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

const BUTTON_SIZE = 72; // px

// Espaço entre os quadrados/workspaces e entre eles e a borda da arena.
const ZONE_GAP = 16; // px

// Duração do texto flutuante de feedback ("+100"/"−1") ancorado no botão —
// mais longa que o flash rápido da barra (feedback_flash_ms), para dar tempo
// de ler antes de sumir (decisão: 15/09/2026, deixar pontos bem visíveis).
const FEEDBACK_TEXT_MS = 900;

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ButtonState {
  role: Role;
  symbol: string;
  x: number;
  y: number;
  opacity: number;
  zone: Zone;
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
  /** Valor exibido na tela — anima suavemente até `points` (puramente visual). */
  displayPoints = 0;
  particles: { id: number; dx: number; dy: number; hue: number }[] = [];

  // Estados de tela
  prestart = true;
  finished = false;

  // Feedback visual
  barFlash: 'green' | 'red' | null = null;
  // Ancorado na posição do botão respondido (adaptação do apêndice do estudo
  // original: "+100" aparece acima do botão reforçado, custo aparece abaixo
  // do botão respondido — em vez de um banner genérico no topo da tela).
  reinforcementFeedback: { x: number; y: number; text: string } | null = null;
  costFeedback: { x: number; y: number; text: string } | null = null;

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

  // Changeover delay (COD): trocar de botão bloqueia o reforço no novo botão
  // por `changeover_delay_ms` — evita reforçar a própria alternância entre
  // respostas (ver protocol.py para a justificativa e o precedente na literatura).
  // Generaliza automaticamente para os 4 botões (R1/R2/CONTROL1/CONTROL2): a
  // detecção de troca não depende de quais papéis existem.
  private lastRespondedRole: Role | null = null;
  private codBlockedUntilMs = 0;

  /** Ponteiros (dedos) atualmente pressionados, por pointerId -> botão. Serve
   * só para detectar toque simultâneo em 2+ botões (comum em telas
   * touchscreen, por sobreposição/erro dos dedos) — único caso em que ainda
   * existe custo de resposta (ver MULTI_TOUCH_COST_POINTS no backend). */
  private activePointers = new Map<number, Role>();

  /** Botões somem da tela: 1s após reforço, 5s após a punição real da Fase 2
   * (RC-1000 ou som — não o custo de multi-touch, que não é "punição"). */
  buttonsHidden = false;
  private buttonsHiddenUntilMs = 0;

  // Log
  private events: EventLog[] = [];
  private uploadedUntil = 0; // índice já enviado ao backend
  private pointsAnimId = 0;
  private particleSeq = 0;
  // Fila do flash da barra: reforço e custo podem ocorrer na mesma resposta
  // (protocolo: reforço aplicado primeiro, custo imediatamente depois); sem
  // fila, o segundo flash sobrescreveria o primeiro antes de ser visível.
  private flashQueue: Array<'green' | 'red'> = [];
  private flashBusy = false;

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
    cancelAnimationFrame(this.pointsAnimId);
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

    const shouldHide = now < this.buttonsHiddenUntilMs;
    if (shouldHide !== this.buttonsHidden) {
      this.zone.run(() => {
        this.buttonsHidden = shouldHide;
      });
    }

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
  onResponse(role: Role, ev: PointerEvent): void {
    ev.preventDefault();
    if (this.prestart || this.finished) return;
    const t = Math.round(performance.now() - this.startMs);

    // 0) toque simultâneo em 2+ botões (outro ponteiro/dedo já pressionado
    // num botão diferente agora): não é uma resposta válida (comum em
    // touchscreen, por sobreposição/erro dos dedos) — só regista e cobra o
    // único custo de resposta que ainda existe, sem reforçar/punir.
    const isMultiTouch = this.hasOtherButtonPressed(ev.pointerId, role);
    this.activePointers.set(ev.pointerId, role);
    this.log('response', role, t, 0);
    if (isMultiTouch) {
      this.cost(role, t, this.params.multi_touch_cost_points);
      return;
    }

    // 1) changeover delay: alternar para um botão diferente bloqueia reforço
    // nesse botão pelos próximos `changeover_delay_ms`.
    if (this.lastRespondedRole !== null && role !== this.lastRespondedRole) {
      this.codBlockedUntilMs = t + this.params.changeover_delay_ms;
    }
    this.lastRespondedRole = role;

    // 2) controle de estímulo por opacidade
    this.applyOpacity(role);

    // 3) consequências por fase
    if (this.phase === 1) {
      this.phase1Consequences(role, t);
    } else if (this.phase === 2) {
      this.phase2Consequences(role, t);
    }
    // Fase 3: extinção pura, nenhuma consequência.
  }

  /** Libera o ponteiro do rastreamento de multi-touch ao soltar o dedo/botão
   * do mouse — em qualquer lugar da tela, não só em cima do botão. */
  @HostListener('window:pointerup', ['$event'])
  @HostListener('window:pointercancel', ['$event'])
  onGlobalPointerEnd(ev: PointerEvent): void {
    this.activePointers.delete(ev.pointerId);
  }

  /** Há outro ponteiro pressionado agora num botão diferente do atual? */
  private hasOtherButtonPressed(pointerId: number, role: Role): boolean {
    for (const [pid, r] of this.activePointers) {
      if (pid !== pointerId && r !== role) return true;
    }
    return false;
  }

  private phase1Consequences(role: Role, t: number): void {
    // Único botão com consequência na Fase 1 é R1 (reforço); R2 e os
    // controles não têm nenhuma consequência ao serem tocados.
    const codActive = t < this.codBlockedUntilMs;
    if (
      role === 'R1' &&
      !codActive &&
      this.vi.consume(performance.now() - this.startMs)
    ) {
      this.reinforce(role, t);
    }
  }

  private phase2Consequences(role: Role, t: number): void {
    const codActive = t < this.codBlockedUntilMs;
    if (
      role === 'R2' &&
      !codActive &&
      this.vi.consume(performance.now() - this.startMs)
    ) {
      this.reinforce(role, t);
    }
    if (role === 'R1') {
      const c = this.params.phase2_contingency;
      // Punição REAL: som aversivo OU custo (RC-1000). Grupos EXT/SOM2/SOM5
      // têm cost_points=0 (extinção pura ou só o som) — não escondem os
      // botões por causa de custo, só se houver som.
      const isRealPunishment = c.sound_ms > 0 || c.cost_points > 0;
      if (c.sound_ms > 0) {
        this.audio.play(c.sound_ms);
        this.log('sound', role, t, 0, c.sound_ms);
      }
      if (c.cost_points > 0) {
        this.cost(role, t, c.cost_points);
      }
      if (isRealPunishment) {
        this.hideButtonsFor(this.params.punishment_hide_ms);
      }
    }
    // R2 fora do reforço e os controles: nenhuma consequência.
  }

  private reinforce(role: Role, t: number): void {
    this.points += this.params.reinforcement_points;
    this.log('reinforcement', role, t, this.params.reinforcement_points);
    this.flashBar('green');
    this.banner(role);
    this.animatePointsTo(this.points);
    this.burstParticles();
    this.hideButtonsFor(this.params.reinforcement_hide_ms);
  }

  /** Marca os botões como escondidos até `agora + durationMs` (usa o maior
   * prazo pendente — reforço e punição podem se sobrepor no tempo). */
  private hideButtonsFor(durationMs: number): void {
    const untilMs = performance.now() - this.startMs + durationMs;
    this.buttonsHiddenUntilMs = Math.max(this.buttonsHiddenUntilMs, untilMs);
  }

  private cost(role: Role, t: number, amount: number): void {
    this.points -= amount;
    this.log('cost', role, t, -amount);
    this.flashBar('red');
    this.flashCost(role, amount);
    this.animatePointsTo(this.points);
  }

  // ---------------------------------------------------------------------------
  // Feedback visual
  // ---------------------------------------------------------------------------
  private flashBar(color: 'green' | 'red'): void {
    this.flashQueue.push(color);
    this.processFlashQueue();
  }

  private processFlashQueue(): void {
    if (this.flashBusy || this.flashQueue.length === 0) return;
    this.flashBusy = true;
    const color = this.flashQueue.shift()!;
    this.zone.run(() => {
      this.barFlash = color;
      setTimeout(() => {
        this.zone.run(() => {
          this.barFlash = null;
          this.flashBusy = false;
          this.processFlashQueue();
        });
      }, this.params.feedback_flash_ms);
    });
  }

  /** Mostra "Você acertou +N" ancorado acima do botão que foi reforçado. */
  private banner(role: Role): void {
    const btn = this.buttons.find((b) => b.role === role);
    if (!btn) return;
    this.zone.run(() => {
      this.reinforcementFeedback = {
        x: btn.x + BUTTON_SIZE / 2,
        y: btn.y,
        text: `😄 Você acertou +${this.params.reinforcement_points}`,
      };
      setTimeout(() => {
        this.zone.run(() => (this.reinforcementFeedback = null));
      }, FEEDBACK_TEXT_MS);
    });
  }

  /** Mostra "−N" ancorado abaixo do botão que sofreu o custo/punição. */
  private flashCost(role: Role, amount: number): void {
    const btn = this.buttons.find((b) => b.role === role);
    if (!btn) return;
    this.zone.run(() => {
      this.costFeedback = {
        x: btn.x + BUTTON_SIZE / 2,
        y: btn.y + BUTTON_SIZE,
        text: `−${amount}`,
      };
      setTimeout(() => {
        this.zone.run(() => (this.costFeedback = null));
      }, FEEDBACK_TEXT_MS);
    });
  }

  /** Anima `displayPoints` suavemente até `target` (puramente cosmético). */
  private animatePointsTo(target: number): void {
    cancelAnimationFrame(this.pointsAnimId);
    const start = this.displayPoints;
    const startTime = performance.now();
    const duration = 350;
    const step = (now: number) => {
      const p = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cúbico
      this.zone.run(() => {
        this.displayPoints = Math.round(start + (target - start) * eased);
      });
      if (p < 1) {
        this.pointsAnimId = requestAnimationFrame(step);
      }
    };
    this.pointsAnimId = requestAnimationFrame(step);
  }

  /** Pequena explosão de partículas na barra de pontos ao reforçar. */
  private burstParticles(): void {
    const created = Array.from({ length: 10 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const distance = 28 + Math.random() * 32;
      return {
        id: this.particleSeq++,
        dx: Math.round(Math.cos(angle) * distance),
        dy: Math.round(Math.sin(angle) * distance),
        hue: 40 + Math.round(Math.random() * 35),
      };
    });
    this.zone.run(() => {
      this.particles.push(...created);
      const ids = new Set(created.map((p) => p.id));
      setTimeout(() => {
        this.zone.run(() => {
          this.particles = this.particles.filter((p) => !ids.has(p.id));
        });
      }, 650);
    });
  }

  // ---------------------------------------------------------------------------
  // Movimento e geometria
  // ---------------------------------------------------------------------------
  /** As 4 zonas/workspaces em grade 2x2 (adaptação do apêndice do estudo
   * original: cada botão se move dentro do seu próprio "transparent-gray
   * rectangular workspace", nunca invadindo o espaço dos outros). */
  zones: Zone[] = [];

  private measureArena(): void {
    const el = this.arenaRef.nativeElement;
    this.arenaW = el.clientWidth;
    this.arenaH = el.clientHeight;
    this.computeZones();
  }

  private computeZones(): void {
    const w = (this.arenaW - ZONE_GAP * 3) / 2;
    const h = (this.arenaH - ZONE_GAP * 3) / 2;
    this.zones = [
      { x: ZONE_GAP, y: ZONE_GAP, w, h }, // topo-esquerda
      { x: ZONE_GAP * 2 + w, y: ZONE_GAP, w, h }, // topo-direita
      { x: ZONE_GAP, y: ZONE_GAP * 2 + h, w, h }, // baixo-esquerda
      { x: ZONE_GAP * 2 + w, y: ZONE_GAP * 2 + h, w, h }, // baixo-direita
    ];
  }

  /** Deriva de qual quadrante (0..3) o contrabalanceamento do backend indica,
   * a partir da fração x/y já sorteada (evita mudar o contrato com o backend:
   * x<0,5 = esquerda, y<0,5 = topo). */
  private quadrantFor(fracX: number, fracY: number): number {
    const left = fracX < 0.5;
    const top = fracY < 0.5;
    if (top && left) return 0;
    if (top && !left) return 1;
    if (!top && left) return 2;
    return 3;
  }

  private placeButtonsInitial(): void {
    const cb = this.config.counterbalance;
    const roles: Role[] = ['R1', 'R2', 'CONTROL1', 'CONTROL2'];
    this.buttons = roles.map((role) => {
      const p = cb[role];
      const z = this.zones[this.quadrantFor(p.x, p.y)];
      return {
        role,
        symbol: p.symbol,
        zone: z,
        x: z.x + (z.w - BUTTON_SIZE) / 2,
        y: z.y + (z.h - BUTTON_SIZE) / 2,
        opacity: 1,
      };
    });
  }

  /** Move cada botão 20px numa direção aleatória, confinado à sua própria
   * zona — como as zonas nunca se sobrepõem, os botões nunca se tocam. */
  private moveButtons(): void {
    const step = this.params.move_step_px;
    const directions = [
      { dx: 0, dy: -step },
      { dx: 0, dy: step },
      { dx: -step, dy: 0 },
      { dx: step, dy: 0 },
    ];
    for (const b of this.buttons) {
      const d = shuffleInPlace([...directions])[0];
      const maxX = b.zone.x + b.zone.w - BUTTON_SIZE;
      const maxY = b.zone.y + b.zone.h - BUTTON_SIZE;
      b.x = Math.max(b.zone.x, Math.min(maxX, b.x + d.dx));
      b.y = Math.max(b.zone.y, Math.min(maxY, b.y + d.dy));
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
    for (const b of this.buttons) {
      const cb = this.config.counterbalance[b.role];
      const z = this.zones[this.quadrantFor(cb.x, cb.y)];
      b.zone = z;
      const maxX = z.x + z.w - BUTTON_SIZE;
      const maxY = z.y + z.h - BUTTON_SIZE;
      b.x = Math.max(z.x, Math.min(maxX, b.x));
      b.y = Math.max(z.y, Math.min(maxY, b.y));
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
