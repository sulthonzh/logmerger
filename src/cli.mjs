#!/usr/bin/env node
import {
  mergeLogs, parseLogFile, formatText, formatJSON,
  formatMarkdown, formatSummary, mergeFiles, parseArgs,
} from './index.mjs';

const HELP = `
logmerger — Merge log files by timestamp into chronological order

Usage:
  logmerger <file1> <file2> ... [options]

Options:
  --json           Output as JSON
  --markdown, --md Output as markdown
  --summary        Show summary stats
  --color, -c      Colorize output
  --hide-source    Hide source file labels
  --epoch          Show epoch timestamps
  --help, -h       Show this help

Examples:
  logmerger api.log worker.log auth.log
  logmerger *.log --json > merged.json
  logmerger app1.log app2.log --summary
  logmerger api.log worker.log --markdown > merged.md
`.trim();

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (opts.files.length < 2) {
    console.error('Need at least 2 log files to merge.');
    console.error('Usage: logmerger <file1> <file2> ... [options]');
    process.exit(1);
  }

  try {
    const merged = mergeFiles(opts.files);

    switch (opts.format) {
      case 'json':
        console.log(formatJSON(merged));
        break;
      case 'markdown':
        console.log(formatMarkdown(merged));
        break;
      case 'summary':
        console.log(formatSummary(merged));
        break;
      default:
        console.log(formatText(merged, {
          color: opts.color,
          hideSource: opts.hideSource,
          showEpoch: opts.showEpoch,
        }));
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
