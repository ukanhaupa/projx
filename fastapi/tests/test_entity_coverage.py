import os

import pytest


def get_entity_dirs():
    """Find all entity directories (directories under src/entities/ with a _model.py)."""
    entities_dir = os.path.join(os.path.dirname(__file__), "..", "src", "entities")
    entities_dir = os.path.abspath(entities_dir)
    result = []
    for item in os.listdir(entities_dir):
        item_path = os.path.join(entities_dir, item)
        if not os.path.isdir(item_path) or item.startswith("_") or item == "base":
            continue
        if os.path.exists(os.path.join(item_path, "_model.py")):
            result.append(item)
    return sorted(result)


def get_test_files():
    """Find all entity test files."""
    tests_dir = os.path.dirname(__file__)
    return {
        f.replace("test_", "").replace("_entity.py", "")
        for f in os.listdir(tests_dir)
        if f.startswith("test_") and f.endswith("_entity.py")
    }


class TestEntityCoverage:
    def test_all_entities_have_tests(self):
        """Every entity must have a test file.

        If this fails, run:
            uv run scaffold.py <entity_name>

        This generates tests/test_<entity>_entity.py with full CRUD tests.
        """
        entities = get_entity_dirs()
        tested = get_test_files()
        missing = [e for e in entities if e not in tested]

        if missing:
            commands = "\n".join(f"  uv run scaffold.py {e}" for e in missing)
            pytest.fail(f"Missing test files for entities: {', '.join(missing)}\n\nGenerate them with:\n{commands}")
