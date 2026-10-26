import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, test, vi } from 'vitest';
import { TerminalEngine } from '../src/engine/terminal.ts';
import { TerminalSession } from '../src/model/session.ts';
import type { TerminalExit } from '../src/model/types.ts';
import { TerminalTransport } from '../src/transport/base.ts';
import { NodePtyTransport } from '../src/transport/node-pty.ts';

describe('real PTY integration', () => {
  test('engine teardown stops the owned PTY even if an unsubscribe hook throws', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'terminal-unsubscribe-'));
    const heartbeat = join(directory, 'heartbeat');
    const program = `const fs=require('node:fs');const file=process.argv[1];fs.writeFileSync(file,'started');setInterval(()=>fs.appendFileSync(file,'.'),10);`;
    const raw = await NodePtyTransport.create({ executable: process.execPath, args: ['-e', program, heartbeat] }, { columns: 40, rows: 4 });
    class ThrowingSubscriptionTransport extends TerminalTransport {
      closed = 0;
      write(data: string): void { raw.write(data); }
      resize(columns: number, rows: number): void { raw.resize(columns, rows); }
      onData(listener: (data: string) => void): () => void {
        const unsubscribe = raw.onData(listener);
        return () => { unsubscribe(); throw new Error('unsubscribe hook failed'); };
      }
      onExit(listener: (exit: TerminalExit) => void): () => void { return raw.onExit(listener); }
      close(): Promise<void> { this.closed++; return raw.close(); }
    }
    const transport = new ThrowingSubscriptionTransport();
    const engine = new TerminalEngine({ transportFactory: () => transport });
    try {
      await engine.startAttempt({ attemptId: 'unsubscribe', artifactsDir: directory, signal: new AbortController().signal,
        appLog: () => undefined, environment: () => undefined });
      await vi.waitFor(async () => { expect(await readFile(heartbeat, 'utf8')).toContain('started'); });
      await expect(engine.endAttempt()).rejects.toThrow('Terminal cleanup failed');
      expect(transport.closed).toBe(1);
      const afterClose = await readFile(heartbeat, 'utf8');
      await delay(80);
      expect(await readFile(heartbeat, 'utf8')).toBe(afterClose);
      await engine.dispose();
      expect(transport.closed).toBe(1);
    } finally { await raw.close(); await rm(directory, { recursive: true, force: true }); }
  });
  test('launches a native terminal, parses output, receives input and propagates resize', async () => {
    const program = `process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write('READY\\r\\n');process.stdout.on('resize',()=>process.stdout.write('\\x1b[2J\\x1b[HSIZE:'+process.stdout.columns+'x'+process.stdout.rows));process.stdin.on('data',data=>{if(data.toString()==='q'){process.stdout.write('\\r\\nDONE');setTimeout(()=>process.exit(0),20);}else process.stdout.write('\\r\\nKEY:'+data.toString());});`;
    const terminal = await TerminalSession.create((dimensions) => NodePtyTransport.create({ executable: process.execPath, args: ['-e', program] }, dimensions), { columns: 40, rows: 8 });
    try {
      await terminal.waitFor('READY', { timeoutMs: 5000 });
      await terminal.write('x');
      await terminal.waitFor('KEY:x');
      await terminal.resize(60, 12);
      await terminal.waitFor('SIZE:60x12');
      await terminal.write('q');
      await terminal.waitFor('DONE');
      for (let attempt = 0; attempt < 100 && terminal.exit === undefined; attempt += 1) await delay(10);
      expect(terminal.exit?.exitCode).toBe(0);
    } finally { await terminal.close(); }
  });

  test.skipIf(process.platform !== 'linux')('owns the PTY process group and cleans a spawned descendant', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'terminal-descendant-'));
    const heartbeat = join(directory, 'heartbeat');
    const childProgram = `const fs=require('node:fs');const file=process.argv[1];fs.writeFileSync(file,'started');setInterval(()=>fs.appendFileSync(file,'.'),10);`;
    const program = `const{spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(childProgram)},${JSON.stringify(heartbeat)}],{stdio:'ignore'});process.stdout.write('CHILD:'+child.pid+'\\r\\n');setInterval(()=>{},1000);`;
    const terminal = await TerminalSession.create((dimensions) => NodePtyTransport.create({ executable: process.execPath, args: ['-e', program] }, dimensions));
    try {
      const screen = await terminal.waitFor(/CHILD:\d+/u, { timeoutMs: 5000 });
      const childPid = Number(/CHILD:(\d+)/u.exec(screen.text)?.[1]);
      expect(Number.isSafeInteger(childPid)).toBe(true);
      expect(() => process.kill(-terminal.pid!, 0)).not.toThrow();
      let started = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        try { started = (await readFile(heartbeat, 'utf8')).startsWith('started'); }
        catch { /* The child may still be starting. */ }
        if (started) break;
        await delay(10);
      }
      expect(started).toBe(true);
      await terminal.close();
      // A stopped zombie may retain a pid briefly. Behavioral evidence checks
      // the descendant has ceased writing, without requiring /proc or ps.
      const afterClose = await readFile(heartbeat, 'utf8');
      await delay(80);
      expect(await readFile(heartbeat, 'utf8')).toBe(afterClose);
    } finally { await terminal.close(); await rm(directory, { recursive: true, force: true }); }
  });
});
