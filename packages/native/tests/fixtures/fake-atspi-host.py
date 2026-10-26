"""Real Python protocol/application host with an injected deterministic provider.

This fixture verifies runner interoperability, not the host's AT-SPI installation.
"""
import os
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / 'native' / 'linux-atspi'))
from e2e_atspi.application import DriverApplication
from e2e_atspi.contracts import AccessibilityProvider, DriverError


class GreetingProvider(AccessibilityProvider):
    def __init__(self):
        self.value = ''
        self.status = 'Ready'

    def snapshot(self):
        return {
            'viewport': {'width': 500, 'height': 300},
            'root': {'ref': {'id': 'desktop-root', 'revision': ''}, 'role': 'application', 'children': [
                {'ref': {'id': 'owned-app', 'revision': ''}, 'role': 'application', 'children': [
                {'ref': {'id': 'entry', 'revision': ''}, 'role': 'textbox', 'name': 'Name', 'testId': 'name', 'value': self.value},
                {'ref': {'id': 'submit', 'revision': ''}, 'role': 'button', 'name': 'Greet'},
                {'ref': {'id': 'status', 'revision': ''}, 'role': 'status', 'name': self.status, 'testId': 'status', 'text': self.status},
                ]},
            ]},
        }

    def perform(self, node_id, action):
        if node_id == 'entry' and action['kind'] == 'fill':
            self.value = action['value']
        elif node_id == 'submit' and action['kind'] == 'tap':
            self.status = 'Incorrect greeting' if os.environ.get('E2E_FAKE_BUG') == '1' else 'Hello ' + self.value
        else:
            raise DriverError('UNSUPPORTED_CAPABILITY', 'fixture action unavailable')


class TestApplication(DriverApplication):
    def create_provider(self, process_id):
        deadline = time.monotonic() + 3
        marker = Path(os.environ['E2E_FAKE_TARGET_RECORD'])
        while not marker.exists():
            if time.monotonic() >= deadline:
                raise RuntimeError('fixture target did not become ready')
            time.sleep(0.01)
        return GreetingProvider()


if __name__ == '__main__':
    if len(sys.argv) < 3 or sys.argv[1] != '--':
        raise SystemExit(2)
    raise SystemExit(TestApplication().run(sys.argv[2:]))
