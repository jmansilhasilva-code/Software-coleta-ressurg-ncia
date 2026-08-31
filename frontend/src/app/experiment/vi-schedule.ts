/**
 * Esquema de Intervalo Variável (VI).
 *
 * Após cada reforço (ou no início), sorteia um intervalo com média = `meanSeconds`
 * (distribuição exponencial). Decorrido o intervalo, o reforço fica "disponível" e
 * é coletado na próxima resposta-alvo. Reproduz a lógica clássica de VI: o tempo
 * entre reforços varia em torno da média e a coleta depende de uma resposta.
 */
export class VISchedule {
  private armed = false;
  private nextArmAtMs = 0;
  private meanMs: number;

  constructor(meanSeconds: number) {
    this.meanMs = meanSeconds * 1000;
  }

  /** Reinicia o esquema, agendando o primeiro intervalo a partir de `nowMs`. */
  reset(nowMs: number): void {
    this.armed = false;
    this.scheduleNext(nowMs);
  }

  /** Atualiza a disponibilidade do reforço com base no tempo atual. */
  tick(nowMs: number): void {
    if (!this.armed && nowMs >= this.nextArmAtMs) {
      this.armed = true;
    }
  }

  /**
   * Tenta coletar o reforço numa resposta-alvo. Se disponível, consome e reagenda;
   * retorna true. Caso contrário, retorna false.
   */
  consume(nowMs: number): boolean {
    if (this.armed) {
      this.armed = false;
      this.scheduleNext(nowMs);
      return true;
    }
    return false;
  }

  private scheduleNext(nowMs: number): void {
    // Intervalo exponencial: -mean * ln(1 - U), média = mean.
    const u = Math.random();
    const interval = -this.meanMs * Math.log(1 - u);
    this.nextArmAtMs = nowMs + interval;
  }
}
