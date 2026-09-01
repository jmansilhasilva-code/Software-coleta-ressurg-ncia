import uuid

from django.db import models


class Group(models.TextChoices):
    """Grupos experimentais (diferem apenas na contingência de R1 na Fase 2)."""

    EXT = "EXT", "Controle (extinção simples)"
    RC1000 = "RC1000", "Custo elevado (−1000 pts)"
    SOM2 = "SOM2", "Som aversivo 2 s"
    SOM5 = "SOM5", "Som aversivo 5 s"


class Sex(models.TextChoices):
    FEMALE = "F", "Feminino"
    MALE = "M", "Masculino"
    OTHER = "O", "Outro / não informado"


class Participant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    external_id = models.CharField(
        max_length=64, help_text="Identificador atribuído pelo operador (ex.: P001)."
    )
    age = models.PositiveSmallIntegerField(null=True, blank=True)
    sex = models.CharField(max_length=1, choices=Sex.choices, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.external_id} ({self.id})"


class Session(models.Model):
    class Status(models.TextChoices):
        CREATED = "created", "Criada"
        RUNNING = "running", "Em andamento"
        FINISHED = "finished", "Concluída"
        ABORTED = "aborted", "Interrompida"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    participant = models.ForeignKey(
        Participant, on_delete=models.CASCADE, related_name="sessions"
    )
    group = models.CharField(max_length=8, choices=Group.choices)
    # Contrabalanceamento: papel(R1/R2/CONTROL1/CONTROL2) -> {symbol, x, y}.
    counterbalance = models.JSONField(default=dict)
    # Necessário para calcular corretamente a duração de fase (300 s vs 30 s do
    # modo dev) ao agregar estatísticas por fase/bin — ver experiment/analytics.py.
    dev_mode = models.BooleanField(default=False)
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.CREATED
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.participant.external_id} · {self.group} · {self.status}"


class Event(models.Model):
    """Evento bruto registrado no cliente (resposta ou consequência)."""

    class Type(models.TextChoices):
        RESPONSE = "response", "Resposta (toque em botão)"
        REINFORCEMENT = "reinforcement", "Reforço (+pts)"
        COST = "cost", "Custo de resposta (−pts)"
        SOUND = "sound", "Estímulo sonoro aversivo"

    class Role(models.TextChoices):
        R1 = "R1", "Resposta-alvo"
        R2 = "R2", "Resposta alternativa"
        CONTROL1 = "CONTROL1", "Botão controle 1"
        CONTROL2 = "CONTROL2", "Botão controle 2"

    id = models.BigAutoField(primary_key=True)
    session = models.ForeignKey(
        Session, on_delete=models.CASCADE, related_name="events"
    )
    phase = models.PositiveSmallIntegerField()  # 1, 2 ou 3
    event_type = models.CharField(max_length=16, choices=Type.choices)
    button_role = models.CharField(max_length=8, choices=Role.choices, blank=True)
    # Milissegundos desde started_at (relógio da SESSÃO INTEIRA, não da fase),
    # medidos no cliente (performance.now()).
    t_ms = models.IntegerField()
    points_delta = models.IntegerField(default=0)
    points_total = models.IntegerField(default=0)
    # Duração do som em ms (apenas event_type=sound).
    sound_ms = models.IntegerField(null=True, blank=True)

    class Meta:
        ordering = ["session", "t_ms", "id"]
        indexes = [models.Index(fields=["session", "phase"])]

    def __str__(self):
        return f"[{self.session_id}] f{self.phase} {self.event_type} {self.button_role} @{self.t_ms}ms"


class PhaseStat(models.Model):
    """Pontuação agregada de uma fase (recalculada a partir do log de eventos)."""

    session = models.ForeignKey(
        Session, on_delete=models.CASCADE, related_name="phase_stats"
    )
    phase = models.PositiveSmallIntegerField()
    points_start = models.IntegerField()
    points_end = models.IntegerField()
    points_delta = models.IntegerField()
    duration_s = models.PositiveIntegerField()
    n_bins = models.PositiveSmallIntegerField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["session", "phase"], name="unique_phase_stat"
            )
        ]
        ordering = ["session", "phase"]

    def __str__(self):
        return f"[{self.session_id}] fase {self.phase}: {self.points_delta:+d} pts"


class ButtonPhaseStat(models.Model):
    """Estatísticas por botão dentro de uma fase: cliques/min, reforços/min etc."""

    session = models.ForeignKey(
        Session, on_delete=models.CASCADE, related_name="button_phase_stats"
    )
    phase = models.PositiveSmallIntegerField()
    button_role = models.CharField(max_length=8, choices=Event.Role.choices)
    response_count = models.PositiveIntegerField(default=0)
    responses_per_minute = models.FloatField(default=0)
    reinforcement_count = models.PositiveIntegerField(default=0)
    reinforcements_per_minute = models.FloatField(default=0)
    cost_count = models.PositiveIntegerField(default=0)
    points_delta = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["session", "phase", "button_role"],
                name="unique_button_phase_stat",
            )
        ]
        ordering = ["session", "phase", "button_role"]

    def __str__(self):
        return f"[{self.session_id}] fase {self.phase} {self.button_role}: {self.responses_per_minute:.1f}/min"


class PhaseBin(models.Model):
    """Contagem de respostas por botão em blocos (bins) de 10 s dentro da fase."""

    session = models.ForeignKey(
        Session, on_delete=models.CASCADE, related_name="phase_bins"
    )
    phase = models.PositiveSmallIntegerField()
    button_role = models.CharField(max_length=8, choices=Event.Role.choices)
    bin_index = models.PositiveSmallIntegerField()
    bin_start_s = models.PositiveIntegerField()
    bin_end_s = models.PositiveIntegerField()
    response_count = models.PositiveIntegerField(default=0)
    reinforcement_count = models.PositiveIntegerField(default=0)
    cost_count = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["session", "phase", "button_role", "bin_index"],
                name="unique_phase_bin",
            )
        ]
        ordering = ["session", "phase", "button_role", "bin_index"]
        indexes = [models.Index(fields=["session", "phase", "button_role"])]

    def __str__(self):
        return (
            f"[{self.session_id}] fase {self.phase} {self.button_role} "
            f"bin {self.bin_index} ({self.bin_start_s}-{self.bin_end_s}s): "
            f"{self.response_count} resp"
        )
