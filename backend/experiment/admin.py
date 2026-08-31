import csv

from django.contrib import admin
from django.db.models import Count
from django.http import HttpResponse
from django.urls import reverse
from django.utils.html import format_html

from .models import Event, Participant, Session


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


@admin.action(description="Exportar selecionadas para planilha (CSV)")
def export_sessions_csv(modeladmin, request, queryset):
    response = HttpResponse(content_type="text/csv")
    response["Content-Disposition"] = 'attachment; filename="dados_ressurgencia.csv"'
    events = Event.objects.filter(session__in=queryset).order_by(
        "session", "t_ms", "id"
    )
    _write_events_csv(response, events)
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
    list_filter = ["group", "status"]
    search_fields = ["participant__external_id", "id"]
    readonly_fields = ["id", "created_at", "started_at", "finished_at", "counterbalance"]
    inlines = [EventInline]
    actions = [export_sessions_csv]

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

    @admin.display(description="Planilha")
    def baixar_csv(self, obj):
        url = reverse("session-export", args=[obj.id])
        return format_html('<a href="{}">Baixar CSV</a>', url)


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ["session", "phase", "event_type", "button_role", "t_ms", "points_total"]
    list_filter = ["phase", "event_type", "button_role", "session__group"]
    search_fields = ["session__id", "session__participant__external_id"]
