from rest_framework import serializers

from .models import Event, Participant, Session


class ParticipantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Participant
        fields = ["id", "external_id", "age", "sex", "created_at"]
        read_only_fields = ["id", "created_at"]


class EventSerializer(serializers.ModelSerializer):
    class Meta:
        model = Event
        fields = [
            "id",
            "phase",
            "event_type",
            "button_role",
            "t_ms",
            "points_delta",
            "points_total",
            "sound_ms",
        ]
        read_only_fields = ["id"]


class SessionSerializer(serializers.ModelSerializer):
    participant_detail = ParticipantSerializer(source="participant", read_only=True)

    class Meta:
        model = Session
        fields = [
            "id",
            "participant",
            "participant_detail",
            "group",
            "counterbalance",
            "dev_mode",
            "status",
            "notes",
            "created_at",
            "started_at",
            "finished_at",
        ]
        read_only_fields = ["id", "counterbalance", "created_at"]


class SessionCreateSerializer(serializers.Serializer):
    """Entrada da tela do operador para iniciar uma sessão."""

    external_id = serializers.CharField(max_length=64)
    age = serializers.IntegerField(required=False, allow_null=True, min_value=0, max_value=120)
    sex = serializers.ChoiceField(
        choices=["F", "M", "O"], required=False, allow_blank=True, default=""
    )
    # Opcional: o operador pode forçar um grupo; vazio = atribuição balanceada.
    group = serializers.ChoiceField(
        choices=["EXT", "RC1000", "SOM2", "SOM5"], required=False, allow_blank=True, default=""
    )
    # Necessário para calcular corretamente a duração de fase (300 s vs 30 s)
    # ao agregar estatísticas por fase/bin no backend.
    dev_mode = serializers.BooleanField(required=False, default=False)


class EventBatchSerializer(serializers.Serializer):
    """Upload em lote do log de eventos (enviado ao fim de cada fase)."""

    events = EventSerializer(many=True)
