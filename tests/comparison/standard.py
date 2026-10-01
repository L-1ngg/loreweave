"""Pinned reference's structural/mapping helpers, without paid model calls."""
import json
import os
import pathlib
import sys
import types

source = pathlib.Path(sys.argv[1]).resolve()
os.environ["PYTHON_DOTENV_DISABLED"] = "1"
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
package = types.ModuleType("pageindex")
package.__path__ = [str(source / "pageindex")]
sys.modules["pageindex"] = package
from pageindex.tree_optimize import validate
from pageindex.page_index_classic import _validate_physical_indices, calculate_page_offset

report = json.loads(pathlib.Path(sys.argv[2]).read_text())
tree = report["index"]["tree"]
nodes = {n["id"]: {"node_id": n["id"], "title": n["title"], "start_index": n["start"], "end_index": n["end"], "nodes": []} for n in tree}
roots = []
for n in tree:
    if n["parentId"]:
        nodes[n["parentId"]]["nodes"].append(nodes[n["id"]])
    else:
        roots.append(nodes[n["id"]])
print(json.dumps({
    "reference": "d2693d80791a86345ef78b3234834f5fe53a70a0",
    "comparison": "upstream Standard physical validation and offset helpers plus shared tree validator; complete model pipeline not run",
    "tree_issues": validate(roots, 8),
    "physical_probe": _validate_physical_indices([{"physical_index": 3}, {"physical_index": 99}], 8),
    "offset_probe": calculate_page_offset([{"page": 1, "physical_index": 3}, {"page": 3, "physical_index": 5}]),
}))
