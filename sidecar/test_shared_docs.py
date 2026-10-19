"""Tests for sidecar auth and the shared-document registry (no model needed).

Run: python -m unittest sidecar/test_shared_docs.py
"""
import os
import unittest

os.environ["CLOAKLM_TOKEN"] = "app-token"
os.environ["CLOAKLM_TOOLS_TOKEN"] = "tools-token"

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from shared_docs import configure_tokens, hello_proof, require_token, router  # noqa: E402

app = FastAPI()
app.middleware("http")(require_token)
app.include_router(router)


@app.post("/api/process")
def process():
    return {"original_markdown": "secret"}


@app.get("/health")
def health():
    return {"status": "ok"}


APP = {"Authorization": "Bearer app-token"}
TOOLS = {"Authorization": "Bearer tools-token"}
DOC = {"id": "d1", "name": "Document 1", "project": "Taxes", "content": "Employee [PERSON_1] earned $50,000 in wages.", "clearance": "two-model"}


class AuthTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_no_token_is_rejected(self):
        self.assertEqual(self.client.get("/health").status_code, 401)
        self.assertEqual(self.client.post("/api/process").status_code, 401)

    def test_wrong_token_is_rejected(self):
        res = self.client.get("/health", headers={"Authorization": "Bearer nope"})
        self.assertEqual(res.status_code, 401)

    def test_app_token_reaches_everything(self):
        self.assertEqual(self.client.post("/api/process", headers=APP).status_code, 200)
        self.assertEqual(self.client.get("/api/shared", headers=APP).status_code, 200)

    def test_tools_token_cannot_process_or_write(self):
        self.assertEqual(self.client.post("/api/process", headers=TOOLS).status_code, 401)
        res = self.client.put("/api/shared", headers=TOOLS, json={"documents": []})
        self.assertEqual(res.status_code, 401)

    def test_tools_token_can_read_shared(self):
        self.assertEqual(self.client.get("/health", headers=TOOLS).status_code, 200)
        self.assertEqual(self.client.get("/api/shared", headers=TOOLS).status_code, 200)


class RegistryTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        res = self.client.put("/api/shared", headers=APP, json={"documents": [DOC]})
        self.assertEqual(res.status_code, 200)

    def test_list_omits_content(self):
        docs = self.client.get("/api/shared", headers=TOOLS).json()["documents"]
        self.assertEqual([d["id"] for d in docs], ["d1"])
        self.assertNotIn("content", docs[0])

    def test_get_returns_content(self):
        doc = self.client.get("/api/shared/d1", headers=TOOLS).json()
        self.assertEqual(doc["content"], DOC["content"])

    def test_get_unknown_is_404(self):
        self.assertEqual(self.client.get("/api/shared/nope", headers=TOOLS).status_code, 404)

    def test_search_returns_snippets(self):
        results = self.client.get("/api/shared/search", params={"q": "WAGES"}, headers=TOOLS).json()["results"]
        self.assertEqual(len(results), 1)
        self.assertIn("wages", results[0]["snippets"][0])

    def test_put_replaces_whole_set(self):
        self.client.put("/api/shared", headers=APP, json={"documents": []})
        self.assertEqual(self.client.get("/api/shared", headers=TOOLS).json()["documents"], [])

    def test_extra_fields_are_rejected(self):
        leaky = {**DOC, "redaction_map": {"x": {"real_value": "Jane Doe"}}}
        res = self.client.put("/api/shared", headers=APP, json={"documents": [leaky]})
        self.assertEqual(res.status_code, 422)
        # The earlier set is untouched.
        self.assertEqual(len(self.client.get("/api/shared", headers=TOOLS).json()["documents"]), 1)


class HardeningTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)

    def test_non_ascii_token_is_401_not_500(self):
        res = self.client.get("/health", headers={"Authorization": "Bearer t\u00f6ken".encode("utf-8")})
        self.assertEqual(res.status_code, 401)

    def test_tools_paths_need_exact_segments(self):
        for path in ("/healthz", "/api/sharedX", "/api/shared_secret"):
            self.assertEqual(self.client.get(path, headers=TOOLS).status_code, 401, path)

    def test_options_is_not_a_bypass(self):
        self.assertEqual(self.client.options("/api/process").status_code, 401)

    def test_hello_proves_knowledge_of_tools_token_without_auth(self):
        nonce = "ab" * 16
        res = self.client.get("/api/hello", params={"nonce": nonce})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["proof"], hello_proof(nonce, "tools-token"))
        self.assertNotEqual(res.json()["proof"], hello_proof(nonce, "wrong"))
        self.assertEqual(self.client.get("/api/hello", params={"nonce": "short"}).status_code, 422)

    def test_configure_tokens_rejects_weak_tokens(self):
        with self.assertRaises(ValueError):
            configure_tokens("a" * 64, "a" * 64)
        with self.assertRaises(ValueError):
            configure_tokens("short", "b" * 64)


class ClearanceAndLimitsTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def put(self, documents, **extra):
        return self.client.put("/api/shared", headers=APP, json={"documents": documents, **extra})

    def test_document_without_clearance_is_rejected(self):
        doc = {k: v for k, v in DOC.items() if k != "clearance"}
        self.assertEqual(self.put([doc]).status_code, 422)
        self.assertEqual(self.put([{**DOC, "clearance": "gliner-only"}]).status_code, 422)

    def test_manual_clearance_is_accepted(self):
        self.assertEqual(self.put([{**DOC, "clearance": "manual"}]).status_code, 200)

    def test_withheld_count_is_reported(self):
        self.put([DOC], withheld=2)
        self.assertEqual(self.client.get("/api/shared", headers=TOOLS).json()["withheld"], 2)

    def test_limits(self):
        self.assertEqual(self.put([{**DOC, "content": "x" * 5_000_001}]).status_code, 422)
        self.assertEqual(self.put([{**DOC, "id": f"d{i}"} for i in range(501)]).status_code, 422)
        self.assertEqual(self.put([{**DOC, "id": "../etc"}]).status_code, 422)

    def test_search_handles_case_folding_that_changes_length(self):
        self.put([{**DOC, "content": "İstanbul office: wages listed here"}])
        snippets = self.client.get("/api/shared/search", params={"q": "wages"}, headers=TOOLS).json()["results"][0]["snippets"]
        self.assertIn("wages", snippets[0])


if __name__ == "__main__":
    unittest.main()
