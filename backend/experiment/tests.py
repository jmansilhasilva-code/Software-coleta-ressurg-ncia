from rest_framework.test import APITestCase

from . import analytics
from .models import ButtonPhaseStat, Event, PhaseBin, PhaseStat, Session
from .protocol import build_counterbalance
from .views import ALL_GROUPS, assign_balanced_group


class CounterbalanceTests(APITestCase):
    def test_each_role_gets_distinct_symbol_and_position(self):
        cb = build_counterbalance()
        self.assertEqual(set(cb.keys()), {"R1", "R2", "CONTROL1", "CONTROL2"})
        symbols = [v["symbol"] for v in cb.values()]
        self.assertEqual(len(set(symbols)), 4)  # símbolos distintos
        positions = [(v["x"], v["y"]) for v in cb.values()]
        self.assertEqual(len(set(positions)), 4)  # posições distintas


class GroupBalancingTests(APITestCase):
    def test_balanced_assignment_spreads_groups(self):
        # 8 sessões → cada um dos 4 grupos deve receber exatamente 2.
        for _ in range(8):
            resp = self.client.post(
                "/api/sessions/", {"external_id": "P"}, format="json"
            )
            self.assertEqual(resp.status_code, 201)
        counts = {g: Session.objects.filter(group=g).count() for g in ALL_GROUPS}
        self.assertEqual(set(counts.values()), {2})


class SessionFlowTests(APITestCase):
    def _create_session(self, dev_mode=False):
        resp = self.client.post(
            "/api/sessions/",
            {"external_id": "P001", "age": 22, "sex": "F", "dev_mode": dev_mode},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        return resp.data

    def test_create_returns_config(self):
        data = self._create_session()
        self.assertIn("session", data)
        self.assertIn("config", data)
        cfg = data["config"]
        self.assertIn(cfg["group"], ALL_GROUPS)
        self.assertEqual(cfg["params"]["vi_seconds"], 2.0)
        self.assertEqual(cfg["params"]["reinforcement_points"], 100)
        self.assertIn("phase2_contingency", cfg["params"])
        self.assertEqual(cfg["params"]["reinforcement_hide_ms"], 1000)
        self.assertEqual(cfg["params"]["punishment_hide_ms"], 5000)

    def test_dev_mode_persisted_on_session(self):
        data = self._create_session(dev_mode=True)
        sid = data["session"]["id"]
        self.assertTrue(Session.objects.get(id=sid).dev_mode)

    def test_forced_group(self):
        resp = self.client.post(
            "/api/sessions/",
            {"external_id": "P002", "group": "SOM5"},
            format="json",
        )
        self.assertEqual(resp.data["config"]["group"], "SOM5")
        self.assertEqual(
            resp.data["config"]["params"]["phase2_contingency"]["sound_ms"], 5000
        )

    def test_event_upload_and_export(self):
        sid = self._create_session()["session"]["id"]
        # marca como running
        self.client.patch(f"/api/sessions/{sid}/", {"status": "running"}, format="json")
        payload = {
            "events": [
                {
                    "phase": 1,
                    "event_type": "response",
                    "button_role": "R1",
                    "t_ms": 1200,
                    "points_delta": -1,
                    "points_total": 99,
                },
                {
                    "phase": 1,
                    "event_type": "reinforcement",
                    "button_role": "R1",
                    "t_ms": 1200,
                    "points_delta": 100,
                    "points_total": 199,
                },
            ]
        }
        resp = self.client.post(
            f"/api/sessions/{sid}/events/", payload, format="json"
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(Event.objects.filter(session_id=sid).count(), 2)

        # finaliza
        resp = self.client.patch(
            f"/api/sessions/{sid}/", {"status": "finished"}, format="json"
        )
        self.assertEqual(resp.data["status"], "finished")
        self.assertIsNotNone(resp.data["finished_at"])

        # export CSV
        resp = self.client.get(f"/api/sessions/{sid}/export/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "text/csv")
        body = resp.content.decode()
        self.assertIn("event_type", body)  # cabeçalho
        self.assertIn("reinforcement", body)

    def test_event_upload_triggers_phase_stats(self):
        """Regra: dados sempre desagregados por fase (pontuação, cliques/min,
        reforços/min, bins de 10s) — recalculados automaticamente ao subir eventos."""
        sid = self._create_session(dev_mode=True)["session"]["id"]
        payload = {
            "events": [
                {"phase": 1, "event_type": "response", "button_role": "R1", "t_ms": 0, "points_delta": 0, "points_total": 0},
                {"phase": 1, "event_type": "reinforcement", "button_role": "R1", "t_ms": 0, "points_delta": 100, "points_total": 100},
                {"phase": 1, "event_type": "cost", "button_role": "R1", "t_ms": 0, "points_delta": -1, "points_total": 99},
                {"phase": 1, "event_type": "response", "button_role": "R2", "t_ms": 15000, "points_delta": 0, "points_total": 99},
                {"phase": 1, "event_type": "cost", "button_role": "R2", "t_ms": 15000, "points_delta": -1, "points_total": 98},
            ]
        }
        resp = self.client.post(f"/api/sessions/{sid}/events/", payload, format="json")
        self.assertEqual(resp.status_code, 201)

        stat = PhaseStat.objects.get(session_id=sid, phase=1)
        self.assertEqual(stat.points_start, 0)
        self.assertEqual(stat.points_end, 98)
        self.assertEqual(stat.points_delta, 98)
        self.assertEqual(stat.duration_s, 30)  # dev_mode
        self.assertEqual(stat.n_bins, 3)  # 30s / 10s

        r1_stat = ButtonPhaseStat.objects.get(session_id=sid, phase=1, button_role="R1")
        self.assertEqual(r1_stat.response_count, 1)
        self.assertEqual(r1_stat.reinforcement_count, 1)
        self.assertEqual(r1_stat.cost_count, 1)
        # 1 resposta em 30s de fase = 2 respostas/min
        self.assertAlmostEqual(r1_stat.responses_per_minute, 2.0)

        # evento de R1 em t_ms=0 cai no bin 0; evento de R2 em t_ms=15000 (15s) cai no bin 1
        bin0_r1 = PhaseBin.objects.get(session_id=sid, phase=1, button_role="R1", bin_index=0)
        self.assertEqual(bin0_r1.response_count, 1)
        bin1_r2 = PhaseBin.objects.get(session_id=sid, phase=1, button_role="R2", bin_index=1)
        self.assertEqual(bin1_r2.response_count, 1)

    def test_phase_stats_normalize_t_ms_per_phase(self):
        """t_ms é medido desde o início da SESSÃO; o bin deve ser relativo ao
        início de CADA FASE, não ao início da sessão inteira."""
        sid = self._create_session(dev_mode=True)["session"]["id"]
        # Fase 2 (dev_mode: 30s cada fase) começa em t_ms=30000.
        payload = {
            "events": [
                {"phase": 2, "event_type": "response", "button_role": "R2", "t_ms": 30500, "points_delta": 0, "points_total": 0},
            ]
        }
        resp = self.client.post(f"/api/sessions/{sid}/events/", payload, format="json")
        self.assertEqual(resp.status_code, 201)
        # 30500 - phase_start(30000) = 500ms -> bin 0 da fase 2 (não bin 3!)
        b = PhaseBin.objects.get(session_id=sid, phase=2, button_role="R2", bin_index=0)
        self.assertEqual(b.response_count, 1)

    def test_recompute_is_idempotent(self):
        sid = self._create_session()["session"]["id"]
        session = Session.objects.get(id=sid)
        Event.objects.create(
            session=session, phase=1, event_type="response", button_role="R1",
            t_ms=0, points_delta=0, points_total=0,
        )
        analytics.recompute_phase_stats(session, 1)
        analytics.recompute_phase_stats(session, 1)
        self.assertEqual(PhaseStat.objects.filter(session=session, phase=1).count(), 1)
        self.assertEqual(
            ButtonPhaseStat.objects.filter(session=session, phase=1).count(), 4
        )
        self.assertEqual(PhaseBin.objects.filter(session=session, phase=1).count(), 4 * 30)
