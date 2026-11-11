// Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildJob, crc8 } from '../js/protocol.js';

const dir = new URL('.', import.meta.url);

test('crc8 matches known printer value', () => {
  assert.equal(crc8([0x35]), 0x8b); // from capture: A4 0x35 -> crc 8b
});

test('job is byte-identical to TiMini-Print capture from a real SC03h', () => {
  const pixels = new Uint8Array(readFileSync(new URL('golden-pixels.bin', dir)));
  const want = new Uint8Array(readFileSync(new URL('golden-job.bin', dir)));
  const got = buildJob(pixels, { energy: 30000, blackening: 5, speed: 30 });
  assert.deepEqual(Buffer.from(got).toString('hex'), Buffer.from(want).toString('hex'));
});
