from __future__ import annotations

import ast
from importlib.util import resolve_name
from pathlib import Path


PACKAGE_ROOT = Path(__file__).parents[1] / "src" / "rag_system"
LAYERS = {"domain", "processing", "infrastructure", "application", "interfaces"}


def _module_name(path: Path) -> str:
    relative = path.relative_to(PACKAGE_ROOT).with_suffix("")
    parts = relative.parts
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(("rag_system", *parts))


def _rag_imports(path: Path) -> set[str]:
    module_name = _module_name(path)
    package = module_name if path.stem == "__init__" else module_name.rpartition(".")[0]
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(
                alias.name
                for alias in node.names
                if alias.name == "rag_system" or alias.name.startswith("rag_system.")
            )
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                name = "." * node.level + (node.module or "")
                resolved = resolve_name(name, package)
            else:
                resolved = node.module or ""
            if resolved == "rag_system" or resolved.startswith("rag_system."):
                imported.add(resolved)
    return imported


def test_package_root_only_contains_package_entrypoints() -> None:
    assert {path.name for path in PACKAGE_ROOT.glob("*.py")} == {
        "__init__.py",
        "__main__.py",
    }


def test_layer_dependencies_do_not_cross_upward_boundaries() -> None:
    forbidden = {
        "domain": LAYERS - {"domain"},
        "processing": {"infrastructure", "application", "interfaces"},
        "infrastructure": {"application", "interfaces"},
        "application": {"interfaces"},
    }
    for layer, disallowed in forbidden.items():
        for path in (PACKAGE_ROOT / layer).rglob("*.py"):
            imported_layers = {
                module.split(".")[1]
                for module in _rag_imports(path)
                if len(module.split(".")) > 1
            }
            assert not imported_layers & disallowed, (
                f"{path.relative_to(PACKAGE_ROOT)} imports "
                f"forbidden layers {sorted(imported_layers & disallowed)}"
            )
