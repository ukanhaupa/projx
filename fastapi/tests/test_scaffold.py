import os
import shutil
import subprocess
import sys


class TestScaffoldValidation:
    def test_invalid_entity_name_fails(self):
        result = subprocess.run(
            [sys.executable, "scaffold.py", "Invalid-Name"],
            capture_output=True,
            text=True,
            cwd=os.path.join(os.path.dirname(__file__), ".."),
        )
        assert result.returncode == 1
        assert "lowercase snake_case" in result.stdout

    def test_missing_model_file_fails(self):
        result = subprocess.run(
            [sys.executable, "scaffold.py", "nonexistent_entity"],
            capture_output=True,
            text=True,
            cwd=os.path.join(os.path.dirname(__file__), ".."),
        )
        assert result.returncode == 1
        assert "not found" in result.stdout

    def test_model_flag_creates_directory(self):
        backend_dir = os.path.join(os.path.dirname(__file__), "..")
        entity_dir = os.path.join(backend_dir, "src", "entities", "scaffold_test_entity")
        try:
            result = subprocess.run(
                [sys.executable, "scaffold.py", "scaffold_test_entity", "--model"],
                capture_output=True,
                text=True,
                cwd=backend_dir,
            )
            assert result.returncode == 0
            assert os.path.exists(os.path.join(entity_dir, "_model.py"))
            assert "CREATED" in result.stdout

            # Running again should skip
            result2 = subprocess.run(
                [sys.executable, "scaffold.py", "scaffold_test_entity", "--model"],
                capture_output=True,
                text=True,
                cwd=backend_dir,
            )
            assert "SKIP" in result2.stdout
        finally:
            if os.path.exists(entity_dir):
                shutil.rmtree(entity_dir)

    def test_generate_test_for_existing_entity(self):
        backend_dir = os.path.join(os.path.dirname(__file__), "..")
        result = subprocess.run(
            [sys.executable, "scaffold.py", "audit_log"],
            capture_output=True,
            text=True,
            cwd=backend_dir,
        )
        assert result.returncode == 0
        assert "SKIP" in result.stdout  # test already exists

    def test_generate_controller_for_new_entity(self):
        backend_dir = os.path.join(os.path.dirname(__file__), "..")
        entity_dir = os.path.join(backend_dir, "src", "entities", "scaffold_ctrl_test")
        try:
            os.makedirs(entity_dir, exist_ok=True)
            model_content = """from sqlalchemy import Column, String
from ..base._model import BaseModel_

class ScaffoldCtrlTest(BaseModel_):
    __tablename__ = "scaffold_ctrl_tests"
    name = Column(String(100), nullable=False)
"""
            with open(os.path.join(entity_dir, "_model.py"), "w") as f:
                f.write(model_content)

            result = subprocess.run(
                [sys.executable, "scaffold.py", "scaffold_ctrl_test", "--controller"],
                capture_output=True,
                text=True,
                cwd=backend_dir,
            )
            assert result.returncode == 0
            assert os.path.exists(os.path.join(entity_dir, "_controller.py"))
        finally:
            test_path = os.path.join(backend_dir, "tests", "test_scaffold_ctrl_test_entity.py")
            if os.path.exists(test_path):
                os.remove(test_path)
            if os.path.exists(entity_dir):
                shutil.rmtree(entity_dir)
