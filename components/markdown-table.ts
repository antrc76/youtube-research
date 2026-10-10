/**
 * GFM table detection/parsing — a pure, dependency-free function so it can
 * be unit tested directly (MarkdownBlock.tsx can't be imported from a plain
 * node:test file, since this repo's test runner strips TypeScript types but
 * doesn't transform JSX).
 */

export type ColumnAlign = 'left' | 'center' | 'right' | null;

export interface ParsedTable {
  header: string[];
  aligns: ColumnAlign[];
  rows: string[][];
  /** Number of source lines consumed, starting at the index passed in. */
  lineCount: number;
}

/** Splits a pipe-delimited row into trimmed cells, honouring `\|` as an escaped, literal pipe. */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);

  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
    if (c === '|') {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function alignFor(cell: string): ColumnAlign {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

function isSeparatorRow(line: string): boolean {
  const cells = splitRow(line);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-+:?$/.test(c));
}

/**
 * Detects a GFM table starting at lines[startIndex] (the header row), valid
 * only if lines[startIndex + 1] is a matching separator row (e.g. `| --- |
 * :--- | ---: |`) with the same column count as the header. Returns null if
 * there's no table there. Body rows are collected until a blank line or a
 * line with no pipe at all; each is normalised to the header's column count
 * (missing trailing cells become '', extra cells are dropped — matches
 * common GFM renderer behaviour).
 */
export function parseGfmTable(lines: string[], startIndex: number): ParsedTable | null {
  const headerLine = lines[startIndex];
  const sepLine = lines[startIndex + 1];
  if (headerLine == null || sepLine == null) return null;
  if (!headerLine.includes('|')) return null;
  if (!isSeparatorRow(sepLine)) return null;

  const header = splitRow(headerLine);
  const sepCells = splitRow(sepLine);
  if (header.length === 0 || sepCells.length !== header.length) return null;

  const aligns = sepCells.map(alignFor);

  const rows: string[][] = [];
  let i = startIndex + 2;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || !line.includes('|')) break;
    const cells = splitRow(line).slice(0, header.length);
    while (cells.length < header.length) cells.push('');
    rows.push(cells);
    i++;
  }

  return { header, aligns, rows, lineCount: i - startIndex };
}
