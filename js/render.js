// Each mode draws onto a canvas exactly WIDTH px wide (= one printed dot per px).
import { WIDTH } from './protocol.js';

export const FONTS = {
  clean: { family: 'Inter', label: 'Clean' },
  hand: { family: 'Caveat', label: 'Handwritten' },
  mono: { family: 'Space Mono', label: 'Typewriter' },
  serif: { family: 'Playfair Display', label: 'Elegant' },
  poster: { family: 'Bungee', label: 'Poster' },
};

const PAD = 12;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';
  return [c, ctx];
}

const fontCss = (key, size, bold) => `${bold ? 700 : 400} ${size}px "${FONTS[key].family}", system-ui, sans-serif`;

export async function loadFont(key, bold) {
  try { await document.fonts.load(fontCss(key, 32, bold)); } catch { /* fallback font is fine */ }
}

export function photo(img, rotate = 0) {
  const turned = rotate % 180 !== 0;
  const sw = turned ? img.height : img.width, sh = turned ? img.width : img.height;
  const h = Math.round((sh * WIDTH) / sw);
  const [c, ctx] = canvas(WIDTH, h);
  ctx.translate(WIDTH / 2, h / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  const s = WIDTH / sw;
  ctx.drawImage(img, (-img.width * s) / 2, (-img.height * s) / 2, img.width * s, img.height * s);
  return c;
}

function wrap(ctx, text, maxW) {
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      let w = word;
      // hard-break words wider than the paper
      while (ctx.measureText(w).width > maxW && w.length > 1) {
        let i = w.length - 1;
        while (i > 1 && ctx.measureText(w.slice(0, i)).width > maxW) i--;
        if (line) { lines.push(line); line = ''; }
        lines.push(w.slice(0, i));
        w = w.slice(i);
      }
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    lines.push(line);
  }
  return lines;
}

export function text({ value, font = 'clean', size = 36, bold = false, align = 'left', banner = false }) {
  value = value || ' ';
  if (banner) return bannerText(value.replace(/\n/g, ' '), font, bold);
  const [, m] = canvas(1, 1);
  m.font = fontCss(font, size, bold);
  const lines = wrap(m, value, WIDTH - PAD * 2);
  const lh = Math.round(size * 1.25);
  const [c, ctx] = canvas(WIDTH, lines.length * lh + PAD * 2);
  ctx.font = m.font;
  ctx.textAlign = align;
  const x = align === 'center' ? WIDTH / 2 : align === 'right' ? WIDTH - PAD : PAD;
  lines.forEach((l, i) => ctx.fillText(l, x, PAD + i * lh));
  return c;
}

function bannerText(value, font, bold) {
  const size = 300;
  const [, m] = canvas(1, 1);
  m.font = fontCss(font, size, bold);
  const len = Math.ceil(m.measureText(value).width) + PAD * 4;
  // draw horizontally, then rotate so it reads along the paper strip
  const [flat, f] = canvas(len, WIDTH);
  f.font = m.font;
  f.textBaseline = 'middle';
  f.fillText(value, PAD * 2, WIDTH / 2 + size * 0.05);
  const [c, ctx] = canvas(WIDTH, len);
  ctx.translate(WIDTH, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(flat, 0, 0);
  return c;
}

export function list({ title, items, font = 'clean', size = 30 }) {
  const rows = items.map((s) => s.trim()).filter(Boolean);
  const [, m] = canvas(1, 1);
  const titleSize = Math.round(size * 1.4);
  const box = Math.round(size * 0.8), gap = Math.round(size * 0.5);
  m.font = fontCss(font, size, false);
  const wrapped = rows.map((r) => wrap(m, r, WIDTH - PAD * 2 - box - gap));
  const lh = Math.round(size * 1.3);
  const titleH = title ? titleSize * 1.5 : 0;
  const h = PAD * 2 + titleH + wrapped.reduce((a, l) => a + l.length * lh + 6, 0);
  const [c, ctx] = canvas(WIDTH, h);
  let y = PAD;
  if (title) {
    ctx.font = fontCss(font, titleSize, true);
    ctx.textAlign = 'center';
    ctx.fillText(title, WIDTH / 2, y);
    ctx.fillRect(PAD, y + titleSize * 1.2, WIDTH - PAD * 2, 3);
    ctx.textAlign = 'left';
    y += titleH;
  }
  ctx.font = fontCss(font, size, false);
  ctx.lineWidth = 3;
  for (const lines of wrapped) {
    ctx.strokeRect(PAD + 1.5, y + (lh - box) / 2, box, box);
    lines.forEach((l, i) => ctx.fillText(l, PAD + box + gap, y + i * lh + (lh - size) / 2));
    y += lines.length * lh + 6;
  }
  return c;
}

export function qr({ data, caption, font = 'clean' }) {
  const q = window.qrcode(0, 'M');
  q.addData(data || ' ');
  q.make();
  const n = q.getModuleCount();
  const cell = Math.floor((WIDTH - PAD * 4) / n);
  const side = cell * n;
  const capSize = 28;
  const [, m] = canvas(1, 1);
  m.font = fontCss(font, capSize, true);
  const capLines = caption ? wrap(m, caption, WIDTH - PAD * 2) : [];
  const [c, ctx] = canvas(WIDTH, side + PAD * 3 + capLines.length * capSize * 1.25);
  const ox = (WIDTH - side) / 2;
  for (let r = 0; r < n; r++)
    for (let col = 0; col < n; col++) if (q.isDark(r, col)) ctx.fillRect(ox + col * cell, PAD + r * cell, cell, cell);
  ctx.font = m.font;
  ctx.textAlign = 'center';
  capLines.forEach((l, i) => ctx.fillText(l, WIDTH / 2, side + PAD * 2 + i * capSize * 1.25));
  return c;
}

// Short printout to check connection, darkness and dithering in one go.
export function testPage(printerName, darknessLabel) {
  const [c, ctx] = canvas(WIDTH, 250);
  ctx.textAlign = 'center';
  ctx.font = fontCss('clean', 34, true);
  ctx.fillText('PurrPrint ✓', WIDTH / 2, PAD);
  ctx.font = fontCss('clean', 20, false);
  ctx.fillText(`${printerName} · ${darknessLabel}`, WIDTH / 2, 58);
  ctx.fillText(new Date().toLocaleString(), WIDTH / 2, 84);
  const g = ctx.createLinearGradient(PAD, 0, WIDTH - PAD, 0);
  g.addColorStop(0, '#fff'); g.addColorStop(1, '#000');
  ctx.fillStyle = g;
  ctx.fillRect(PAD, 120, WIDTH - PAD * 2, 40); // shading test
  ctx.fillStyle = '#000';
  for (let x = PAD; x < WIDTH - PAD; x += 8) ctx.fillRect(x, 172, 4, 24); // fine-line test
  ctx.font = fontCss('clean', 18, false);
  ctx.fillText('Your printer is ready 🐱', WIDTH / 2, 212);
  return c;
}
