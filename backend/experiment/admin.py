import csv

from django.contrib import admin
from django.db.models import Count
from django.http import HttpResponse
from django.urls import reverse
from django.utils.html import format_html

from .models import ButtonPhaseStat, Event, Participant, PhaseBin, PhaseStat, Session


def _write_events_csv(response, events):
    """Escreve eventos (queryset) em um CSV — a 'planilha' com os dados."""
    writer = csv.writer(response)
    writer.writerow(
        [
            "session_id",
            "participant",
            "group",
            "phase",
            "event_type",
            "button_role",
            "t_ms",
            "points_delta",
            "points_total",
            "sound_ms",
        ]
    )
    for e in events.select_related("session", "session__participant"):
        writer.writerow(
            [
                e.session_id,
                e.session.participant.external_id,
                e.session.group,
                e.phase,
                e.event_type,
                e.button_role,
                e.t_ms,
                e.points_delta,
                e.points_total,
                e.sound_ms if e.sound_ms is not None else "",
            ]
        )


def _write_phase_stats_csv(response, sessions_qs):
    """Escreve pontuação/cliques-min/reforços-min por fase e por botão."""
    writer = csv.writer(response)
    writer.writerow(
        [
            "session_id",
            "participant",
            "group",
            "phase",
            "phase_points_start",
            "phase_points_end",
            "phase_points_delta",
            "phase_duration_s",
            "button_role",
            "response_count",
            "responses_per_minute",
            "reinforcement_count",
            "reinforcements_per_minute",
            "cost_count",
            "button_points_delta",
        ]
    )
    for session in sessions_qs.select_related("participant"):
        phase_stats = {p.phase: p for p in session.phase_stats.all()}
        for bp in session.button_phase_stats.all():
            ps = phase_stats.get(bp.phase)
            writer.writerow(
                [
                    session.id,
                    session.participant.external_id,
                    session.group,
                    bp.phase,
                    ps.points_start if ps else "",
                    ps.points_end if ps else "",
                    ps.points_delta if ps else "",
                    ps.duration_s if ps else "",
                    bp.button_role,
                    bp.response_count,
                    round(bp.responses_per_minute, 2),
                    bp.reinforcement_count,
                    round(bp.reinforcements_per_minute, 2),
                    bp.cost_count,
                    bp.points_delta,
                ]
            )


def _write_bins_csv(response, bins_qs):
    """Escreve a contagem de respostas por botão em bins de 10 s."""
    writer = csv.writer(response)
    writer.writerow(
        [
            "session_id",
            "participant",
            "group",
            "phase",
            "button_role",
            "bin_index",
            "bin_start_s",
            "bin_end_s",
            "response_count",
            "reinforcement_count",
            "cost_count",
        ]
    )
    for b in bins_qs.select_related("session", "session__participant"):
        writer.writerow(
            [
                b.session_id,
                b.session.participant.external_id,
                b.session.group,
                b.phase,
                b.button_role,
                b.bin_index,
                b.bin_start_s,
                b.bin_end_s,
                b.response_count,
                b.reinforcement_count,
                b.cost_count,
            ]
        )


@admin.register(Participant)
class ParticipantAdmin(admin.ModelAdmin):
    list_display = ["external_id", "id", "age", "sex", "n_sessions", "created_at"]
    search_fields = ["external_id", "id"]

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(_n=Count("sessions"))

    @admin.display(description="Sessões", ordering="_n")
    def n_sessions(self, obj):
        return obj._n


class EventInline(admin.TabularInline):
    """Mostra as respostas/consequências dentro da sessão (apenas leitura)."""

    model = Event
    extra = 0
    can_delete = False
    fields = ["phase", "event_type", "button_role", "t_ms", "points_delta", "points_total", "sound_ms"]
    readonly_fields = fields
    ordering = ["t_ms", "id"]

    def has_add_permission(self, request, obj=None):
        return False


class PhaseStatInline(admin.TabularInline):
    """Pontuação de cada fase — sempre desagregada, nunca só o total da sessão."""

    model = PhaseStat
    extra = 0
    can_delete = False
    fields = ["phase", "points_start", "points_end", "points_delta", "duration_s", "n_bins"]
    readonly_fields = fields

    def has_add_permission(self, request, obj=None):
        return False


class ButtonPhaseStatInline(admin.TabularInline):
    """Cliques/min e reforços/min por botão, dentro de cada fase."""

    model = ButtonPhaseStat
    extra = 0
    can_delete = False
    fields = [
        "phase",
        "button_role",
        "response_count",
        "responses_per_minute",
        "reinforcement_count",
        "reinforcements_per_minute",
        "cost_count",
        "points_delta",
    ]
    readonly_fields = fields
    ordering = ["phase", "button_role"]

    def has_add_permission(self, request, obj=None):
        return False


@admin.action(description="Exportar eventos brutos das selecionadas (CSV)")
def export_sessions_csv(modeladmin, request, queryset):
    response = HttpResponse(content_type="text/csv")
    response["Content-Disposition"] = 'attachment; filename="dados_ressurgencia.csv"'
    events = Event.objects.filter(session__in=queryset).order_by(
        "session", "t_ms", "id"
    )
    _write_events_csv(response, events)
    return response


@admin.action(description="Exportar pontuação/cliques-min/reforços-min por fase (CSV)")
def export_phase_stats_csv(modeladmin, request, queryset):
    response = HttpResponse(content_type="text/csv")
    response["Content-Disposition"] = 'attachment; filename="estatisticas_por_fase.csv"'
    _write_phase_stats_csv(response, queryset)
    return response


@admin.action(description="Exportar respostas por bins de 10s das selecionadas (CSV)")
def export_bins_csv(modeladmin, request, queryset):
    response = HttpResponse(content_type="text/csv")
    response["Content-Disposition"] = 'attachment; filename="bins_10s.csv"'
    bins_qs = PhaseBin.objects.filter(session__in=queryset).order_by(
        "session", "phase", "button_role", "bin_index"
    )
    _write_bins_csv(response, bins_qs)
    return response


@admin.register(Session)
class SessionAdmin(admin.ModelAdmin):
    list_display = [
        "participant",
        "group",
        "status",
        "n_responses",
        "created_at",
        "finished_at",
        "baixar_csv",
    ]
    list_filter = ["group", "status", "dev_mode"]
    search_fields = ["participant__external_id", "id"]
    readonly_fields = [
        "id",
        "created_at",
        "started_at",
        "finished_at",
        "counterbalance",
        "dev_mode",
    ]
    inlines = [PhaseStatInline, ButtonPhaseStatInline, EventInline]
    actions = [export_sessions_csv, export_phase_stats_csv, export_bins_csv]

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .select_related("participant")
            .annotate(_resp=Count("events"))
        )

    @admin.display(description="Respostas", ordering="_resp")
    def n_responses(self, obj):
        return obj._resp

    @admin.display(description="Planilhas")
    def baixar_csv(self, obj):
        return format_html(
            '<a href="{}">Eventos</a> · <a href="{}">Por fase</a> · <a href="{}">Bins 10s</a>',
            reverse("session-export", args=[obj.id]),
            reverse("session-export-phase-stats", args=[obj.id]),
            reverse("session-export-bins", args=[obj.id]),
        )


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ["session", "phase", "event_type", "button_role", "t_ms", "points_total"]
    list_filter = ["phase", "event_type", "button_role", "session__group"]
    search_fields = ["session__id", "session__participant__external_id"]


@admin.register(PhaseStat)
class PhaseStatAdmin(admin.ModelAdmin):
    list_display = ["session", "phase", "points_start", "points_end", "points_delta", "duration_s", "n_bins"]
    list_filter = ["phase"]
    search_fields = ["session__id", "session__participant__external_id"]


@admin.register(ButtonPhaseStat)
class ButtonPhaseStatAdmin(admin.ModelAdmin):
    list_display = [
        "session",
        "phase",
        "button_role",
        "response_count",
        "responses_per_minute",
        "reinforcement_count",
        "reinforcements_per_minute",
        "cost_count",
    ]
    list_filter = ["phase", "button_role"]
    search_fields = ["session__id", "session__participant__external_id"]


@admin.register(PhaseBin)
class PhaseBinAdmin(admin.ModelAdmin):
    list_display = [
        "session",
        "phase",
        "button_role",
        "bin_index",
        "bin_start_s",
        "bin_end_s",
        "response_count",
        "reinforcement_count",
        "cost_count",
    ]
    list_filter = ["phase", "button_role"]
    search_fields = ["session__id", "session__participant__external_id"]
    # A exportação em massa fica na tela de Sessions (ação abaixo opera sobre
    # sessões, não sobre bins individuais — evitar reaproveitar aqui).
