"""
Agregação de estatísticas por fase e por bin (bloco de 10 s), a partir do log
bruto de eventos (Event). Regra do usuário: sempre desagregar dados por fase —
pontuação da fase, cliques/min por botão, reforços/min e contagem de respostas
por botão em bins de 10 s (30 bins numa fase de 5 min / 300 s).

Bins são a unidade padrão de análise em pesquisas de ressurgência (dividir a
sessão em blocos de tempo sucessivos para visualizar a curva de resposta dentro
da fase — ver, e.g., Craig et al., Sweeney & Shahan).
"""
from __future__ import annotations

from . import protocol
from .models import ButtonPhaseStat, Event, PhaseBin, PhaseStat, Session

BIN_SECONDS = 10


def phase_duration_s(session: Session) -> int:
    return protocol.DEV_PHASE_DURATION_S if session.dev_mode else protocol.PHASE_DURATION_S


def recompute_phase_stats(session: Session, phase: int) -> None:
    """Recalcula PhaseStat, ButtonPhaseStat e PhaseBin para (session, phase)
    a partir de TODOS os eventos daquela fase já salvos no banco. Idempotente:
    pode ser chamada novamente sem duplicar linhas (update_or_create)."""
    events = list(
        Event.objects.filter(session=session, phase=phase).order_by("t_ms", "id")
    )
    duration_s = phase_duration_s(session)
    n_bins = max(1, duration_s // BIN_SECONDS)
    # t_ms é medido desde o início da SESSÃO inteira, não da fase — normaliza
    # para o início desta fase antes de calcular o índice do bin.
    phase_start_ms = (phase - 1) * duration_s * 1000

    # --- PhaseStat: pontuação da fase ---
    if events:
        points_start = events[0].points_total - events[0].points_delta
        points_end = events[-1].points_total
    else:
        points_start = 0
        points_end = 0
    PhaseStat.objects.update_or_create(
        session=session,
        phase=phase,
        defaults={
            "points_start": points_start,
            "points_end": points_end,
            "points_delta": points_end - points_start,
            "duration_s": duration_s,
            "n_bins": n_bins,
        },
    )

    # --- ButtonPhaseStat + PhaseBin: por botão ---
    minutes = duration_s / 60.0
    roles = [choice for choice, _ in Event.Role.choices]

    for role in roles:
        role_events = [e for e in events if e.button_role == role]
        response_count = sum(1 for e in role_events if e.event_type == Event.Type.RESPONSE)
        reinforcement_count = sum(
            1 for e in role_events if e.event_type == Event.Type.REINFORCEMENT
        )
        cost_count = sum(1 for e in role_events if e.event_type == Event.Type.COST)
        points_delta_role = sum(e.points_delta for e in role_events)

        ButtonPhaseStat.objects.update_or_create(
            session=session,
            phase=phase,
            button_role=role,
            defaults={
                "response_count": response_count,
                "responses_per_minute": (response_count / minutes) if minutes else 0,
                "reinforcement_count": reinforcement_count,
                "reinforcements_per_minute": (
                    (reinforcement_count / minutes) if minutes else 0
                ),
                "cost_count": cost_count,
                "points_delta": points_delta_role,
            },
        )

        bin_counts = [
            {"response": 0, "reinforcement": 0, "cost": 0} for _ in range(n_bins)
        ]
        for e in role_events:
            t_in_phase = e.t_ms - phase_start_ms
            idx = min(n_bins - 1, max(0, t_in_phase // (BIN_SECONDS * 1000)))
            if e.event_type == Event.Type.RESPONSE:
                bin_counts[idx]["response"] += 1
            elif e.event_type == Event.Type.REINFORCEMENT:
                bin_counts[idx]["reinforcement"] += 1
            elif e.event_type == Event.Type.COST:
                bin_counts[idx]["cost"] += 1

        for idx, counts in enumerate(bin_counts):
            PhaseBin.objects.update_or_create(
                session=session,
                phase=phase,
                button_role=role,
                bin_index=idx,
                defaults={
                    "bin_start_s": idx * BIN_SECONDS,
                    "bin_end_s": (idx + 1) * BIN_SECONDS,
                    "response_count": counts["response"],
                    "reinforcement_count": counts["reinforcement"],
                    "cost_count": counts["cost"],
                },
            )
