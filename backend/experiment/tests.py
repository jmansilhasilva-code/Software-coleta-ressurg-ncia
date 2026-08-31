from rest_framework.test import APITestCase

from .models import Event, Session
from .protocol import build_counterbalance
from .views import ALL_GROUPS, assign_balanced_group


class CounterbalanceTests(APITestCase):
    def test_each_role_gets_distinct_symbol_and_position(self):
        cb = build_counterbalance()
        self.assertEqual(set(cb.keys()), {"R1", "R2", "CONTROL"})
        symbols = [v["symbol"] for v in cb.values()]
        self.assertEqual(len(set(symbols)), 3)  # símbolos distintos
        positions = [(v["x"], v["y"]) for v in cb.values()]
        self.assertEqual(len(set(positions)), 3)  # posições distintas


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
    def _create_session(self):
        resp = self.client.post(
            "/api/sessions/",
            {"external_id": "P001", "age": 22, "sex": "F"},
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
