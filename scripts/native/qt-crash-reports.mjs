import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const fixtureReport = /^(?:e2e_qt_demo|e2e_qt_quick_demo|e2e_qt_bridge_tests|e2e_qt_surface_tests|e2e_qt_widgets_controls_tests|e2e_qt_quick_controls_tests)[-_]\d{4}-\d{2}-\d{2}[^/\\]*\.(?:ips|crash)$/;

/** Retains recent crash reports for this repository's Qt fixtures, with bounded disk reads. */
export class QtCrashReportCollector {
  constructor(output, { sinceMs, maxFiles = 16, maxFileBytes = 8 * 1024 * 1024, maxTotalBytes = 32 * 1024 * 1024 } = {}) {
    this.output = output;
    this.sinceMs = sinceMs ?? Date.now() - 60 * 60 * 1000;
    this.maxFiles = maxFiles;
    this.maxFileBytes = maxFileBytes;
    this.maxTotalBytes = maxTotalBytes;
  }

  /** Copies only named fixture reports; returns bounded diagnostics without changing a test verdict. */
  collect(directories) {
    const candidates = [];
    const diagnostics = [];
    for (const directory of directories) {
      try {
        for (const name of readdirSync(directory)) {
          if (!fixtureReport.test(name)) continue;
          const path = join(directory, name);
          const stat = lstatSync(path);
          if (stat.isFile() && stat.mtimeMs >= this.sinceMs && stat.size <= this.maxFileBytes) candidates.push({ path, name, stat });
        }
      } catch (error) {
        diagnostics.push({ stage: 'scan', code: error.code ?? 'UNKNOWN' });
      }
    }
    candidates.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs || a.name.localeCompare(b.name));
    mkdirSync(this.output, { recursive: true });
    const reports = [];
    let totalBytes = 0;
    for (const candidate of candidates) {
      if (reports.length >= this.maxFiles) break;
      if (candidate.stat.size > this.maxTotalBytes - totalBytes) continue;
      let fd;
      try {
        fd = openSync(candidate.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.dev !== candidate.stat.dev || stat.ino !== candidate.stat.ino || stat.size !== candidate.stat.size) continue;
        const limit = Math.min(this.maxFileBytes, this.maxTotalBytes - totalBytes);
        const buffer = Buffer.alloc(limit + 1);
        let length = 0;
        while (length < buffer.length) {
          const count = readSync(fd, buffer, length, buffer.length - length, null);
          if (count === 0) break;
          length += count;
        }
        if (length > limit) continue;
        const bytes = buffer.subarray(0, length);
        const file = `${reports.length + 1}-${candidate.name}`;
        writeFileSync(join(this.output, file), bytes);
        reports.push({ file, bytes: bytes.length });
        totalBytes += bytes.length;
      } catch (error) {
        diagnostics.push({ stage: 'copy', code: error.code ?? 'UNKNOWN' });
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
    }
    return { reports, totalBytes, diagnostics };
  }
}
