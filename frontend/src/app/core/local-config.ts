import {
  ClientConfig,
  Counterbalance,
  GroupCode,
  Phase2Contingency,
  Role,
} from './models';

/**
 * Gera uma ClientConfig localmente (espelha o backend) para testar a tarefa sem
 * servidor. Usado como fallback quando o backend não responde.
 */
const SYMBOLS = ['▲', '■', '●', '◆', '★', '✚'];
const ROLES: Role[] = ['R1', 'R2', 'CONTROL1', 'CONTROL2'];
// Grade 2x2 bem espaçada — evita sobreposição inicial entre os 4 botões.
const SLOTS = [
  { x: 0.18, y: 0.25 },
  { x: 0.82, y: 0.25 },
  { x: 0.18, y: 0.75 },
  { x: 0.82, y: 0.75 },
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function phase2Contingency(group: GroupCode): Phase2Contingency {
  switch (group) {
    case 'RC1000':
      return { cost_points: 1000, sound_ms: 0 };
    case 'SOM2':
      return { cost_points: 1, sound_ms: 2000 };
    case 'SOM5':
      return { cost_points: 1, sound_ms: 5000 };
    default:
      return { cost_points: 1, sound_ms: 0 };
  }
}

export function buildLocalConfig(group?: GroupCode): ClientConfig {
  const groups: GroupCode[] = ['EXT', 'RC1000', 'SOM2', 'SOM5'];
  const g = group ?? groups[Math.floor(Math.random() * groups.length)];

  const symbols = shuffle(SYMBOLS).slice(0, 4);
  const slots = shuffle(SLOTS);
  const counterbalance = ROLES.reduce((acc, role, i) => {
    acc[role] = { symbol: symbols[i], ...slots[i] };
    return acc;
  }, {} as Counterbalance);

  return {
    session_id: `local-${Date.now()}`,
    group: g,
    counterbalance,
    params: {
      phase_duration_s: 300,
      dev_phase_duration_s: 30,
      n_phases: 3,
      vi_seconds: 2.0,
      reinforcement_points: 100,
      response_cost_points: 1,
      feedback_flash_ms: 500,
      move_step_px: 20,
      move_interval_ms: 200,
      changeover_delay_ms: 2000,
      reinforcement_hide_ms: 1000,
      punishment_hide_ms: 5000,
      phase2_contingency: phase2Contingency(g),
    },
  };
}
