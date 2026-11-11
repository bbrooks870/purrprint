// Grayscale (0..255, Float32Array) -> 1-bit pixels (Uint8Array, 1 = black).

export function toGray(ctx, w, h, { brightness = 0, contrast = 0, invert = false } = {}) {
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  const c = (259 * (contrast + 255)) / (255 * (259 - contrast));
  for (let i = 0; i < g.length; i++) {
    const a = d[i * 4 + 3] / 255; // transparent -> paper white
    let v = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) * a + 255 * (1 - a);
    v = c * (v + brightness - 128) + 128;
    if (invert) v = 255 - v;
    g[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return g;
}

const KERNELS = {
  atkinson: [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]],
  steinberg: [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]],
};

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function dither(gray, w, h, mode) {
  const out = new Uint8Array(w * h);
  if (mode === 'line') {
    for (let i = 0; i < out.length; i++) out[i] = gray[i] < 128 ? 1 : 0;
  } else if (mode === 'pattern') {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        out[y * w + x] = gray[y * w + x] <= (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) * 16 ? 1 : 0;
  } else {
    const k = KERNELS[mode] || KERNELS.atkinson;
    const v = Float32Array.from(gray);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x, old = v[i], black = old < 128;
        out[i] = black ? 1 : 0;
        const err = old - (black ? 0 : 255);
        for (const [dx, dy, f] of k) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny < h) v[ny * w + nx] += err * f;
        }
      }
  }
  return out;
}
