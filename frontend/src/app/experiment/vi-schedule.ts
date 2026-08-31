/**
 * Esquema de Intervalo Variável (VI), construído por progressão de Fleshler-Hoffman
 * (1962) — o método padrão na literatura de Análise do Comportamento para gerar
 * esquemas VI (usado, e.g., por Podlesnik & Shahan, Craig et al., Kestner et al.,
 * Martinez-Perez et al., citados no projeto).
 *
 * Um VI real não é "sortear um intervalo aleatório a cada reforço" — isso seria um
 * esquema RI (Random Interval), com distribuição exponencial de cauda ilimitada
 * (podendo gerar intervalos absurdamente longos). Um VI é definido por um conjunto
 * finito de N intervalos DIFERENTES cuja média é o valor nominal do esquema (ex.:
 * VI 2 s pode ter componentes como 1 s, 3 s, 5 s etc., cuja média é 2 s). Esses N
 * intervalos são apresentados em ordem embaralhada, sem reposição dentro do ciclo;
 * ao esgotar o ciclo, a lista é reembaralhada e reiniciada.
 *
 * Os componentes são gerados pela fórmula clássica de Fleshler-Hoffman a partir da
 * função quantil da distribuição exponencial, amostrada nos pontos médios de N
 * faixas de probabilidade iguais: I_k = -T · ln(1 − (k − 0,5)/N), k = 1..N. Essa
 * amostragem estratificada elimina os intervalos extremos de uma amostragem
 * exponencial pura, preservando a propriedade de probabilidade aproximadamente
 * constante de reforço por unidade de tempo (por isso o VI não produz pausas
 * pós-reforço, ao contrário do esquema de intervalo fixo). Os N valores são então
 * reescalados para que sua média seja EXATAMENTE T (a fórmula por si só converge
 * para T conforme N cresce, mas fica com um pequeno viés para N finito).
 *
 * Assim como em qualquer esquema de intervalo, a passagem do tempo por si só não
 * produz reforço: o reforço fica "disponível" ao fim do intervalo sorteado, e só é
 * entregue na primeira resposta-alvo emitida depois disso.
 */
export class VISchedule {
  private armed = false;
  private nextArmAtMs = 0;
  private readonly intervalsMs: readonly number[];
  private queue: number[] = [];

  constructor(meanSeconds: number, componentCount = 12) {
    this.intervalsMs = VISchedule.buildFleshlerHoffman(
      meanSeconds * 1000,
      componentCount
    );
  }

  /** Reinicia o esquema, agendando o primeiro intervalo a partir de `nowMs`. */
  reset(nowMs: number): void {
    this.armed = false;
    this.queue = [];
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
    if (this.queue.length === 0) {
      this.queue = VISchedule.shuffle(this.intervalsMs);
    }
    const interval = this.queue.pop()!;
    this.nextArmAtMs = nowMs + interval;
  }

  /**
   * Gera os `n` componentes de Fleshler-Hoffman cuja média é exatamente `meanMs`.
   */
  private static buildFleshlerHoffman(meanMs: number, n: number): number[] {
    const raw = Array.from({ length: n }, (_, i) => {
      const k = i + 1;
      return -meanMs * Math.log(1 - (k - 0.5) / n);
    });
    const rawMean = raw.reduce((sum, v) => sum + v, 0) / n;
    const scale = meanMs / rawMean;
    return raw.map((v) => v * scale);
  }

  private static shuffle(arr: readonly number[]): number[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
