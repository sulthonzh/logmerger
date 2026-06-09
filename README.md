# logmerger

> Merge multiple log files by timestamp into unified chronological output

**Why**: When you have 3 microservices and something breaks, you end up with `api.log`, `worker.log`, `auth.log` — and you're manually jumping between files trying to figure out what happened when. `logmerger` does that for you in one command.

## Install

```bash
npm install -g @sulthonzh/logmerger
```

Or use with npx:

```bash
npx @sulthonzh/logmerger api.log worker.log auth.log
```

## Usage

```bash
# Basic merge — outputs chronologically
logmerger api.log worker.log auth.log

# JSON output (pipe to jq, save to file, etc.)
logmerger *.log --json > merged.json

# Summary stats
logmerger api.log worker.log --summary

# Markdown (good for issue comments)
logmerger api.log worker.log --markdown > merged.md

# With colors and epoch timestamps
logmerger api.log worker.log -c --epoch
```

## What it does

1. Reads each log file
2. Extracts timestamps from every line (ISO 8601, common log, epoch, syslog, apache/nginx formats)
3. Sorts all lines chronologically across files
4. Labels each line with its source file
5. Lines without timestamps go at the end (preserving original order)

## Supported timestamp formats

| Format | Example |
|--------|---------|
| ISO 8601 | `2024-01-15T10:30:00.000Z` |
| ISO with timezone | `2024-01-15T10:30:00+07:00` |
| Common log | `2024-01-15 10:30:00` |
| With millis | `2024-01-15 10:30:00.123` |
| Apache/nginx | `15/Jan/2024:10:30:00 +0000` |
| Syslog | `Jan 15 10:30:00` |
| Epoch seconds | `1705312200` |
| Epoch millis | `1705312200123` |
| Time only | `10:30:45` |

## CLI Options

```
logmerger <file1> <file2> ... [options]

--json           Output as JSON array
--markdown, --md Output as markdown
--summary        Show summary stats
--color, -c      Colorize output
--hide-source    Hide source file labels
--epoch          Show epoch timestamps
--help, -h       Show help
```

## Programmatic API

```javascript
import { mergeFiles, parseLogFile, mergeLogs, formatText } from '@sulthonzh/logmerger';

// Merge files from disk
const entries = mergeFiles(['api.log', 'worker.log']);
console.log(formatText(entries));

// Or parse manually
const apiLogs = parseLogFile(apiContent, 'api');
const workerLogs = parseLogFile(workerContent, 'worker');
const merged = mergeLogs(apiLogs, workerLogs);
```

## Real-world example

```bash
$ logmerger api.log worker.log auth.log --summary
Total lines: 1247
With timestamp: 1198
Without timestamp: 49
Sources:
  api.log: 456 lines
  worker.log: 523 lines
  auth.log: 268 lines
Time range: 2024-01-15T08:00:01.234Z → 2024-01-15T14:32:45.891Z
```

## Why not just `sort`?

`sort` doesn't understand timestamps. It sorts lexicographically, which works for ISO 8601 but breaks on everything else. It also can't label lines by source or handle mixed formats in the same file.

## License

MIT
