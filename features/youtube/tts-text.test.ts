import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripMarkdown,
  truncateAtSentenceBoundary,
  prepareSpeechText,
  ttsCacheKey,
  MAX_TTS_CHARS,
} from './tts-text.ts';

test('strips headings down to their text', () => {
  assert.equal(stripMarkdown('# Title\n\n## Subtitle'), 'Title. Subtitle');
});

test('strips bold and italic markers', () => {
  assert.equal(stripMarkdown('This is **bold** and this is *italic*.'), 'This is bold and this is italic.');
});

test('strips links down to their label', () => {
  assert.equal(stripMarkdown('See [the docs](https://example.com) for more.'), 'See the docs for more.');
});

test('drops fenced code blocks entirely', () => {
  const md = 'Before.\n```js\nconst x = 1;\n```\nAfter.';
  const out = stripMarkdown(md);
  assert.ok(!out.includes('const x'));
  assert.ok(out.includes('Before'));
  assert.ok(out.includes('After'));
});

test('unwraps inline code', () => {
  assert.equal(stripMarkdown('Call `doThing()` first.'), 'Call doThing() first.');
});

test('strips bullet and numbered list markers', () => {
  const md = '- first item\n- second item\n1. numbered item';
  assert.equal(stripMarkdown(md), 'first item. second item. numbered item');
});

test('drops a GFM table entirely', () => {
  const md = 'Intro.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nOutro.';
  const out = stripMarkdown(md);
  assert.ok(!out.includes('|'));
  assert.ok(out.includes('Intro'));
  assert.ok(out.includes('Outro'));
});

test('drops horizontal rules', () => {
  assert.ok(!stripMarkdown('Para one.\n\n---\n\nPara two.').includes('-'));
});

test('does not truncate text under the cap', () => {
  const { text, truncated } = truncateAtSentenceBoundary('Short sentence.', MAX_TTS_CHARS);
  assert.equal(text, 'Short sentence.');
  assert.equal(truncated, false);
});

test('truncates at the last full sentence boundary under the cap', () => {
  const sentence = 'This is one sentence. ';
  const text = sentence.repeat(200); // well over 2000 chars
  const { text: out, truncated } = truncateAtSentenceBoundary(text, 100);
  assert.equal(truncated, true);
  assert.ok(out.length <= 100);
  assert.ok(out.endsWith('.'));
  // No partial sentence at the end — the whole output is one or more
  // complete "This is one sentence." repeats, none cut off mid-word.
  assert.match(out, /^(This is one sentence\. )*This is one sentence\.$/);
});

test('falls back to a word boundary when there is no sentence end in range', () => {
  const text = 'word '.repeat(500); // no punctuation at all
  const { text: out, truncated } = truncateAtSentenceBoundary(text, 50);
  assert.equal(truncated, true);
  assert.ok(out.length <= 50);
  assert.ok(!out.endsWith(' '));
  assert.ok('word '.startsWith(out.slice(0, 4)));
});

test('prepareSpeechText combines stripping and truncation', () => {
  const md = '# Heading\n\n' + 'This is a **sentence**. '.repeat(200);
  const { text, truncated } = prepareSpeechText(md, 100);
  assert.ok(truncated);
  assert.ok(text.length <= 100);
  assert.ok(!text.includes('#'));
  assert.ok(!text.includes('**'));
});

test('ttsCacheKey is stable for the same text and voice', () => {
  const a = ttsCacheKey('hello world', 'voice-1');
  const b = ttsCacheKey('hello world', 'voice-1');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('ttsCacheKey differs when the voice id differs', () => {
  const a = ttsCacheKey('hello world', 'voice-1');
  const b = ttsCacheKey('hello world', 'voice-2');
  assert.notEqual(a, b);
});

test('ttsCacheKey differs when the text differs', () => {
  const a = ttsCacheKey('hello world', 'voice-1');
  const b = ttsCacheKey('goodbye world', 'voice-1');
  assert.notEqual(a, b);
});
