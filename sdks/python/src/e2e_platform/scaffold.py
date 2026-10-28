"""Explicit Python project scaffolding without overwriting consumer files."""

import json
from pathlib import Path
import sys


class ProjectInitializer:
    """Keep template construction separate from transactional file ownership."""

    def __init__(self, root: Path, interpreter: str = sys.executable):
        self.root = root.resolve()
        self.interpreter = interpreter

    def files(self) -> dict[Path, str]:
        return {
            self.root / "e2e.config.ts": """export default {
  modelPolicy: 'forbid', workers: 1, retries: 0,
  tests: ['tests/*.e2e.ts'],
  targets: [{ name: 'python-cli', platform: 'process' }],
};
""",
            self.root / "tests/python.e2e.ts": (
                "import { registerPythonTests } from '@e2e-platform/python';\n"
                "await registerPythonTests({ interpreter: "
                + json.dumps(self.interpreter)
                + ", tests: ['python_tests'] });\n"
            ),
            self.root
            / "python_tests/test_application.py": '''"""Replace the example command and expected output with your application."""

import sys
from e2e_platform import Session


def test_application(e2e: Session):
    result = e2e.processes.run(sys.executable, ["-c", "print('ready')"])
    e2e.expect_equal(result.stdout.decode().strip(), "ready")
''',
        }

    def create(self) -> list[Path]:
        files = self.files()
        if not (self.root / "package.json").is_file():
            raise ValueError("Create package.json and install the local npm kit first")
        if any(path.exists() or path.is_symlink() for path in files):
            raise FileExistsError(
                "Scaffold files already exist; use the manual Python guide to integrate existing projects"
            )
        written: list[Path] = []
        try:
            for path, text in files.items():
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open("x", encoding="utf-8", newline="\n") as output:
                    written.append(path)
                    output.write(text)
        except BaseException:
            for path in reversed(written):
                path.unlink(missing_ok=True)
            raise
        return written
