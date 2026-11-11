// Cat-printer "tiny" protocol (0x51 0x78 prefix), ported from TiMini-Print
// (Apache-2.0, https://github.com/Dejniel/TiMini-Print). Byte-for-byte checked
// against a capture from a real SC03h in test/protocol.test.mjs.

export const WIDTH = 384;

const CRC_TABLE = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let b = 0; b < 8; b++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
    t[i] = c;
  }
  return t;
})();

export function crc8(bytes) {
  let c = 0;
  for (const b of bytes) c = CRC_TABLE[c ^ b];
  return c;
}

export function packet(cmd, payload = []) {
  const n = payload.length;
  return [0x51, 0x78, cmd, 0x00, n & 0xff, n >> 8, ...payload, crc8(payload), 0xff];
}

// One run byte = (color << 7) | length, length <= 127. color 1 = black.
function rleLine(line) {
  const out = [];
  const push = (color, n) => {
    for (; n > 127; n -= 127) out.push((color << 7) | 127);
    if (n > 0) out.push((color << 7) | n);
  };
  let prev = line[0], count = 1, hasBlack = prev;
  for (let i = 1; i < line.length; i++) {
    const p = line[i];
    if (p) hasBlack = 1;
    if (p === prev) count++;
    else { push(prev, count); prev = p; count = 1; }
  }
  // ponytail: mirrors upstream quirk — trailing run is always emitted
  if (hasBlack || !out.length) push(prev, count);
  return out;
}

function packLine(line) {
  const out = new Array(line.length >> 3).fill(0);
  for (let x = 0; x < line.length; x++) if (line[x]) out[x >> 3] |= 1 << (x & 7); // LSB first
  return out;
}

// ---- printer profiles -------------------------------------------------------
// rle:     TiMini-Print "tiny" flow with 0xBF compression. Verified on SC03h.
// classic: Cat-Printer / cataclysm "old kind" flow — raw 0xA2 rows inside a
//          lattice session, paper fed with blank rows (0xA1 is broken on MX*).
//          Verified on MX10 by cataclysm (MIT). Also the safe default.
export const PROFILES = {
  rle: { name: 'rle', energy: [10000, 20000, 30000, 40000], chunk: 180, delay: 50 },
  classic: { name: 'classic', energy: [0x2000, 0x4000, 0xa000, 0xc000], chunk: 200, delay: 20, feedBefore: 48, feedAfter: 72 },
};

const RLE_MODELS = /^(SC0[345]|FC02|GB0[3-6]|GT0[1-3]|X[5-9]|X10|D1|P[127]\b|Pocket|LY0)/i;

// ponytail: name-prefix match; add a model here when someone reports it
export function profileFor(name = '') {
  if (/^MXW/i.test(name)) return null; // MXW01: different protocol, unsupported
  return RLE_MODELS.test(name) ? PROFILES.rle : PROFILES.classic;
}

// pixels: Uint8Array(WIDTH * h), 1 = black. darkness: 1..4
export function buildJob(pixels, { profile = PROFILES.rle, darkness = 3, speed = 30, isText = false, compress = true } = {}) {
  const energy = profile.energy[darkness - 1];
  return profile.name === 'classic'
    ? classicJob(pixels, energy, profile)
    : rleJob(pixels, { energy, blackening: [3, 4, 5, 5][darkness - 1], speed, isText, compress });
}

export function rleJob(pixels, { energy = 30000, blackening = 5, speed = 30, isText = false, compress = true } = {}) {
  const h = pixels.length / WIDTH;
  const out = [
    ...packet(0xa4, [0x30 + Math.max(1, Math.min(5, blackening))]),
    ...packet(0xaf, [energy & 0xff, energy >> 8]),
    ...packet(0xbe, [isText ? 1 : 0]),
    ...packet(0xbd, [speed]),
  ];
  for (let y = 0; y < h; y++) {
    const line = pixels.subarray(y * WIDTH, (y + 1) * WIDTH);
    const rle = compress ? rleLine(line) : null;
    out.push(...(rle && rle.length <= WIDTH / 8 ? packet(0xbf, rle) : packet(0xa2, packLine(line))));
    if ((y + 1) % 200 === 0) out.push(...packet(0xbd, [speed]));
  }
  out.push(
    ...packet(0xbd, [12]),
    ...packet(0xa1, [0x30, 0x00]),
    ...packet(0xa1, [0x30, 0x00]),
    ...packet(0xbd, [12]),
    ...packet(0xa3, [0x00]),
  );
  return new Uint8Array(out);
}

const LATTICE_START = [0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c];
const LATTICE_END = [0xaa, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17];
const BLANK_ROW = packet(0xa2, new Array(WIDTH / 8).fill(0));
const blankFeed = (rows) => [...packet(0xbd, [0x19]), ...Array(rows).fill(BLANK_ROW).flat()];

function classicJob(pixels, energy, p) {
  const h = pixels.length / WIDTH;
  const out = [
    ...packet(0xa3, [0x00]),
    ...packet(0xa3, [0x00]), // "start printing" for old-kind models
    ...packet(0xa4, [0x32]),
    ...packet(0xbd, [32]),
    ...packet(0xaf, [energy & 0xff, energy >> 8]),
    ...packet(0xbe, [0x00]), // image mode
    ...packet(0xa9, [0x00]),
    ...packet(0xa6, LATTICE_START),
  ];
  for (let i = 0; i < p.feedBefore; i++) out.push(...BLANK_ROW); // hides MX start-of-print streak
  for (let y = 0; y < h; y++) out.push(...packet(0xa2, packLine(pixels.subarray(y * WIDTH, (y + 1) * WIDTH))));
  out.push(...blankFeed(p.feedAfter), ...packet(0xa6, LATTICE_END), ...packet(0xa3, [0x00]));
  return new Uint8Array(out);
}

export const feedJob = (profile = PROFILES.rle) =>
  new Uint8Array(profile.name === 'classic' ? blankFeed(96) : [...packet(0xa1, [0x30, 0x00]), ...packet(0xa1, [0x30, 0x00])]);

export const stateQuery = () => new Uint8Array(packet(0xa3, [0x00]));

// Status flags arrive on AE02 as 0xA3 replies or 0xAE flow-control frames; flags = first payload byte.
export function parseStatus(b) {
  let flags = null;
  for (let i = 0; i + 8 <= b.length; ) {
    if (b[i] !== 0x51 || b[i + 1] !== 0x78) { i++; continue; }
    const len = b[i + 4] | (b[i + 5] << 8);
    if (i + 8 + len > b.length) break;
    if ((b[i + 2] === 0xa3 || b[i + 2] === 0xae) && len > 0) flags = b[i + 6];
    i += 8 + len;
  }
  if (flags === null) return null;
  return {
    outOfPaper: !!(flags & 0x01), coverOpen: !!(flags & 0x02), overheat: !!(flags & 0x04),
    lowBattery: !!(flags & 0x08), paused: !!(flags & 0x10),
  };
}
