"""Transport/extraction regression tests: standard library only, no generation or external network."""
import importlib.util
import io
import json
import pathlib
import stat
import tempfile
import unittest
import zipfile
from unittest import mock

spec = importlib.util.spec_from_file_location("fetch_creator_kit", pathlib.Path(__file__).parents[1] / "scripts/fetch-creator-kit.py")
kit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kit)


class KitTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="oddbout-download-test-")
        self.addCleanup(self.scratch.cleanup)
        self.root = pathlib.Path(self.scratch.name).resolve()

    def archive(self, *, extra=None, changed_runtime=False):
        files = {"runtime/" + name: b"fixture" for name in kit.REQUIRED_RUNTIME}
        hashes = {name.removeprefix("runtime/"): kit.digest(data) for name, data in files.items()}
        files.update({"plugin.json": kit.json_bytes({"name": "oddbout", "version": "0.4.0"}),
                      ".app.json": b"{}", "launcher.mjs": b"// fixture, never execute\n",
                      "runtime-manifest.json": kit.json_bytes({"schemaVersion": 1, "distribution": "source",
                          "platform": "any", "arch": "any", "files": hashes})})
        if changed_runtime:
            files["runtime/package.json"] = b"changed"
        archive = self.root / "fixture.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
            for name, data in files.items():
                output.writestr(name, data)
            for name, data in extra or []:
                if isinstance(name, str):
                    # Windows ZipInfo normally converts backslashes during fixture creation.
                    # Preserve hostile central-directory names to exercise the reader itself.
                    entry = zipfile.ZipInfo("placeholder")
                    entry.filename = entry.orig_filename = name
                    name = entry
                output.writestr(name, data)
        return archive

    def release(self, archive):
        observed = kit.inspect_archive(archive)
        helper = b"reviewed fixture helper"
        release_id = kit.digest((observed["sha256"] + "\n" + kit.digest(helper) + "\n").encode())
        base = f"{kit.ORIGIN}/creator-kit/0.4.0/{release_id}/"
        value = {"schemaVersion": 1, "name": "oddbout", "version": "0.4.0",
                 "artifact": {"url": base + "oddbout-0.4.0.zip", "bytes": observed["bytes"], "sha256": observed["sha256"]},
                 "bootstrap": {"url": base + "fetch-creator-kit.py", "bytes": len(helper), "sha256": kit.digest(helper)},
                 "runtimeManifestSha256": observed["runtimeManifestSha256"]}
        data = kit.json_bytes(value)
        manifest = self.root / "release.json"
        manifest.write_bytes(data)
        return manifest, data, value, base + "release.json"

    def test_offline_extraction_preserves_other_work_and_never_executes(self):
        archive = self.archive()
        manifest, data, _, _ = self.release(archive)
        previous = self.root / "existing-character.txt"
        previous.write_text("keep")
        destination = self.root / "new-check"
        result = kit.install(manifest_hash=kit.digest(data), destination=destination,
                             manifest_file=manifest, archive_file=archive)
        self.assertEqual(result["status"], "verified-and-extracted")
        self.assertEqual(result["execution"], "not-run")
        self.assertEqual(previous.read_text(), "keep")
        self.assertEqual((destination / "plugin/runtime/vendor/sprite-gen/LICENSE").read_bytes(), b"fixture")
        self.assertFalse((destination / "plugin/runtime/node_modules").exists())
        with self.assertRaisesRegex(kit.KitError, "destination-already-exists"):
            kit.install(manifest_hash=kit.digest(data), destination=destination, manifest_file=manifest, archive_file=archive)

    def test_hash_pinned_https_flow_reads_only_manifest_and_its_archive(self):
        archive = self.archive()
        _, data, release, url = self.release(archive)
        calls = []
        def download(request_url, maximum):
            calls.append(request_url)
            return data if request_url == url else archive.read_bytes()
        with mock.patch.object(kit, "fetch_bytes", side_effect=download):
            result = kit.install(manifest_hash=kit.digest(data), destination=self.root / "network", manifest_url=url)
        self.assertEqual(calls, [url, release["artifact"]["url"]])
        self.assertEqual(result["transport"], "https")  # Orchestration fixture; no live HTTPS certificate.

    def test_wrong_manifest_hash_stops_before_archive_request_or_extraction(self):
        _, data, _, url = self.release(self.archive())
        with mock.patch.object(kit, "fetch_bytes", return_value=data) as fetch:
            with self.assertRaisesRegex(kit.KitError, "release-integrity-failed"):
                kit.install(manifest_hash="0" * 64, destination=self.root / "bad-manifest", manifest_url=url)
        self.assertEqual(fetch.call_count, 1)
        self.assertFalse((self.root / "bad-manifest/plugin").exists())
        self.assertEqual(json.loads((self.root / "bad-manifest/install-result.json").read_text())["status"], "failed")

    def test_wrong_archive_hash_stops_before_unpacking(self):
        archive = self.archive()
        manifest, data, _, _ = self.release(archive)
        original = archive.read_bytes()
        archive.write_bytes(b"X" + original[1:])
        with self.assertRaisesRegex(kit.KitError, "archive-integrity-failed"):
            kit.install(manifest_hash=kit.digest(data), destination=self.root / "bad-zip", manifest_file=manifest, archive_file=archive)
        self.assertFalse((self.root / "bad-zip/plugin").exists())

    def test_inventory_and_runtime_hash_mismatches_are_rejected(self):
        with self.assertRaisesRegex(kit.KitError, "runtime-integrity-failed"):
            kit.inspect_archive(self.archive(changed_runtime=True))
        with self.assertRaisesRegex(kit.KitError, "runtime-inventory-mismatch"):
            kit.inspect_archive(self.archive(extra=[("runtime/unlisted.mjs", b"extra")]))

    def test_archive_paths_and_nonregular_entries_are_rejected(self):
        for name in ("../escape", "/absolute", "C:/escape", "dir\\escape", "dir/file:stream", "dir/CON.txt",
                     "dir/trailing.", ".env", "node_modules/a.js", "runtime/PACKAGE.json", "launcher.mjs/child"):
            with self.subTest(name=name), self.assertRaises(kit.KitError):
                kit.inspect_archive(self.archive(extra=[(name, b"x")]))
        link = zipfile.ZipInfo("link")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        with self.assertRaisesRegex(kit.KitError, "nonregular-archive-entry"):
            kit.inspect_archive(self.archive(extra=[(link, b"../escape")]))

    def test_expansion_limit_is_checked_before_decompression(self):
        archive = self.archive()
        with mock.patch.object(kit, "MAX_EXPANDED", 32):
            with self.assertRaisesRegex(kit.KitError, "expanded-size-limit"):
                kit.inspect_archive(archive)

    def test_origin_redirect_and_unreviewed_extra_fields_are_rejected(self):
        for url in ("http://oddbout.com/creator-kit/x", "https://oddbout.com.evil.test/creator-kit/x",
                    "https://oddbout.com/creator-kit/../x", "https://oddbout.com/creator-kit/%2e%2e/x",
                    "https://oddbout.com/creator-kit/x?token=x", "https://user@oddbout.com/creator-kit/x",
                    "https://127.0.0.1/creator-kit/x"):
            with self.subTest(url=url), self.assertRaises(kit.KitError):
                kit.validate_url(url)
        with self.assertRaisesRegex(kit.KitError, "redirect-rejected"):
            kit.NoRedirect().redirect_request(None, None, 302, None, None, "https://example.com")
        _, _, release, _ = self.release(self.archive())
        release["command"] = "do not execute this"
        data = kit.json_bytes(release)
        with self.assertRaisesRegex(kit.KitError, "invalid-release-fields"):
            kit.validate_release(data, kit.digest(data))

    def test_duplicate_json_keys_and_metadata_url_mismatch_are_rejected(self):
        with self.assertRaisesRegex(kit.KitError, "duplicate-json-key"):
            kit.parse_json(b'{"version": 1, "version": 2}')
        _, _, release, _ = self.release(self.archive())
        release["artifact"]["url"] = kit.ORIGIN + "/creator-kit/wrong.zip"
        data = kit.json_bytes(release)
        with self.assertRaisesRegex(kit.KitError, "release-url-mismatch"):
            kit.validate_release(data, kit.digest(data))

    def test_streamed_download_limits_truncation_and_error_redaction(self):
        url = kit.ORIGIN + "/creator-kit/test/release.json"
        class Response(io.BytesIO):
            status = 200
            headers = {}
            def geturl(self):
                return url
        def open_url(request, **kwargs):
            self.assertEqual(request.full_url, url)
            self.assertEqual(request.get_header("Accept-encoding"), "identity")
            return Response(b"12345")
        self.assertEqual(kit.fetch_bytes(url, 5, open_url=open_url), b"12345")
        with self.assertRaisesRegex(kit.KitError, "download-size-limit"):
            kit.fetch_bytes(url, 4, open_url=open_url)
        Response.headers = {"Content-Length": "8"}
        with self.assertRaisesRegex(kit.KitError, "download-truncated"):
            kit.fetch_bytes(url, 10, open_url=open_url)
        def fail(*args, **kwargs):
            raise kit.urllib.error.URLError("proxy-password-must-not-leak")
        with self.assertRaisesRegex(kit.KitError, "^download-network-failed$"):
            kit.fetch_bytes(url, 10, open_url=fail)


if __name__ == "__main__":
    unittest.main()
