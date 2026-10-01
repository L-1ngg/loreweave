"""Isolated pinned-reference comparator. Never imported by the TS runtime."""
import hashlib
import importlib.metadata
import json
import os
import pathlib
import sys
import types

source = pathlib.Path(sys.argv[1]).resolve()
fixtures = pathlib.Path(sys.argv[2]).resolve()
os.environ["PYTHON_DOTENV_DISABLED"] = "1"
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
# Import the unchanged algorithm modules without the SDK's unrelated provider entry.
package = types.ModuleType("pageindex")
package.__path__ = [str(source / "pageindex")]
sys.modules["pageindex"] = package
from pageindex.local_api import LocalAPI
from pageindex.flash.api import page_index_flash, flash_rejection_reason

manifest = json.loads((fixtures / "manifest.json").read_text())
results = []
for fixture in manifest["fixtures"]:
    path = fixtures / fixture["file"]
    record = {"file": fixture["file"], "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    try:
        pages = LocalAPI._extract_page_texts(str(path))
        record["pages"] = pages
        record["pageCount"] = len(pages)
    except Exception as exc:
        record["extractionError"] = type(exc).__name__
    try:
        tree = page_index_flash(str(path), summary=False, optimize=False)
        record["tree"] = tree
        record["refusal"] = flash_rejection_reason(tree)
    except Exception as exc:
        record["treeError"] = type(exc).__name__
    results.append(record)
print(json.dumps({
    "reference": "d2693d80791a86345ef78b3234834f5fe53a70a0",
    "mode": "raw Flash; no summaries, optimization or model calls",
    "python": sys.version,
    "packages": {name: importlib.metadata.version(name) for name in ["pypdfium2", "PyPDF2", "sortedcontainers", "regex", "python-dotenv", "pyyaml"]},
    "fixtures": results,
}, ensure_ascii=False))
