import importlib
import os

import pytest


def get_entity_dirs():
    """Find all public entity directories (directories under src/entities/ with a non-private _model.py)."""
    entities_dir = os.path.join(os.path.dirname(__file__), "..", "src", "entities")
    entities_dir = os.path.abspath(entities_dir)
    result = []
    for item in sorted(os.listdir(entities_dir)):
        item_path = os.path.join(entities_dir, item)
        if not os.path.isdir(item_path) or item.startswith("_") or item == "base":
            continue
        if not os.path.exists(os.path.join(item_path, "_model.py")):
            continue
        if _is_private_entity(item):
            continue
        result.append(item)
    return result


def _is_private_entity(name: str) -> bool:
    module = importlib.import_module(f"src.entities.{name}._model")
    return any(isinstance(attr, type) and getattr(attr, "__private__", False) for attr in vars(module).values())


def get_test_files():
    """Find all entity test files (either test_<entity>.py or test_<entity>_entity.py)."""
    tests_dir = os.path.dirname(__file__)
    names: set[str] = set()
    for f in os.listdir(tests_dir):
        if not f.startswith("test_") or not f.endswith(".py"):
            continue
        stem = f[len("test_") : -len(".py")]
        if stem.endswith("_entity"):
            stem = stem[: -len("_entity")]
        names.add(stem)
    return names


class TestEntityCoverage:
    def test_all_entities_have_tests(self):
        """Every public entity must have a test file.

        If this fails, run:
            uv run scaffold.py <entity_name>

        This generates tests/test_<entity>_entity.py with full CRUD tests.
        Private entities (__private__ = True) are skipped — they're not
        exposed through the API and don't need auto-CRUD coverage.
        """
        entities = get_entity_dirs()
        tested = get_test_files()
        missing = [e for e in entities if e not in tested]

        if missing:
            commands = "\n".join(f"  uv run scaffold.py {e}" for e in missing)
            pytest.fail(f"Missing test files for entities: {', '.join(missing)}\n\nGenerate them with:\n{commands}")
