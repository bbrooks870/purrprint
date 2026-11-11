// Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildJob, rleJob, crc8, profileFor, PROFILES, parseStatus, WIDTH } from '../js/protocol.js';

const dir = new URL('.', import.meta.url);

test('crc8 matches known printer value', () => {
  assert.equal(crc8([0x35]), 0x8b); // from capture: A4 0x35 -> crc 8b
});

test('job is byte-identical to TiMini-Print capture from a real SC03h', () => {
  const pixels = new Uint8Array(readFileSync(new URL('golden-pixels.bin', dir)));
  const want = new Uint8Array(readFileSync(new URL('golden-job.bin', dir)));
  const got = rleJob(pixels, { energy: 30000, blackening: 5, speed: 30 });
  assert.deepEqual(buildJob(pixels, { profile: PROFILES.rle, darkness: 3, speed: 30 }), got); // UI path, 'Dark'
  assert.deepEqual(Buffer.from(got).toString('hex'), Buffer.from(want).toString('hex'));
});

test('model names pick the right profile', () => {
  assert.equal(profileFor('SC03h-3DCC').name, 'rle');
  assert.equal(profileFor('GB03').name, 'rle');
  assert.equal(profileFor('GB01').name, 'classic');
  assert.equal(profileFor('MX10').name, 'classic');
  assert.equal(profileFor('YT01').name, 'classic');
  assert.equal(profileFor('SomethingNew').name, 'classic');
  assert.equal(profileFor('MXW01'), null);
});

test('classic job: no compression, lattice session, blank-row feeds', () => {
  const h = 10, px = new Uint8Array(WIDTH * h).fill(1);
  const job = buildJob(px, { profile: PROFILES.classic, darkness: 3 });
  const ops = [];
  for (let i = 0; i < job.length; ) { const n = job[i + 4] | (job[i + 5] << 8); ops.push(job[i + 2]); i += 8 + n; }
  assert.ok(!ops.includes(0xbf) && !ops.includes(0xa1));
  assert.deepEqual(ops.slice(0, 8), [0xa3, 0xa3, 0xa4, 0xbd, 0xaf, 0xbe, 0xa9, 0xa6]);
  assert.deepEqual(ops.slice(-2), [0xa6, 0xa3]);
  assert.equal(ops.filter((o) => o === 0xa2).length, 48 + h + 72);
});

test('status flags parse from printer notifications', () => {
  assert.deepEqual(parseStatus(Uint8Array.from([0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x10, 0x70, 0xff])).paused, true);
  const st = parseStatus(Uint8Array.from([0x51, 0x78, 0xa3, 0x01, 0x01, 0x00, 0x09, 0x00, 0xff]));
  assert.equal(st.outOfPaper && st.lowBattery && !st.paused, true);
});
