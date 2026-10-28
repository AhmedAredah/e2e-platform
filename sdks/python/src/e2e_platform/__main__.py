"""Private supervised pytest entrypoint and an explicit local-runner command."""

import argparse
import importlib.metadata
import os
from pathlib import Path
import subprocess
import sys
from typing import Any
from .codec import dumps
from .session import Session
from .transport import StdioTransport


class PytestResults:
    """Collect stable node IDs and final setup/call/teardown outcomes."""

    def __init__(self) -> None:
        self.names: list[str] = []
        self.reports: list[Any] = []
        self.collection_failed = False

    def pytest_collection_finish(self, session: Any) -> None:
        self.names = [item.nodeid for item in session.items]

    def pytest_collectreport(self, report: Any) -> None:
        self.collection_failed |= bool(report.failed)

    def pytest_runtest_logreport(self, report: Any) -> None:
        self.reports.append(report)


def _run_pytest(arguments: list[str], results: PytestResults, plugins: list[str]) -> int:
    import pytest
    from . import pytest_plugin

    # Installed/conftest code is trusted. Unrelated auto-loaded plugins and
    # project addopts must not introduce a second scheduler or repeat mutations.
    os.environ["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"
    os.environ.pop("PYTEST_ADDOPTS", None)
    return int(
        pytest.main(
            [
                "-p",
                "no:terminal",
                "-o",
                "addopts=",
                "-o",
                "xfail_strict=true",
                *sum((["-p", plugin] for plugin in plugins), []),
                *arguments,
            ],
            plugins=[pytest_plugin, results],
        )
    )


def main(argv: list[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if arguments == ["init"]:
        from .scaffold import ProjectInitializer

        try:
            ProjectInitializer(Path.cwd()).create()
        except (OSError, ValueError) as error:
            print(str(error), file=sys.stderr)
            return 2
        print("Created Python example and runner configuration. Run python -m e2e_platform run --no-model")
        return 0
    if arguments and arguments[0] == "run":
        entry = Path.cwd() / "node_modules/@e2e-platform/core/dist/cli/bin.js"
        if not entry.is_file():
            print("Install the local E2E Platform npm kit in this project first", file=sys.stderr)
            return 2
        return subprocess.call([os.environ.get("E2E_NODE", "node"), str(entry), "run", *arguments[1:]])
    if arguments == ["--version"]:
        print(importlib.metadata.version("e2e-platform"))
        return 0
    parser = argparse.ArgumentParser(
        description="Owned Python test host; configure registerPythonTests in the shared runner"
    )
    parser.add_argument("--root", required=True)
    parser.add_argument("--test", action="append", default=[])
    parser.add_argument("--plugin", action="append", default=[])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--e2e-list", action="store_true")
    mode.add_argument("--e2e-case")
    options = parser.parse_args(arguments)
    root = Path(options.root).resolve(strict=True)
    os.chdir(root)
    # Keep the protocol on a private duplicate. Even fd-level application prints
    # now go to bounded diagnostic stderr rather than corrupting the protocol.
    with (
        os.fdopen(os.dup(sys.stdout.fileno()), "wb", buffering=0) as wire,
        os.fdopen(os.dup(sys.stdin.fileno()), "rb") as reader,
    ):
        os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
        results = PytestResults()
        if options.e2e_list:
            code = _run_pytest(["--collect-only", *options.test], results, options.plugin)
            if code != 0 or results.collection_failed or not results.names:
                print("Python collection failed or found no tests", file=sys.stderr)
                return 2
            wire.write((dumps({"protocol": 2, "tests": results.names}) + "\n").encode())
            return 0
        transport = StdioTransport(reader, wire)
        session = Session(transport)
        from . import pytest_plugin

        pytest_plugin.bind(session)
        try:
            session._void("case.start", {"name": options.e2e_case})
            code = _run_pytest([options.e2e_case], results, options.plugin)
            failed = next((report for report in results.reports if report.failed), None)
            if code != 0 or results.collection_failed or failed is not None:
                if not transport.failed:
                    file, line, phase = "pytest", 1, "collection"
                    if failed is not None:
                        file, line, phase = Path(failed.location[0]).name, failed.location[1] + 1, failed.when
                        crash = getattr(failed.longrepr, "reprcrash", None)
                        if crash is not None:
                            file, line = Path(crash.path).name, crash.lineno
                    session._void("expect.fail", {"file": file, "line": line, "phase": phase})
                return 1
            # A zero exit alone is insufficient: pytest must execute exactly the
            # selected item and settle its teardown. An ignored SDK failure sticks.
            if (
                transport.failed
                or results.names != [options.e2e_case]
                or not any(r.when == "teardown" for r in results.reports)
            ):
                return 1
            skipped = any(report.skipped for report in results.reports)
            session._void("case.complete", {"outcome": "skipped" if skipped else "passed"})
            return 0
        except BaseException:
            print("Python authored case failed; inspect the shared runner report", file=sys.stderr)
            return 1
        finally:
            pytest_plugin.bind(None)


if __name__ == "__main__":
    raise SystemExit(main())
