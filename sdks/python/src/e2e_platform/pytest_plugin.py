"""Pytest fixtures for one supervised case; the shared runner owns scheduling."""

from collections.abc import Iterator
import pytest
from .session import Session

_session: Session | None = None


def bind(session: Session | None) -> None:
    """Called only by the owned Python host before pytest execution."""
    global _session
    _session = session


def pytest_configure(config):
    """Reject known competing worker/retry schedulers in supervised mode."""
    if _session is not None:
        for name, _plugin in config.pluginmanager.list_name_plugin():
            if name in {"xdist", "xdist.plugin", "rerunfailures", "pytest_rerunfailures", "repeat", "pytest_repeat"}:
                raise pytest.UsageError("The shared runner exclusively owns workers and retries")


@pytest.fixture
def e2e() -> Iterator[Session]:
    """Use the attempt-scoped shared session; parent cleanup owns every resource."""
    if _session is None:
        raise pytest.UsageError(
            "Run these tests through registerPythonTests and e2e-platform run; no shared runner session is active"
        )
    yield _session


@pytest.fixture
def app(e2e: Session):
    return e2e.app


@pytest.fixture
def screen(e2e: Session):
    return e2e.screen


@pytest.fixture
def processes(e2e: Session):
    return e2e.processes


@pytest.fixture
def http(e2e: Session):
    return e2e.http
