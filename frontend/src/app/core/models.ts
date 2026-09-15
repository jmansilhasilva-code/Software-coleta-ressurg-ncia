export type Role = 'R1' | 'R2' | 'CONTROL1' | 'CONTROL2';
export type GroupCode = 'EXT' | 'RC1000' | 'SOM2' | 'SOM5';
export type EventType = 'response' | 'reinforcement' | 'cost' | 'sound';

export interface RolePlacement {
  symbol: string;
  x: number; // fração 0..1 da arena
  y: number; // fração 0..1 da arena
}

export type Counterbalance = Record<Role, RolePlacement>;

export interface Phase2Contingency {
  cost_points: number; // custo aplicado a R1 na Fase 2 (0 ou 1000 — RC1000)
  sound_ms: number; // duração do som aversivo (0 se não houver)
}

export interface ExperimentParams {
  phase_duration_s: number;
  dev_phase_duration_s: number;
  n_phases: number;
  vi_seconds: number;
  reinforcement_points: number;
  // Não existe custo de resposta universal: tocar em qualquer botão (mesmo os
  // de controle) não tem nenhuma consequência por si só. Este é o único custo
  // de −1 pt que resta — técnico, não comportamental: cobre o caso de o
  // participante tocar em 2+ botões ao mesmo tempo (comum em touchscreen).
  multi_touch_cost_points: number;
  feedback_flash_ms: number;
  move_step_px: number;
  move_interval_ms: number;
  changeover_delay_ms: number;
  reinforcement_hide_ms: number;
  punishment_hide_ms: number;
  phase2_contingency: Phase2Contingency;
}

export interface ClientConfig {
  session_id: string;
  group: GroupCode;
  counterbalance: Counterbalance;
  params: ExperimentParams;
}

export interface SessionCreateResponse {
  session: { id: string; group: GroupCode; [k: string]: unknown };
  config: ClientConfig;
}

export interface SessionCreatePayload {
  external_id: string;
  age?: number | null;
  sex?: string;
  group?: string; // vazio = atribuição balanceada
  dev_mode?: boolean;
}

export interface EventLog {
  phase: number;
  event_type: EventType;
  button_role: Role | '';
  t_ms: number;
  points_delta: number;
  points_total: number;
  sound_ms?: number | null;
}

export const GROUP_LABELS: Record<GroupCode, string> = {
  EXT: 'Controle (extinção)',
  RC1000: 'Custo elevado (−1000)',
  SOM2: 'Som aversivo 2 s',
  SOM5: 'Som aversivo 5 s',
};
