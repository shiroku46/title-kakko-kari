"""Regression tests for the Render-to-Supabase network workaround (Issue #25)."""
from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUPABASE_PATH = ROOT / "server/src/db/supabase.js"
ROOM_PATH = ROOT / "server/src/socket/roomHandlers.js"
PACKAGE_PATH = ROOT / "server/package.json"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class SupabaseIpv4FetchTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.supabase = read(SUPABASE_PATH)
        cls.rooms = read(ROOM_PATH)
        cls.package = json.loads(read(PACKAGE_PATH))

    def test_supabase_url_is_trimmed_and_https_validated_without_logging_value(self):
        self.assertIn("process.env.SUPABASE_URL?.trim()", self.supabase)
        self.assertIn("new URL(rawSupabaseUrl)", self.supabase)
        self.assertIn("supabaseBaseUrl.protocol !== 'https:'", self.supabase)
        self.assertIn("supabaseBaseUrl.username", self.supabase)
        self.assertIn("supabaseBaseUrl.password", self.supabase)
        self.assertNotIn("console.log(rawSupabaseUrl", self.supabase)
        self.assertNotIn("console.error(rawSupabaseUrl", self.supabase)
        self.assertNotIn("console.log(serviceRoleKey", self.supabase)
        self.assertNotIn("console.error(serviceRoleKey", self.supabase)

    def test_custom_fetch_is_scoped_to_supabase_and_forces_ipv4(self):
        self.assertIn("require('node:https')", self.supabase)
        self.assertIn("async function supabaseFetch", self.supabase)
        self.assertIn("https.request(", self.supabase)
        self.assertIn("family: 4", self.supabase)
        self.assertIn("target.origin !== supabaseOrigin", self.supabase)
        self.assertIn("target.username", self.supabase)
        self.assertIn("target.password", self.supabase)
        self.assertIn("global: {", self.supabase)
        self.assertIn("fetch: supabaseFetch", self.supabase)

    def test_workaround_does_not_change_global_network_or_tls_policy(self):
        low = self.supabase.casefold()
        for forbidden in (
            "setGlobalDispatcher",
            "setDefaultResultOrder",
            "NODE_TLS_REJECT_UNAUTHORIZED",
            "rejectUnauthorized: false",
            "http_proxy",
            "https_proxy",
        ):
            self.assertNotIn(forbidden.casefold(), low)
        self.assertNotIn("undici", self.package.get("dependencies", {}))

    def test_custom_fetch_preserves_bodyless_response_semantics_and_rejects_redirects(self):
        self.assertIn("[204, 205, 304].includes(status)", self.supabase)
        self.assertIn("? null", self.supabase)
        self.assertIn("headers.has('location')", self.supabase)
        self.assertIn("unexpected redirect", self.supabase)

    def test_network_error_wrapper_keeps_only_generic_message_and_machine_code(self):
        self.assertIn("new Error('Supabase network request failed', { cause: error })", self.supabase)
        self.assertIn("wrapped.name = 'SupabaseNetworkError'", self.supabase)
        self.assertIn("wrapped.code = error.code", self.supabase)
        self.assertNotIn("error.message =", self.supabase)

    def test_room_handler_logs_only_bounded_network_classification(self):
        self.assertIn("collectSafeNetworkDiagnostics", self.rooms)
        self.assertIn("['code', 'errno', 'syscall']", self.rooms)
        self.assertIn("/^[A-Za-z0-9_.:-]{1,80}$/", self.rooms)
        self.assertIn("database network request failed", self.rooms)
        self.assertIn("SupabaseNetworkError", self.rooms)
        self.assertIn("fetch failed", self.rooms)
        self.assertNotIn("cause=${", self.rooms)
        self.assertNotIn("error?.cause?.stack", self.rooms)

    def test_network_failure_client_message_is_generic_for_all_room_handlers(self):
        generic = "データベースへの接続に失敗しました。しばらくしてからもう一度お試しください"
        self.assertIn(generic, self.rooms)
        self.assertIn("reportRoomError('room:create', err)", self.rooms)
        self.assertIn("reportRoomError('room:join', err)", self.rooms)
        self.assertIn("reportRoomError('room:get_state', err)", self.rooms)
        self.assertNotIn("callback({ ok: false, error: err.message })", self.rooms)

    def test_server_runtime_remains_supported_without_new_network_dependency(self):
        engine = self.package.get("engines", {}).get("node", "")
        self.assertIn(">=20", engine)
        self.assertIn("<25", engine)
        self.assertNotIn("undici", self.package.get("dependencies", {}))

    def test_changed_javascript_files_parse_under_node_when_available(self):
        node = shutil.which("node")
        if node is None:
            self.skipTest("node executable is unavailable")
        for path in (SUPABASE_PATH, ROOM_PATH):
            completed = subprocess.run(
                [node, "--check", str(path)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)


if __name__ == "__main__":
    unittest.main()