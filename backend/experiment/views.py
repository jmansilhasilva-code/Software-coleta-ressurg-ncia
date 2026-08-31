from __future__ import annotations

import csv
import random

from django.db.models import Count
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from . import protocol
from .models import Event, Group, Participant, Session
from .serializers import (
    EventBatchSerializer,
    SessionCreateSerializer,
    SessionSerializer,
)

ALL_GROUPS = [Group.EXT, Group.RC1000, Group.SOM2, Group.SOM5]


def assign_balanced_group(rng: random.Random | None = None) -> str:
    """Escolhe o grupo com menor n atual (empate desfeito aleatoriamente)."""
    rng = rng or random
    counts = {g: 0 for g in ALL_GROUPS}
    for row in Session.objects.values("group").annotate(n=Count("id")):
        if row["group"] in counts:
            counts[row["group"]] = row["n"]
    fewest = min(counts.values())
    candidates = [g for g, n in counts.items() if n == fewest]
    return rng.choice(candidates)


class SessionViewSet(viewsets.ModelViewSet):
    queryset = Session.objects.select_related("participant").all()
    serializer_class = SessionSerializer

    def create(self, request, *args, **kwargs):
        payload = SessionCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        participant = Participant.objects.create(
            external_id=data["external_id"],
            age=data.get("age"),
            sex=data.get("sex") or "",
        )
        group = data.get("group") or assign_balanced_group()
        session = Session.objects.create(
            participant=participant,
            group=group,
            counterbalance=protocol.build_counterbalance(),
        )
        return Response(
            {
                "session": SessionSerializer(session).data,
                "config": protocol.build_client_config(session),
            },
            status=status.HTTP_201_CREATED,
        )

    def partial_update(self, request, *args, **kwargs):
        """Atualiza status; gerencia timestamps de início/fim."""
        session = self.get_object()
        new_status = request.data.get("status")
        if new_status == Session.Status.RUNNING and not session.started_at:
            session.started_at = timezone.now()
        if new_status in (Session.Status.FINISHED, Session.Status.ABORTED):
            session.finished_at = timezone.now()
        if new_status:
            session.status = new_status
        if "notes" in request.data:
            session.notes = request.data["notes"]
        session.save()
        return Response(SessionSerializer(session).data)

    @action(detail=True, methods=["post"])
    def events(self, request, pk=None):
        """Upload em lote do log de eventos do cliente."""
        session = self.get_object()
        batch = EventBatchSerializer(data=request.data)
        batch.is_valid(raise_exception=True)
        rows = batch.validated_data["events"]
        Event.objects.bulk_create([Event(session=session, **row) for row in rows])
        return Response({"created": len(rows)}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def export(self, request, pk=None):
        """Exporta o log da sessão em CSV (uma linha por evento)."""
        session = self.get_object()
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = (
            f'attachment; filename="session_{session.id}.csv"'
        )
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
        for e in session.events.all():
            writer.writerow(
                [
                    session.id,
                    session.participant.external_id,
                    session.group,
                    e.phase,
                    e.event_type,
                    e.button_role,
                    e.t_ms,
                    e.points_delta,
                    e.points_total,
                    e.sound_ms if e.sound_ms is not None else "",
                ]
            )
        return response
