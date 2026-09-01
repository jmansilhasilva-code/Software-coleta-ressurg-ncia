"""
Parâmetros do protocolo experimental (derivados do Projeto PIC 2026).

Centraliza as constantes do experimento e a geração do contrabalanceamento e da
configuração enviada ao cliente Angular. Manter as regras numéricas aqui facilita
auditoria e ajustes durante a fase de calibração do software.
"""
from __future__ import annotations

import random

from .models import Group

# ---------------------------------------------------------------------------
# Parâmetros gerais (iguais para todos os grupos)
# ---------------------------------------------------------------------------
PHASE_DURATION_S = 300          # 5 min por fase
DEV_PHASE_DURATION_S = 30       # modo de teste rápido
N_PHASES = 3

VI_SECONDS = 2.0                # esquema VI 2 s (Fase 1: R1; Fase 2: R2)
REINFORCEMENT_POINTS = 100      # +100 pts por reforço
RESPONSE_COST_POINTS = 1        # custo de resposta universal: −1 pt por toque em botão
RC1000_POINTS = 1000            # custo elevado da Fase 2 (grupo RC1000)

FEEDBACK_FLASH_MS = 500         # barra verde/vermelha por 0,5 s
SOUND_DURATIONS_MS = {"SOM2": 2000, "SOM5": 5000}

# Changeover delay (COD): trocar de botão bloqueia o reforço no novo botão por
# esse período — evita reforçar a própria alternância entre respostas. Valor e
# mecanismo (geral entre quaisquer botões) definidos com o orientador; segue a
# tradição de esquemas concorrentes (~2 s), igual à média do VI desta tarefa.
# Precedente em ressurgência: Sweeney & Shahan (2015) usaram 3 s com o mesmo
# propósito (não reforçar R2 se R1 ocorreu nos últimos N segundos).
CHANGEOVER_DELAY_MS = 2000

# Botões somem da tela por um período após certos eventos (feedback claro de
# que a consequência ocorreu). Confirmado com o usuário (31/08/2026): reforço
# esconde por REINFORCEMENT_HIDE_MS; a PUNIÇÃO específica de R1 na Fase 2
# (RC-1000 ou som aversivo) esconde por PUNISHMENT_HIDE_MS — o custo universal
# de −1 (que ocorre em qualquer toque, em qualquer fase) NÃO aciona isso, ou os
# botões sumiriam quase o tempo todo.
REINFORCEMENT_HIDE_MS = 1000
PUNISHMENT_HIDE_MS = 5000

# Movimento dos botões
MOVE_STEP_PX = 20
MOVE_INTERVAL_MS = 200

# Símbolos atribuíveis aos botões (contrabalanceados entre participantes)
SYMBOLS = ["▲", "■", "●", "◆", "★", "✚"]
ROLES = ["R1", "R2", "CONTROL1", "CONTROL2"]

# Posições iniciais relativas (fração da arena 0..1), embaralhadas entre papéis
# — grade 2x2 bem espaçada, para não haver sobreposição inicial entre os 4 botões.
INITIAL_SLOTS = [
    {"x": 0.18, "y": 0.25},
    {"x": 0.82, "y": 0.25},
    {"x": 0.18, "y": 0.75},
    {"x": 0.82, "y": 0.75},
]


def build_counterbalance(rng: random.Random | None = None) -> dict:
    """Sorteia símbolo e posição inicial para cada papel (R1/R2/CONTROL1/CONTROL2)."""
    rng = rng or random
    symbols = rng.sample(SYMBOLS, k=len(ROLES))
    slots = INITIAL_SLOTS[:]
    rng.shuffle(slots)
    return {
        role: {"symbol": symbols[i], **slots[i]}
        for i, role in enumerate(ROLES)
    }


def group_phase2_contingency(group: str) -> dict:
    """Descreve a contingência adicional aplicada a R1 na Fase 2 por grupo."""
    if group == Group.RC1000:
        return {"cost_points": RC1000_POINTS, "sound_ms": 0}
    if group == Group.SOM2:
        return {"cost_points": RESPONSE_COST_POINTS, "sound_ms": SOUND_DURATIONS_MS["SOM2"]}
    if group == Group.SOM5:
        return {"cost_points": RESPONSE_COST_POINTS, "sound_ms": SOUND_DURATIONS_MS["SOM5"]}
    # EXT (controle): apenas o custo universal
    return {"cost_points": RESPONSE_COST_POINTS, "sound_ms": 0}


def build_client_config(session) -> dict:
    """Monta o payload de configuração consumido pelo cliente Angular."""
    return {
        "session_id": str(session.id),
        "group": session.group,
        "counterbalance": session.counterbalance,
        "params": {
            "phase_duration_s": PHASE_DURATION_S,
            "dev_phase_duration_s": DEV_PHASE_DURATION_S,
            "n_phases": N_PHASES,
            "vi_seconds": VI_SECONDS,
            "reinforcement_points": REINFORCEMENT_POINTS,
            "response_cost_points": RESPONSE_COST_POINTS,
            "feedback_flash_ms": FEEDBACK_FLASH_MS,
            "move_step_px": MOVE_STEP_PX,
            "move_interval_ms": MOVE_INTERVAL_MS,
            "changeover_delay_ms": CHANGEOVER_DELAY_MS,
            "reinforcement_hide_ms": REINFORCEMENT_HIDE_MS,
            "punishment_hide_ms": PUNISHMENT_HIDE_MS,
            "phase2_contingency": group_phase2_contingency(session.group),
        },
    }
