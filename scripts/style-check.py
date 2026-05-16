#!/usr/bin/env python3
import re
import sys
from pathlib import Path

TARGET_PROPS = {"background", "background-color", "color"}
RAW_ELEMENT_SELECTOR = re.compile(r"\.[A-Za-z0-9_-][^{,]*(?:\s+|>)\b(?:button|a)\b")


def iter_css_files(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    for raw in paths:
        path = Path(raw)
        if path.is_file() and path.suffix == ".css":
            files.append(path)
        elif path.is_dir():
            files.extend(sorted(path.rglob("*.css")))
    return files


def declarations(block: str) -> set[str]:
    found: set[str] = set()
    for match in re.finditer(r"([a-zA-Z-]+)\s*:", block):
        found.add(match.group(1).lower())
    return found


def check_file(path: Path) -> list[str]:
    content = path.read_text()
    violations: list[str] = []
    for match in re.finditer(r"([^{}]+)\{([^{}]*)\}", content, re.MULTILINE):
        selector = match.group(1).strip()
        block = match.group(2)
        prefix = content[max(0, match.start() - 120) : match.start()]
        if "style-check: allow-variant-bypass" in prefix or "style-check: allow-variant-bypass" in block:
            continue
        if not any(RAW_ELEMENT_SELECTOR.search(part.strip()) for part in selector.split(",")):
            continue
        if TARGET_PROPS.isdisjoint(declarations(block)):
            continue
        line = content.count("\n", 0, match.start()) + 1
        violations.append(
            f"{path}:{line}: scoped state selector styles raw button/a colors; use a variant class or :where(), or add style-check: allow-variant-bypass"
        )
    return violations


def main() -> int:
    paths = sys.argv[1:] or ["frontend/src"]
    violations: list[str] = []
    for path in iter_css_files(paths):
        violations.extend(check_file(path))
    if violations:
        print("\n".join(violations), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
