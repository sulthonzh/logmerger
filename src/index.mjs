/**
 * logmerger — Merge multiple log files by timestamp
 *
 * Takes N log files, extracts timestamps from each line,
 * and outputs everything in chronological order with source labels.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';

// ── Timestamp patterns (most specific first) ──────────────────────────
const TIMESTAMP_PATTERNS = [
  // ISO 8601: 2024-01-15T10:30:00.000Z or 2024-01-15T10:30:00+07:00
  /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/,
  // Syslog-ish: Jan 15 10:30:00 (assumes current year)
  /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/,
  // Common log: 2024-01-15 10:30:00[,000]
  /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:[,.]\d+)?)/,
  // Apache/nginx: 15/Jan/2024:10:30:00 +0000
  /(\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2}\s+[+-]\d{4})/,
  // Epoch seconds: 1705312200
  /(^|\D)(\d{10,13})(\D|$)/,
  // Simple time: 10:30:00 (less reliable, but useful)
  /(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/,
];

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse a timestamp string into epoch ms
 * @param {string} raw - The raw timestamp string
 * @returns {number|null} epoch milliseconds or null if unparseable
 */
export function parseTimestamp(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();

  // ISO 8601
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  // Common: 2024-01-15 10:30:00[.000]
  const commonMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:[,.](\d+))?/);
  if (commonMatch) {
    const [, y, mo, d, h, mi, sec, ms] = commonMatch;
    return new Date(
      Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec, ms ? +ms.slice(0, 3).padEnd(3, '0') : 0)
    ).getTime();
  }

  // Apache: 15/Jan/2024:10:30:00 +0000
  const apacheMatch = s.match(/^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4})/);
  if (apacheMatch) {
    const [, d, mon, y, h, mi, sec, tz] = apacheMatch;
    const month = MONTHS[mon.toLowerCase()];
    if (month === undefined) return null;
    const tzOffset = (parseInt(tz.slice(0, 3)) * 60 + parseInt(tz.slice(3))) * 60000;
    return Date.UTC(+y, month, +d, +h, +mi, +sec) - tzOffset;
  }

  // Syslog: Jan 15 10:30:00 (assume current year)
  const syslogMatch = s.match(/^(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (syslogMatch) {
    const [, mon, d, h, mi, sec] = syslogMatch;
    const month = MONTHS[mon.toLowerCase()];
    if (month === undefined) return null;
    const year = new Date().getFullYear();
    return Date.UTC(year, month, +d, +h, +mi, +sec);
  }

  // Epoch ms (13 digits) or seconds (10 digits)
  const epochMatch = s.match(/^(\d{10,13})$/);
  if (epochMatch) {
    let val = parseInt(epochMatch[1]);
    if (epochMatch[1].length === 10) val *= 1000;
    return val;
  }

  // Simple time HH:MM:SS (can't sort across days, use raw string comparison)
  const timeMatch = s.match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (timeMatch) {
    const [, h, m, sec, ms] = timeMatch;
    return (+h * 3600 + +m * 60 + +sec) * 1000 + (ms ? +ms.slice(0, 3).padEnd(3, '0') : 0);
  }

  return null;
}

/**
 * Extract timestamp from a log line
 * @param {string} line - A single log line
 * @returns {{ time: number|null, rest: string }}
 */
export function extractTimestamp(line) {
  for (const pattern of TIMESTAMP_PATTERNS) {
    // For epoch pattern, avoid matching things that look like other numbers
    if (pattern.source.includes('10,13')) {
      const m = line.match(pattern);
      if (m) {
        const ts = parseTimestamp(m[2]);
        if (ts) return { time: ts, rest: line };
      }
      continue;
    }
    const m = line.match(pattern);
    if (m) {
      const ts = parseTimestamp(m[1]);
      if (ts) return { time: ts, rest: line };
    }
  }
  return { time: null, rest: line };
}

/**
 * Parse a single log file into timestamped entries
 * @param {string} content - File content
 * @param {string} source - Source label (filename)
 * @returns {Array<{ time: number|null, source: string, line: string }>}
 */
export function parseLogFile(content, source) {
  const lines = content.split('\n').filter(l => l.trim());
  return lines.map(line => {
    const { time } = extractTimestamp(line);
    return { time, source, line };
  });
}

/**
 * Merge multiple parsed log arrays by timestamp
 * Lines without timestamps go to the end, preserving their original order
 * @param {Array<Array<{ time: number|null, source: string, line: string }>>} logArrays
 * @returns {Array<{ time: number|null, source: string, line: string }>}
 */
export function mergeLogs(...logArrays) {
  const all = logArrays.flat();
  const withTime = all.filter(e => e.time !== null);
  const withoutTime = all.filter(e => e.time === null);

  // Stable sort by timestamp
  withTime.sort((a, b) => a.time - b.time);

  return [...withTime, ...withoutTime];
}

/**
 * Format a merged log entry
 * @param {{ time: number|null, source: string, line: string }} entry
 * @param {object} opts
 * @param {boolean} opts.color - Use colors
 * @param {boolean} opts.hideSource - Hide source label
 * @param {boolean} opts.showEpoch - Show epoch ms
 * @returns {string}
 */
export function formatEntry(entry, opts = {}) {
  const { color = false, hideSource = false, showEpoch = false } = opts;
  const label = hideSource ? '' : `[${entry.source}] `;

  if (entry.time !== null && showEpoch) {
    const prefix = color
      ? `\x1b[2m${entry.time}\x1b[0m `
      : `${entry.time} `;
    return `${prefix}${label}${entry.line}`;
  }

  return `${label}${entry.line}`;
}

/**
 * Format merged logs as text
 * @param {Array} entries - Merged entries
 * @param {object} opts - Format options
 * @returns {string}
 */
export function formatText(entries, opts = {}) {
  return entries.map(e => formatEntry(e, opts)).join('\n');
}

/**
 * Format merged logs as JSON
 * @param {Array} entries
 * @returns {string}
 */
export function formatJSON(entries) {
  return JSON.stringify(entries, null, 2);
}

/**
 * Format merged logs as markdown
 * @param {Array} entries
 * @returns {string}
 */
export function formatMarkdown(entries) {
  const lines = ['## Merged Logs\n'];
  let currentDate = '';
  for (const e of entries) {
    if (e.time !== null) {
      const d = new Date(e.time);
      const dateStr = d.toISOString().split('T')[0];
      if (dateStr !== currentDate) {
        currentDate = dateStr;
        lines.push(`### ${dateStr}\n`);
      }
    }
    lines.push(`- \`[${e.source}]\` ${e.line}`);
  }
  return lines.join('\n');
}

/**
 * Get summary stats about the merged logs
 * @param {Array} entries
 * @returns {{ total: number, withTimestamp: number, withoutTimestamp: number, sources: Record<string, number>, timeRange: { start: number, end: number } | null }}
 */
export function getSummary(entries) {
  const sources = {};
  let withTimestamp = 0;
  let minTime = Infinity;
  let maxTime = -Infinity;

  for (const e of entries) {
    sources[e.source] = (sources[e.source] || 0) + 1;
    if (e.time !== null) {
      withTimestamp++;
      minTime = Math.min(minTime, e.time);
      maxTime = Math.max(maxTime, e.time);
    }
  }

  return {
    total: entries.length,
    withTimestamp,
    withoutTimestamp: entries.length - withTimestamp,
    sources,
    timeRange: withTimestamp > 0 ? { start: minTime, end: maxTime } : null,
  };
}

/**
 * Format summary as text
 */
export function formatSummary(entries) {
  const s = getSummary(entries);
  const lines = [
    `Total lines: ${s.total}`,
    `With timestamp: ${s.withTimestamp}`,
    `Without timestamp: ${s.withoutTimestamp}`,
    `Sources:`,
  ];
  for (const [name, count] of Object.entries(s.sources)) {
    lines.push(`  ${name}: ${count} lines`);
  }
  if (s.timeRange) {
    lines.push(`Time range: ${new Date(s.timeRange.start).toISOString()} → ${new Date(s.timeRange.end).toISOString()}`);
  }
  return lines.join('\n');
}

/**
 * CLI argument parser
 */
export function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    files: [],
    format: 'text',
    color: false,
    hideSource: false,
    showEpoch: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') opts.format = 'json';
    else if (a === '--markdown' || a === '--md') opts.format = 'markdown';
    else if (a === '--summary') opts.format = 'summary';
    else if (a === '--color' || a === '-c') opts.color = true;
    else if (a === '--hide-source') opts.hideSource = true;
    else if (a === '--epoch') opts.showEpoch = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (!a.startsWith('-')) opts.files.push(a);
  }

  return opts;
}

/**
 * Main merge function — takes file paths, returns merged entries
 * @param {string[]} filePaths
 * @returns {Array}
 */
export function mergeFiles(filePaths) {
  const parsed = filePaths.map(path => {
    const content = readFileSync(path, 'utf-8');
    const source = basename(path);
    return parseLogFile(content, source);
  });
  return mergeLogs(...parsed);
}
