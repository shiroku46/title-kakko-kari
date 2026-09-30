"""Verification-only production playtest for Issue #41.

Runs from Product CI against the deployed Vercel client and Render server.
It uses only Python's standard library and creates one temporary four-player room.
"""
from __future__ import annotations

import json
import re
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

PUBLIC_ORIGIN = "https://title-kakko-kari.vercel.app"
SERVER = "https://title-kakko-kari.onrender.com"
EXPECTED_RELEASE = "809a76c2f019"
REQUEST_TIMEOUT = 40
DEPLOY_WAIT_SECONDS = 300


def _request(url, *, method="GET", data=None, origin=None):
    headers = {
        "User-Agent": "title-tahoiya-public-playtest/1.0",
        "Accept": "*/*",
    }
    if origin:
        headers["Origin"] = origin
    encoded = None
    if data is not None:
        encoded = data.encode("utf-8")
        headers["Content-Type"] = "text/plain;charset=UTF-8"
    request = urllib.request.Request(
        url,
        data=encoded,
        headers=headers,
        method=method,
    )
    return urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT)


def _json_get(path, *, origin=None):
    with _request(f"{SERVER}{path}", origin=origin) as response:
        return response.status, response.headers, json.loads(
            response.read().decode("utf-8")
        )


def _wait_for_deployments():
    deadline = time.monotonic() + DEPLOY_WAIT_SECONDS
    last = None
    while time.monotonic() < deadline:
        try:
            status, headers, health = _json_get("/health", origin=PUBLIC_ORIGIN)
            with _request(f"{PUBLIC_ORIGIN}/") as response:
                html_status = response.status
                html = response.read().decode("utf-8", errors="replace")
            last = {
                "renderStatus": status,
                "renderRelease": health.get("release"),
                "vercelStatus": html_status,
                "vercelTitle": "タイトルたほいや" in html,
            }
            cors = headers.get("Access-Control-Allow-Origin")
            if (
                status == 200
                and health.get("release") == EXPECTED_RELEASE
                and html_status == 200
                and "<title>タイトルたほいや</title>" in html
                and cors in ("*", PUBLIC_ORIGIN)
            ):
                return health
        except Exception as error:
            last = {"errorName": type(error).__name__}
        time.sleep(10)
    raise AssertionError(
        "Public deployments did not become ready within the bounded wait: "
        + json.dumps(last, ensure_ascii=False, sort_keys=True)
    )


class SocketIOPollingClient:
    """Minimal Socket.IO default-namespace client over Engine.IO polling."""

    def __init__(self, origin):
        self.origin = origin
        self.sid = None
        self.ack_id = 0
        self.handshake_cors = None
        self.namespace_connected = False
        self.events = []
        self.acks = {}
        self.player_id = None

    def _url(self):
        query = {
            "EIO": "4",
            "transport": "polling",
            "t": str(time.time_ns()),
        }
        if self.sid:
            query["sid"] = self.sid
        return f"{SERVER}/socket.io/?{urllib.parse.urlencode(query)}"

    def _get(self):
        with _request(self._url(), origin=self.origin) as response:
            self.handshake_cors = (
                self.handshake_cors
                or response.headers.get("Access-Control-Allow-Origin")
            )
            return response.read().decode("utf-8")

    def _post(self, packet):
        with _request(
            self._url(),
            method="POST",
            data=packet,
            origin=self.origin,
        ) as response:
            cors = response.headers.get("Access-Control-Allow-Origin")
            self.handshake_cors = self.handshake_cors or cors
            response.read()

    @staticmethod
    def _packets(payload):
        return [packet for packet in payload.split("\x1e") if packet]

    def _handle(self, packet):
        if packet == "2":
            self._post("3")
            return
        if packet.startswith("40"):
            self.namespace_connected = True
            return
        if packet.startswith("44"):
            raise AssertionError(f"Socket.IO namespace error: {packet[:200]}")
        if packet.startswith("43"):
            match = re.match(r"^43(\d+)(.*)$", packet)
            if not match:
                raise AssertionError(f"Malformed Socket.IO ACK: {packet[:200]}")
            self.acks[int(match.group(1))] = json.loads(match.group(2))
            return
        if packet.startswith("42"):
            body = packet[2:]
            while body and body[0].isdigit():
                body = body[1:]
            values = json.loads(body)
            if not isinstance(values, list) or not values:
                raise AssertionError(f"Malformed Socket.IO event: {packet[:200]}")
            self.events.append(
                {
                    "name": values[0],
                    "data": values[1] if len(values) > 1 else None,
                }
            )

    def _poll_once(self):
        for packet in self._packets(self._get()):
            self._handle(packet)

    def connect(self):
        payload = self._get()
        open_packets = [
            packet for packet in self._packets(payload) if packet.startswith("0")
        ]
        if not open_packets:
            raise AssertionError(f"Missing Engine.IO open packet: {payload[:200]!r}")
        opened = json.loads(open_packets[0][1:])
        self.sid = opened.get("sid")
        if not self.sid:
            raise AssertionError("Engine.IO returned an empty sid")
        if self.handshake_cors not in ("*", self.origin):
            raise AssertionError(
                f"Socket handshake CORS denied origin: {self.handshake_cors!r}"
            )

        self._post("40")
        deadline = time.monotonic() + REQUEST_TIMEOUT
        while time.monotonic() < deadline:
            self._poll_once()
            if self.namespace_connected:
                return
        raise AssertionError("Socket.IO default namespace did not connect")

    def emit_ack(self, event, payload=None):
        self.ack_id += 1
        ack_id = self.ack_id
        body = json.dumps(
            [event, payload],
            ensure_ascii=False,
            separators=(",", ":"),
        )
        self._post(f"42{ack_id}{body}")

        deadline = time.monotonic() + REQUEST_TIMEOUT
        while time.monotonic() < deadline:
            if ack_id in self.acks:
                values = self.acks.pop(ack_id)
                if not isinstance(values, list) or not values:
                    raise AssertionError(
                        f"Invalid ACK payload for {event}: {values!r}"
                    )
                return values[0]
            self._poll_once()
        raise AssertionError(f"Timed out waiting for ACK to {event}")

    def require_ok(self, event, payload=None):
        response = self.emit_ack(event, payload)
        if not response.get("ok"):
            raise AssertionError(f"{event} failed: {response.get('error')}")
        return response

    def wait_event(self, name, timeout=REQUEST_TIMEOUT):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for index, event in enumerate(self.events):
                if event["name"] == name:
                    return self.events.pop(index)["data"]
            self._poll_once()
        observed = [event["name"] for event in self.events[-20:]]
        raise AssertionError(f"Missing event {name}; observed={observed}")

    def disconnect(self):
        if not self.sid:
            return
        try:
            self._post("41")
            self._post("1")
        except Exception:
            pass
        self.sid = None


class TestPublicPlaytest(unittest.TestCase):
    clients = []

    @classmethod
    def tearDownClass(cls):
        for client in reversed(cls.clients):
            client.disconnect()

    def test_four_player_game_reaches_final_ranking(self):
        health = _wait_for_deployments()
        self.assertEqual(health.get("status"), "ok")
        self.assertEqual(health.get("release"), EXPECTED_RELEASE)

        try:
            _request(f"{SERVER}/health/supabase", origin=PUBLIC_ORIGIN)
        except urllib.error.HTTPError as error:
            self.assertEqual(error.code, 404)
        else:
            self.fail("Retired /health/supabase endpoint is still exposed")

        unique = str(int(time.time()))[-6:]
        players = []
        for _ in range(4):
            client = SocketIOPollingClient(PUBLIC_ORIGIN)
            client.connect()
            self.clients.append(client)
            players.append(client)

        created = players[0].require_ok(
            "room:create", {"nickname": f"H{unique}"}
        )
        code = created.get("room", {}).get("code", "")
        self.assertRegex(code, r"^\d{6}$")
        players[0].player_id = created["player"]["id"]

        for index, client in enumerate(players[1:], start=1):
            joined = client.require_ok(
                "room:join",
                {
                    "code": code,
                    "nickname": f"P{index}{unique}",
                },
            )
            client.player_id = joined["player"]["id"]
            self.assertEqual(len(joined.get("allPlayers", [])), index + 1)

        started_ack = players[0].require_ok(
            "game:start", {"mode": "player"}
        )
        self.assertTrue(started_ack.get("ok"))
        round_data = players[0].wait_event("game:started")
        self.assertEqual(round_data.get("totalRounds"), 4)

        by_id = {client.player_id: client for client in players}
        final = None
        for round_number in range(1, 5):
            questioner_id = round_data.get("questioner", {}).get("id")
            self.assertIn(questioner_id, by_id)
            questioner = by_id[questioner_id]
            answerers = [
                client for client in players if client is not questioner
            ]

            real_title = f"公開確認正解{round_number}"
            synopsis = (
                f"公開試遊確認用のあらすじ{round_number}。"
                "参加者全員が同じ文章を読み、架空のタイトルを考えるための文章です。"
            )
            questioner.require_ok(
                "round:submit_synopsis",
                {"synopsis": synopsis, "realTitle": real_title},
            )
            for client in answerers:
                client.require_ok("round:declare_unknown")
            declared = questioner.wait_event("round:all_declared")
            self.assertEqual(declared.get("declaredCount"), 3)
            self.assertEqual(declared.get("knownPlayerIds"), [])
            questioner.require_ok("round:start_submitting")

            fake_titles = {}
            for index, client in enumerate(answerers, start=1):
                fake_title = f"公開確認偽題{round_number}-{index}"
                fake_titles[client.player_id] = fake_title
                client.require_ok(
                    "round:submit_fake", {"title": fake_title}
                )

            choices_payload = players[0].wait_event(
                "round:choices_presented"
            )
            choices = choices_payload.get("choices", [])
            self.assertEqual(len(choices), 4)
            real_choice = next(
                choice for choice in choices if choice["title"] == real_title
            )

            for client in answerers:
                client.require_ok(
                    "round:submit_vote",
                    {"answerId": real_choice["id"]},
                )

            revealed = players[0].wait_event("round:revealed")
            self.assertEqual(revealed.get("realTitle"), real_title)
            self.assertEqual(len(revealed.get("votes", [])), 3)

            mvp_title = fake_titles[answerers[0].player_id]
            mvp_choice = next(
                choice for choice in choices if choice["title"] == mvp_title
            )
            questioner.require_ok(
                "round:submit_mvp", {"answerId": mvp_choice["id"]}
            )
            questioner.wait_event("round:mvp_selected")

            players[0].require_ok("game:next_round")
            if round_number < 4:
                round_data = players[0].wait_event("game:round_started")
            else:
                final = players[0].wait_event("game:finished")

        self.assertIsNotNone(final)
        final_scores = final.get("finalScores", [])
        self.assertEqual(len(final_scores), 4)
        self.assertIn(final.get("winner", {}).get("id"), by_id)
        self.assertEqual(
            final.get("winner", {}).get("score"),
            max(player.get("score", 0) for player in final_scores),
        )

        print(
            "PUBLIC_PLAYTEST_OK",
            json.dumps(
                {
                    "renderRelease": EXPECTED_RELEASE,
                    "vercelTitle": "タイトルたほいや",
                    "origin": PUBLIC_ORIGIN,
                    "players": 4,
                    "rounds": 4,
                    "roomCreate": True,
                    "roomJoin": True,
                    "playerMode": True,
                    "submission": True,
                    "voting": True,
                    "mvp": True,
                    "finalRanking": True,
                },
                ensure_ascii=False,
                sort_keys=True,
            ),
        )


if __name__ == "__main__":
    unittest.main()
