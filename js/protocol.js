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

// pixels: Uint8Array(WIDTH * h), 1 = black.
export function buildJob(pixels, { energy = 30000, blackening = 5, speed = 30, isText = false, compress = true } = {}) {
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
  out.push(...tail());
  return new Uint8Array(out);
}

const tail = () => [
  ...packet(0xbd, [12]),
  ...packet(0xa1, [0x30, 0x00]),
  ...packet(0xa1, [0x30, 0x00]),
  ...packet(0xbd, [12]),
  ...packet(0xa3, [0x00]),
];

export const feedJob = (steps = 1) =>
  new Uint8Array(Array.from({ length: steps }, () => packet(0xa1, [0x30, 0x00])).flat());

// Printer -> host flow control on the notify characteristic.
export const isPause = (b) => b.length >= 7 && b[2] === 0xae && b[6] === 0x10;
export const isResume = (b) => b.length >= 7 && b[2] === 0xae && b[6] === 0x00;
