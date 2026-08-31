import { Injectable } from '@angular/core';

/**
 * Reprodução do estímulo sonoro aversivo via Web Audio API, com duração controlada.
 *
 * IMPORTANTE: o nível real em dB depende do fone/dispositivo e exige calibração
 * física externa. Aqui usamos um ganho fixo normalizado.
 */
@Injectable({ providedIn: 'root' })
export class AudioService {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private loading: Promise<void> | null = null;
  private readonly gain = 1.0; // ganho fixo (calibração de dB é externa)
  private readonly url = 'assets/WorstSound1.mp3';

  /** Pré-carrega e decodifica o áudio. Deve ser chamado após um gesto do usuário. */
  async preload(): Promise<void> {
    if (this.buffer) return;
    if (this.loading) return this.loading;
    this.loading = this.doLoad();
    return this.loading;
  }

  private async doLoad(): Promise<void> {
    this.ctx = this.ctx ?? new AudioContext();
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    try {
      const resp = await fetch(this.url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.arrayBuffer();
      this.buffer = await this.ctx.decodeAudioData(data);
    } catch (err) {
      // Sem o arquivo de áudio o experimento ainda roda (apenas sem som).
      console.warn('AudioService: não foi possível carregar', this.url, err);
      this.buffer = null;
    }
  }

  /** Toca o som pela duração indicada (ms), cortando o restante do arquivo. */
  play(durationMs: number): void {
    if (!this.ctx || !this.buffer || durationMs <= 0) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    const gainNode = this.ctx.createGain();
    gainNode.gain.value = this.gain;
    source.connect(gainNode).connect(this.ctx.destination);
    source.start(0);
    source.stop(this.ctx.currentTime + durationMs / 1000);
  }
}
