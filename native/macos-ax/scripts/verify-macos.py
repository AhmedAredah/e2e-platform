#!/usr/bin/env python3
"""Exercise real AppKit accessible controls through the compiled Rust AX driver.
Requires an interactive macOS session and Accessibility permission. A non-macOS
host or denied permission is a failing qualification prerequisite, never a pass.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import select
import socket
import subprocess
import sys
import time


class RpcError(AssertionError):
    def __init__(self, code):
        self.code = code
        super().__init__('native operation failed: ' + code)


def descendants(pid):
    rows = subprocess.check_output(['/bin/ps', '-axo', 'pid=,ppid='], text=True)
    pairs = [tuple(map(int, row.split())) for row in rows.splitlines() if len(row.split()) == 2]
    found = {pid}
    while True:
        children = {child for child, parent in pairs if parent in found}
        if children <= found:
            return found - {pid}
        found |= children


def flatten(node):
    yield node
    for child in node.get('children', []):
        yield from flatten(child)


def assert_echo(nodes, expected):
    matches = [node for node in nodes if node.get('testId') == 'echo']
    assert len(matches) == 1, 'expected one accessible echo control'
    assert matches[0].get('value') == expected, 'application output differs from the expected value'


def scenario(args, wrong=False):
    token = secrets.token_hex(32)
    env = dict(os.environ, E2E_NATIVE_TOKEN=token, E2E_NATIVE_PORT='0')
    process = subprocess.Popen([str(Path(args.driver).resolve()), '--', str(Path(args.app).resolve()), *(['--wrong'] if wrong else [])], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    checks = []
    client = None
    stream = None
    children = set()
    try:
        ready, _, _ = select.select([process.stdout], [], [], 15)
        if not ready:
            raise AssertionError('driver did not become ready')
        line = process.stdout.readline()
        if not line.startswith(b'E2E_NATIVE_READY '):
            raise AssertionError('driver startup failed; verify Accessibility permission and executable paths')
        port = json.loads(line[len(b'E2E_NATIVE_READY '):])['port']
        client = socket.create_connection(('127.0.0.1', port), 5)
        client.settimeout(10)
        stream = client.makefile('rwb', buffering=0)
        next_id = 0

        def request(method, params):
            nonlocal next_id
            next_id += 1
            stream.write(json.dumps(dict(jsonrpc='2.0', id=next_id, method=method, params=params)).encode() + b'\n')
            line = stream.readline(16 * 1024 * 1024 + 1)
            if not line.endswith(b'\n') or len(line) > 16 * 1024 * 1024:
                raise AssertionError('missing or oversized native response')
            response = json.loads(line)
            assert response.get('id') == next_id and response.get('jsonrpc') == '2.0'
            if 'error' in response:
                raise RpcError(response['error'].get('data', {}).get('code', 'unknown'))
            return response['result']

        def snapshot():
            result = request('snapshot', {})
            assert not result.get('truncated'), 'fixture tree unexpectedly truncated'
            assert 'fixture-password' not in json.dumps(result), 'secure value leaked'
            assert 'screenshot' not in result
            return list(flatten(result['root']))

        def find(nodes, identifier):
            matches = [node for node in nodes if node.get('testId') == identifier]
            assert len(matches) == 1, 'expected one accessible fixture control: ' + identifier
            return matches[0]

        def wait_for(predicate):
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                try:
                    nodes = snapshot()
                except RpcError as error:
                    if error.code not in {'NODE_STALE', 'OPERATION_TIMEOUT'}:
                        raise
                    time.sleep(0.1)
                    continue
                if predicate(nodes):
                    return nodes
                time.sleep(0.1)
            raise AssertionError('accessible state did not reach the expected value')

        def perform(identifier, action):
            node = find(snapshot(), identifier)
            assert request('perform', dict(ref=node['ref'], action=action)) is None

        initialized = request('initialize', dict(protocolVersion=1, token=token))
        assert initialized['keyboard'] is False and initialized['screenshots'] is False
        assert set(initialized['actions']) == {'tap', 'fill', 'clear', 'focus', 'check', 'uncheck', 'scrollIntoView', 'selectOption'}
        checks.append('authenticated capability negotiation')
        nodes = wait_for(lambda nodes: {'input', 'apply', 'echo', 'option'} <= {node.get('testId') for node in nodes})
        children = descendants(process.pid)
        assert children, 'owned application PID was not found'
        secure = [node for node in nodes if node.get('states', {}).get('secure')]
        assert secure, 'NSSecureTextField was not recognized'
        assert all(not any(key in node for key in ('value', 'text', 'attributes', 'children')) for node in secure)
        checks.append('real AppKit controls and secure-source suppression')
        assert initialized.get('actionability') is True
        original = find(nodes, 'input')
        assert request('actionability', dict(ref=original['ref'], action=dict(kind='fill', value='preflight-only', sensitive=False))) is None
        assert find(snapshot(), 'input').get('value') == original.get('value'), 'preflight mutated input'
        moving = find(snapshot(), 'moving')
        mover = find(snapshot(), 'move-control')
        assert request('actionability', dict(ref=moving['ref'], action=dict(kind='tap'))) is None
        request('perform', dict(ref=mover['ref'], action=dict(kind='tap')))
        # Do not take a snapshot: the driver must use fresh window/ancestor geometry.
        deadline = time.monotonic() + 5
        while True:
            try:
                request('actionability', dict(ref=moving['ref'], action=dict(kind='tap')))
            except RpcError as error:
                assert error.code == 'NOT_ACTIONABLE'
                break
            if time.monotonic() >= deadline:
                raise AssertionError('stale visible geometry accepted after the control moved')
            time.sleep(0.05)
        checks.append('read-only preflight and current geometry after an unsnapshotted move')
        perform('input', dict(kind='focus'))
        perform('input', dict(kind='fill', value='Rust AX verified', sensitive=False))
        perform('apply', dict(kind='tap'))
        nodes = wait_for(lambda nodes: find(nodes, 'echo').get('value') != 'waiting')
        if wrong:
            # The same positive oracle must reject a genuinely faulty application.
            assert find(nodes, 'echo').get('value') == 'planted wrong result'
            try:
                assert_echo(nodes, 'Rust AX verified')
            except AssertionError:
                checks.append('planted application defect detected by the positive output oracle')
            else:
                raise AssertionError('planted wrong-output defect escaped detection')
        else:
            assert_echo(nodes, 'Rust AX verified')
            checks.append('focus, fill and invoke with expected output')
        for kind, expected in [('check', True), ('check', True), ('uncheck', False), ('uncheck', False)]:
            perform('option', dict(kind=kind))
            wait_for(lambda nodes: find(nodes, 'option').get('states', {}).get('checked') is expected)
        checks.append('idempotent check and uncheck')
        perform('input', dict(kind='clear'))
        wait_for(lambda nodes: find(nodes, 'input').get('value') == '')
        checks.append('clear')
        choices = find(snapshot(), 'choices')
        select_beta = dict(kind='selectOption', value=dict(label='Beta'))
        assert request('actionability', dict(ref=choices['ref'], action=select_beta)) is None
        assert find(snapshot(), 'selection-result').get('value') == 'Alpha selected', 'selection preflight mutated the application'
        for choice, expected in [(dict(label='Beta'), 'Beta selected'), (dict(index=0), 'Alpha selected'), (dict(value='beta'), 'Beta selected')]:
            perform('choices', dict(kind='selectOption', value=choice))
            wait_for(lambda nodes: find(nodes, 'selection-result').get('value') == expected)
        checks.append('AXSelectedChildren by label, index and identifier with an independent application result')
        late = find(snapshot(), 'late')
        assert late['states']['hidden'], 'scroll fixture did not begin clipped'
        assert request('actionability', dict(ref=late['ref'], action=dict(kind='scrollIntoView'))) is None
        assert find(snapshot(), 'late')['states']['hidden'], 'scroll preflight moved the viewport'
        perform('late', dict(kind='scrollIntoView'))
        wait_for(lambda nodes: find(nodes, 'late')['states'].get('visibilityKnown') and not find(nodes, 'late')['states']['hidden'])
        checks.append('advertised AXScrollToVisible changes the real NSScrollView viewport')

        assert request('shutdown', {}) is None
        process.wait(timeout=5)
        assert process.returncode == 0, 'driver exited unsuccessfully'
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            survivors = set()
            for pid in children:
                try:
                    os.kill(pid, 0)
                    survivors.add(pid)
                except ProcessLookupError:
                    pass
            if not survivors:
                break
            time.sleep(0.1)
        assert not survivors, 'owned application survived shutdown'
        checks.append('owned application shutdown')
        return checks
    finally:
        if stream is not None:
            stream.close()
        if client is not None:
            client.close()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        for pipe in (process.stdout, process.stderr):
            if pipe is not None:
                pipe.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--driver', required=True)
    parser.add_argument('--app', required=True)
    parser.add_argument('--output')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('real macOS GUI verification requires macOS; no simulated pass is produced')
    result = dict(status='passed', platform='macos', backend='macos-ax', runtimeVerified=True,
                  checks=scenario(args), plantedDefectChecks=scenario(args, wrong=True))
    if args.output:
        Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
