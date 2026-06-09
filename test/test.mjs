import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTimestamp, extractTimestamp, parseLogFile, mergeLogs,
  formatEntry, formatText, formatJSON, formatMarkdown,
  getSummary, formatSummary, parseArgs, mergeFiles,
} from '../src/index.mjs';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// ── parseTimestamp ──────────────────────────────────────────────────────

describe('parseTimestamp', () => {
  it('parses ISO 8601 with Z', () => {
    assert.equal(parseTimestamp('2024-01-15T10:30:00.000Z'), new Date('2024-01-15T10:30:00.000Z').getTime());
  });

  it('parses ISO 8601 with timezone offset', () => {
    const ts = parseTimestamp('2024-01-15T10:30:00+07:00');
    assert.equal(ts, new Date('2024-01-15T10:30:00+07:00').getTime());
  });

  it('parses common log format: 2024-01-15 10:30:00', () => {
    const ts = parseTimestamp('2024-01-15 10:30:00');
    assert.ok(ts);
    assert.equal(new Date(ts).toISOString(), '2024-01-15T10:30:00.000Z');
  });

  it('parses common log with millis: 2024-01-15 10:30:00.123', () => {
    const ts = parseTimestamp('2024-01-15 10:30:00.123');
    assert.ok(ts);
    assert.equal(new Date(ts).toISOString(), '2024-01-15T10:30:00.123Z');
  });

  it('parses epoch seconds', () => {
    assert.equal(parseTimestamp('1705312200'), 1705312200000);
  });

  it('parses epoch milliseconds', () => {
    assert.equal(parseTimestamp('1705312200123'), 1705312200123);
  });

  it('parses simple time HH:MM:SS', () => {
    assert.equal(parseTimestamp('10:30:45'), (10 * 3600 + 30 * 60 + 45) * 1000);
  });

  it('returns null for garbage', () => {
    assert.equal(parseTimestamp('not a timestamp'), null);
  });

  it('returns null for empty/null', () => {
    assert.equal(parseTimestamp(''), null);
    assert.equal(parseTimestamp(null), null);
    assert.equal(parseTimestamp(undefined), null);
  });

  it('parses apache format: 15/Jan/2024:10:30:00 +0000', () => {
    const ts = parseTimestamp('15/Jan/2024:10:30:00 +0000');
    assert.equal(ts, new Date('2024-01-15T10:30:00Z').getTime());
  });

  it('parses syslog format: Jan 15 10:30:00', () => {
    const ts = parseTimestamp('Jan 15 10:30:00');
    const year = new Date().getFullYear();
    assert.equal(ts, Date.UTC(year, 0, 15, 10, 30, 0));
  });
});

// ── extractTimestamp ───────────────────────────────────────────────────

describe('extractTimestamp', () => {
  it('extracts ISO timestamp from log line', () => {
    const result = extractTimestamp('2024-01-15T10:30:00Z INFO server started');
    assert.equal(result.time, new Date('2024-01-15T10:30:00Z').getTime());
  });

  it('extracts common timestamp from log line', () => {
    const result = extractTimestamp('[2024-01-15 10:30:00] request incoming');
    assert.ok(result.time);
  });

  it('returns null for line without timestamp', () => {
    const result = extractTimestamp('just a regular line no time');
    assert.equal(result.time, null);
  });

  it('extracts epoch from line', () => {
    const result = extractTimestamp('1705312200 some event');
    assert.equal(result.time, 1705312200000);
  });
});

// ── parseLogFile ──────────────────────────────────────────────────────

describe('parseLogFile', () => {
  it('parses multi-line content', () => {
    const content = [
      '2024-01-15T10:00:00Z first',
      '2024-01-15T10:01:00Z second',
      '2024-01-15T10:02:00Z third',
    ].join('\n');
    const entries = parseLogFile(content, 'app.log');
    assert.equal(entries.length, 3);
    assert.equal(entries[0].source, 'app.log');
    assert.ok(entries[0].time);
  });

  it('skips blank lines', () => {
    const content = '2024-01-15T10:00:00Z first\n\n\n2024-01-15T10:01:00Z second';
    const entries = parseLogFile(content, 'test.log');
    assert.equal(entries.length, 2);
  });
});

// ── mergeLogs ─────────────────────────────────────────────────────────

describe('mergeLogs', () => {
  it('merges two log arrays chronologically', () => {
    const a = [
      { time: 100, source: 'a', line: 'a1' },
      { time: 300, source: 'a', line: 'a2' },
    ];
    const b = [
      { time: 200, source: 'b', line: 'b1' },
      { time: 400, source: 'b', line: 'b2' },
    ];
    const merged = mergeLogs(a, b);
    assert.equal(merged.length, 4);
    assert.deepEqual(merged.map(e => e.line), ['a1', 'b1', 'a2', 'b2']);
  });

  it('puts entries without timestamps at the end', () => {
    const a = [
      { time: 100, source: 'a', line: 'timed' },
      { time: null, source: 'a', line: 'untimed' },
    ];
    const merged = mergeLogs(a);
    assert.equal(merged[0].line, 'timed');
    assert.equal(merged[1].line, 'untimed');
  });

  it('handles empty arrays', () => {
    assert.deepEqual(mergeLogs([]), []);
    assert.deepEqual(mergeLogs([], []), []);
  });
});

// ── formatEntry ───────────────────────────────────────────────────────

describe('formatEntry', () => {
  const entry = { time: 1705312200000, source: 'api.log', line: 'request ok' };

  it('formats with source label', () => {
    assert.match(formatEntry(entry), /^\[api\.log\] request ok$/);
  });

  it('hides source when asked', () => {
    assert.equal(formatEntry(entry, { hideSource: true }), 'request ok');
  });

  it('shows epoch when asked', () => {
    assert.match(formatEntry(entry, { showEpoch: true }), /1705312200000/);
  });
});

// ── formatText ────────────────────────────────────────────────────────

describe('formatText', () => {
  it('joins entries with newlines', () => {
    const entries = [
      { time: 100, source: 'a', line: 'first' },
      { time: 200, source: 'b', line: 'second' },
    ];
    assert.equal(formatText(entries), '[a] first\n[b] second');
  });
});

// ── formatJSON ────────────────────────────────────────────────────────

describe('formatJSON', () => {
  it('outputs valid JSON array', () => {
    const entries = [{ time: 100, source: 'a', line: 'test' }];
    const parsed = JSON.parse(formatJSON(entries));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].line, 'test');
  });
});

// ── formatMarkdown ────────────────────────────────────────────────────

describe('formatMarkdown', () => {
  it('includes header and entries', () => {
    const entries = [{ time: new Date('2024-01-15T10:00:00Z').getTime(), source: 'app', line: 'hello' }];
    const md = formatMarkdown(entries);
    assert.match(md, /## Merged Logs/);
    assert.match(md, /### 2024-01-15/);
    assert.match(md, /`\[app\]` hello/);
  });
});

// ── getSummary / formatSummary ────────────────────────────────────────

describe('getSummary', () => {
  it('computes correct stats', () => {
    const entries = [
      { time: 100, source: 'a.log', line: 'x' },
      { time: 200, source: 'b.log', line: 'y' },
      { time: null, source: 'a.log', line: 'z' },
    ];
    const s = getSummary(entries);
    assert.equal(s.total, 3);
    assert.equal(s.withTimestamp, 2);
    assert.equal(s.withoutTimestamp, 1);
    assert.deepEqual(s.sources, { 'a.log': 2, 'b.log': 1 });
    assert.equal(s.timeRange.start, 100);
    assert.equal(s.timeRange.end, 200);
  });

  it('returns null timeRange for no timestamps', () => {
    const entries = [{ time: null, source: 'a', line: 'x' }];
    assert.equal(getSummary(entries).timeRange, null);
  });
});

describe('formatSummary', () => {
  it('includes key info', () => {
    const entries = [
      { time: 100, source: 'api.log', line: 'x' },
    ];
    const text = formatSummary(entries);
    assert.match(text, /Total lines: 1/);
    assert.match(text, /api\.log: 1 lines/);
  });
});

// ── parseArgs ─────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('parses files and flags', () => {
    const opts = parseArgs(['node', 'cli', 'a.log', 'b.log', '--json', '--color']);
    assert.deepEqual(opts.files, ['a.log', 'b.log']);
    assert.equal(opts.format, 'json');
    assert.equal(opts.color, true);
  });

  it('defaults to text format', () => {
    const opts = parseArgs(['node', 'cli', 'a.log', 'b.log']);
    assert.equal(opts.format, 'text');
  });

  it('parses --markdown', () => {
    assert.equal(parseArgs(['node', 'cli', '--md', 'a.log', 'b.log']).format, 'markdown');
  });

  it('parses --summary', () => {
    assert.equal(parseArgs(['node', 'cli', '--summary', 'a.log', 'b.log']).format, 'summary');
  });

  it('parses --help', () => {
    assert.equal(parseArgs(['node', 'cli', '-h']).help, true);
  });
});

// ── mergeFiles (integration) ─────────────────────────────────────────

describe('mergeFiles', () => {
  const tmpDir = join(import.meta.dirname, '__tmp_test__');

  it('merges files from disk in chronological order', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'a.log'), '2024-01-15T10:00:00Z alpha\n2024-01-15T10:02:00Z gamma\n');
    writeFileSync(join(tmpDir, 'b.log'), '2024-01-15T10:01:00Z beta\n2024-01-15T10:03:00Z delta\n');

    const merged = mergeFiles([
      join(tmpDir, 'a.log'),
      join(tmpDir, 'b.log'),
    ]);

    assert.equal(merged.length, 4);
    assert.equal(merged[0].line.includes('alpha'), true);
    assert.equal(merged[1].line.includes('beta'), true);
    assert.equal(merged[2].line.includes('gamma'), true);
    assert.equal(merged[3].line.includes('delta'), true);

    rmSync(tmpDir, { recursive: true });
  });
});
