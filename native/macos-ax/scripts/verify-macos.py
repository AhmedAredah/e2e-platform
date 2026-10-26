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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--driver', required=True)
    parser.add_argument('--app', required=True)
    parser.add_argument('--output')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('real macOS GUI verification requires macOS; no simulated pass is produced')
    token = secrets.token_hex(32)
    env = dict(os.environ, E2E_NATIVE_TOKEN=token, E2E_NATIVE_PORT='0')
    process = subprocess.Popen([str(Path(args.driver).resolve()), '--', str(Path(args.app).resolve())], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    checks = []
    client = None
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
                raise AssertionError('native operation failed: ' + response['error'].get('data', {}).get('code', 'unknown'))
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
                nodes = snapshot()
                if predicate(nodes):
                    return nodes
                time.sleep(0.1)
            raise AssertionError('accessible state did not reach the expected value')

        def perform(identifier, action):
            node = find(snapshot(), identifier)
            assert request('perform', dict(ref=node['ref'], action=action)) is None

        initialized = request('initialize', dict(protocolVersion=1, token=token))
        assert initialized['keyboard'] is False and initialized['screenshots'] is False
        assert set(initialized['actions']) == {'tap', 'fill', 'clear', 'focus', 'check', 'uncheck'}
        checks.append('authenticated capability negotiation')
        nodes = wait_for(lambda nodes: {'input', 'apply', 'echo', 'option'} <= {node.get('testId') for node in nodes})
        children = descendants(process.pid)
        assert children, 'owned application PID was not found'
        secure = [node for node in nodes if node.get('states', {}).get('secure')]
        assert secure, 'NSSecureTextField was not recognized'
        assert all(not any(key in node for key in ('value', 'text', 'attributes', 'children')) for node in secure)
        checks.append('real AppKit controls and secure-source suppression')
        perform('input', dict(kind='focus'))
        perform('input', dict(kind='fill', value='Rust AX verified', sensitive=False))
        perform('apply', dict(kind='tap'))
        nodes = wait_for(lambda nodes: find(nodes, 'echo').get('value') == 'Rust AX verified')
        assert find(nodes, 'echo').get('value') != 'planted wrong result'
        checks.append('focus, fill and invoke with positive and negative result assertions')
        for kind, expected in [('check', True), ('check', True), ('uncheck', False), ('uncheck', False)]:
            perform('option', dict(kind=kind))
            wait_for(lambda nodes: find(nodes, 'option').get('states', {}).get('checked') is expected)
        checks.append('idempotent check and uncheck')
        perform('input', dict(kind='clear'))
        wait_for(lambda nodes: find(nodes, 'input').get('value') == '')
        checks.append('clear')
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
        result = dict(status='passed', platform='macos', backend='macos-ax', runtimeVerified=True, checks=checks)
        if args.output:
            Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result, indent=2))
    finally:
        if client is not None:
            client.close()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == '__main__':
    main()
