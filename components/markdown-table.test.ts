import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGfmTable } from './markdown-table.ts';

test('parses a basic GFM table with leading/trailing pipes', () => {
  const lines = [
    '| Name | Role |',
    '| --- | --- |',
    '| Ada | Engineer |',
    '| Grace | Admiral |',
  ];
  const table = parseGfmTable(lines, 0);
  assert.ok(table);
  assert.deepEqual(table.header, ['Name', 'Role']);
  assert.deepEqual(table.aligns, [null, null]);
  assert.deepEqual(table.rows, [['Ada', 'Engineer'], ['Grace', 'Admiral']]);
  assert.equal(table.lineCount, 4);
});

test('parses a table without leading/trailing pipes', () => {
  const lines = ['Name | Role', '--- | ---', 'Ada | Engineer'];
  const table = parseGfmTable(lines, 0);
  assert.ok(table);
  assert.deepEqual(table.header, ['Name', 'Role']);
  assert.deepEqual(table.rows, [['Ada', 'Engineer']]);
});

test('reads column alignment markers', () => {
  const lines = [
    '| Left | Center | Right |',
    '| :--- | :---: | ---: |',
    '| a | b | c |',
  ];
  const table = parseGfmTable(lines, 0);
  assert.ok(table);
  assert.deepEqual(table.aligns, ['left', 'center', 'right']);
});

test('stops at the first blank line', () => {
  const lines = [
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '| C | D |',
  ];
  const table = parseGfmTable(lines, 0);
  assert.ok(table);
  assert.equal(table.rows.length, 1);
  assert.equal(table.lineCount, 3); // header + separator + one row, not the blank line
});

test('stops at the first non-pipe line', () => {
  const lines = ['| A | B |', '| --- | --- |', '| 1 | 2 |', 'not a table row'];
  const table = parseGfmTable(lines, 0);
  assert.ok(table);
  assert.equal(table.rows.length, 1);
});

test('pads short rows and drops extra cells to match the header width', () => {
  const lines = [
    '| A | B | C |',
    '| --- | --- | --- |',
    '| only-one |',
    '| 1 | 2 | 3 | 4 | 5 |',
  ];
  const table = parseGfmTable(lines, 0);
  assert.ok(table);
  assert.deepEqual(table.rows[0], ['only-one', '', '']);
  assert.deepEqual(table.rows[1], ['1', '2', '3']);
});

test('honours an escaped pipe inside a cell', () => {
  const lines = ['| A | B |', '| --- | --- |', '| a\\|b | c |'];
  const table = parseGfmTable(lines, 0);
  assert.ok(table);
  assert.deepEqual(table.rows[0], ['a|b', 'c']);
});

test('returns null when there is no separator row', () => {
  const lines = ['| A | B |', 'not a separator', '| 1 | 2 |'];
  assert.equal(parseGfmTable(lines, 0), null);
});

test('returns null when the separator column count does not match the header', () => {
  const lines = ['| A | B | C |', '| --- | --- |', '| 1 | 2 | 3 |'];
  assert.equal(parseGfmTable(lines, 0), null);
});

test('returns null for a bare horizontal-rule line (not a 2-line table header+separator)', () => {
  const lines = ['---', 'some text'];
  assert.equal(parseGfmTable(lines, 0), null);
});

test('returns null at the end of the input with no room for a separator row', () => {
  const lines = ['| A | B |'];
  assert.equal(parseGfmTable(lines, 0), null);
});
