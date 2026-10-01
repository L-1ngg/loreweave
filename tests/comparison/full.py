"""Isolated development comparator; unchanged pinned algorithms, real provider."""
import contextlib
import hashlib
import importlib.metadata
import json
import os
import pathlib
import sys
import time
import types
import urllib.request

source = pathlib.Path(sys.argv[1]).resolve()
fixtures = pathlib.Path(sys.argv[2]).resolve()
output = pathlib.Path(sys.argv[3]).resolve()
os.environ["PYTHON_DOTENV_DISABLED"] = "1"
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
package = types.ModuleType("pageindex")
package.__path__ = [str(source / "pageindex")]
sys.modules["pageindex"] = package
from pageindex.local_api import LocalAPI
from pageindex.flash.api import page_index_flash, flash_rejection_reason
from pageindex.page_index_classic import page_index
from pageindex.utils import _llm_backend

model = os.environ["LOREWEAVE_REFERENCE_MODEL"]
backend = _llm_backend.set({"api_base": os.environ["OPENAI_BASE_URL"], "api_key": os.environ["OPENAI_API_KEY"], "timeout": 90, "max_retries": 0, "max_tokens": 8192})
report = {"reference": "d2693d80791a86345ef78b3234834f5fe53a70a0", "model": model,
          "mode": "complete Flash full optimization and summaries; independent Standard tree/subdivision/summaries",
          "settings": {"flash_optimize": "full", "summaries": True, "flash_concurrency": 1, "standard_max_pages": 12, "standard_max_tokens": 4500, "request_output_cap": 8192},
          "python": sys.version,
          "packages": {name: importlib.metadata.version(name) for name in ["litellm", "pypdfium2", "PyPDF2", "pycryptodome", "sortedcontainers", "regex", "python-dotenv", "pyyaml"]}, "fixtures": []}
selection = os.environ.get("LOREWEAVE_REFERENCE_FIXTURES")
report["selection"] = selection.split(",") if selection else None
manifest = json.loads((fixtures / "manifest.json").read_text())["fixtures"]
manifest += json.loads((fixtures / "question-manifest.json").read_text())["fixtures"]
manifest += [json.loads((fixtures / "boundary-manifest.json").read_text())]
for mode in ["flash", "standard"]:
    for fixture in manifest:
        if report["selection"] and fixture["file"] not in report["selection"]:
            continue
        path = fixtures / fixture["file"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != fixture["sha256"]:
            raise RuntimeError("frozen_fixture_changed")
        # Label requests via the evaluation-only proxy's process environment;
        # the paired runner records per-fixture call deltas as well.
        started = time.monotonic()
        record = {"mode": mode, "file": fixture["file"], "sha256": fixture["sha256"]}
        label = urllib.request.Request(os.environ["OPENAI_BASE_URL"].replace("/v1", "/evaluation-label"), data=json.dumps({"lane": f"python:{mode}:{fixture['file']}"}).encode(), headers={"Authorization": "Bearer " + os.environ["OPENAI_API_KEY"], "Content-Type": "application/json"})
        urllib.request.urlopen(label, timeout=15).close()
        try:
            with contextlib.redirect_stdout(sys.stderr):
                pages = LocalAPI._extract_page_texts(str(path))
                record["pages"] = pages
                record["pageCount"] = len(pages)
                if mode == "flash":
                    tree = page_index_flash(str(path), summary=True, summary_model=model, optimize="full", optimize_model=model, summary_concurrency=1)
                    refusal = flash_rejection_reason(tree)
                    record["refusal"] = refusal
                    record["status"] = "rejected" if refusal else "completed"
                else:
                    if not pages or not any(p.strip() for p in pages):
                        raise ValueError("unreadable_text_layer")
                    tree = page_index(str(path), model=model, max_page_num_each_node=12, max_token_num_each_node=4500, if_add_node_summary="yes", if_add_node_id="yes")
                    record["status"] = "completed"
                record["tree"] = tree
        except Exception as exc:
            record["status"] = "failed"
            record["error"] = {"type": type(exc).__name__, "message": str(exc).replace(os.environ["OPENAI_API_KEY"], "[redacted]")[:2000]}
        record["elapsedMs"] = round((time.monotonic() - started) * 1000)
        report["fixtures"].append(record)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({"mode": mode, "file": fixture["file"], "status": record["status"], "elapsedMs": record["elapsedMs"]}), flush=True)
_llm_backend.reset(backend)
