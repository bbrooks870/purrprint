import { WIDTH, buildJob, feedJob } from './protocol.js';
import { Printer, UnsupportedPrinter, supported, sleep } from './printer.js';
import { toGray, dither } from './dither.js';
import * as R from './render.js';

const $ = (s) => document.querySelector(s);
const track = (name, params = {}) => { try { window.gtag?.('event', name, params); } catch {} };
const $$ = (s) => [...document.querySelectorAll(s)];

const STYLE_HINTS = {
  auto: 'Picks the best style for you — sharp lines for drawings and codes, smooth shading for photos.',
  atkinson: 'Crisp, high-contrast photos. Best for faces and most pictures.',
  steinberg: 'Smoother shading with more detail. Can look darker on thermal paper.',
  line: 'Pure black & white. Best for text, logos, drawings and stencils.',
  pattern: 'Retro comic-book dot grid.',
};
const PRESETS = {
  todo: ['To-do', 'Reply to emails\nWorkout\nRead 20 pages\nPlan tomorrow'],
  shop: ['Shopping', 'Milk\nEggs\nBread\nFruits\nCoffee'],
  pack: ['Packing', 'Passport\nCharger\nToothbrush\nClothes\nSnacks'],
};

const state = {
  mode: 'photo', image: null, rotate: 0,
  font: 'clean', align: 'center', listFont: 'hand', qrKind: 'link',
  style: 'auto', darkness: 3, copies: 1, bits: null,
};

// ---- persisted settings (per-browser convenience only)
const SAVED = ['darkness', 'style'];
try { Object.assign(state, JSON.parse(localStorage.getItem('purrprint') || '{}')); } catch {}
const save = () => { try { localStorage.setItem('purrprint', JSON.stringify(Object.fromEntries(SAVED.map((k) => [k, state[k]])))); } catch {} };

// ---- small UI helpers
function pressGroup(el, key, onChange = () => {}) {
  const set = (v) => {
    for (const b of el.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v == v));
    state[key] = isNaN(v) ? v : Number(v);
  };
  set(state[key]);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    set(b.dataset.v); onChange(state[key]); save(); update();
  });
}

function fontChips(el, key) {
  el.innerHTML = Object.entries(R.FONTS)
    .map(([k, f]) => `<button type="button" data-v="${k}" style="font-family:'${f.family}'">${f.label}</button>`).join('');
  pressGroup(el, key);
}

let statusTimer;
function status(msg, err = false) {
  const s = $('#status');
  s.textContent = msg; s.classList.toggle('err', err);
  clearTimeout(statusTimer);
  if (msg && !err) statusTimer = setTimeout(() => (s.textContent = ''), 6000);
}

// ---- build the picture for the current mode
async function source() {
  switch (state.mode) {
    case 'photo':
      return state.image ? R.photo(state.image, state.rotate) : null;
    case 'text':
      await R.loadFont(state.font, $('#text-bold').checked);
      return R.text({
        value: $('#text').value, font: state.font, size: +$('#text-size').value,
        bold: $('#text-bold').checked, align: state.align, banner: $('#text-banner').checked,
      });
    case 'list':
      await R.loadFont(state.listFont, true);
      return R.list({ title: $('#list-title').value.trim(), items: $('#list-items').value.split('\n'), font: state.listFont });
    case 'qr': {
      if (!window.qrcode) return null;
      const data = state.qrKind === 'wifi'
        ? `WIFI:T:WPA;S:${esc($('#wifi-ssid').value)};P:${esc($('#wifi-pass').value)};;`
        : $('#qr-data').value.trim();
      return R.qr({ data, caption: $('#qr-caption').value.trim() });
    }
  }
}
const esc = (s) => s.replace(/([\\;,:"])/g, '\\$1');

// Auto: line art (few mid-tones) prints sharp; photos, text and emoji get Atkinson.
function effectiveStyle(gray) {
  if (state.style !== 'auto') return state.style;
  if (state.mode === 'qr') return 'line';
  if (state.mode !== 'photo') return 'atkinson';
  let mid = 0;
  for (let i = 0; i < gray.length; i += 7) if (gray[i] > 60 && gray[i] < 190) mid++;
  return mid / (gray.length / 7) < 0.08 ? 'line' : 'atkinson'; // ponytail: 8% cutoff, tune if misjudged
}

let pending = 0;
async function update() {
  const ticket = ++pending;
  $('#style-hint').textContent = STYLE_HINTS[state.style];
  const c = await source();
  if (ticket !== pending) return; // a newer render started
  const pv = $('#preview'), ctx = pv.getContext('2d');
  if (!c) {
    state.bits = null;
    pv.width = WIDTH; pv.height = 220;
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--paper');
    ctx.fillRect(0, 0, WIDTH, 220);
    ctx.fillStyle = '#b5ad9f'; ctx.font = '600 18px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(state.mode === 'photo' ? 'Your photo will appear here' : 'Loading…', WIDTH / 2, 115);
    $('#meta').textContent = '';
    return;
  }
  const g = toGray(c.getContext('2d'), c.width, c.height, {
    brightness: +$('#brightness').value, contrast: +$('#contrast').value, invert: $('#invert').checked,
  });
  const bits = dither(g, c.width, c.height, effectiveStyle(g));
  state.bits = bits;
  pv.width = WIDTH; pv.height = c.height;
  const img = ctx.createImageData(WIDTH, c.height);
  for (let i = 0; i < bits.length; i++) {
    const o = i * 4;
    if (bits[i]) { img.data[o] = 32; img.data[o + 1] = 30; img.data[o + 2] = 38; }
    else { img.data[o] = 253; img.data[o + 1] = 252; img.data[o + 2] = 248; }
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const cm = c.height / 8 / 10; // 203 dpi = 8 dots per mm
  $('#meta').textContent = `≈ ${cm.toFixed(1)} cm of paper${state.copies > 1 ? ` × ${state.copies}` : ''}`;
}

let debounce;
const updateSoon = () => { clearTimeout(debounce); debounce = setTimeout(update, 120); };

// ---- printer
const printer = new Printer();

function paintConnection(busy = false) {
  const b = $('#connect');
  b.classList.toggle('on', printer.connected);
  b.classList.toggle('busy', busy);
  $('#connect-label').textContent = busy ? 'Connecting…' : printer.connected ? printer.name : 'Connect printer';
}
printer.addEventListener('change', () => paintConnection());

// Printer-reported problems. Shown as hints only — never block printing on them.
let lastWarn = '';
printer.addEventListener('status', () => {
  const s = printer.status;
  const warn = s.outOfPaper ? '📄 The printer says it is out of paper.'
    : s.coverOpen ? '🔓 The printer lid is open — close it to print.'
    : s.overheat ? '🔥 The printer is hot — it will continue after cooling down.'
    : s.lowBattery ? '🔋 Battery is low — charge the printer for darker, reliable prints.' : '';
  if (warn && warn !== lastWarn) status(warn, true);
  lastWarn = warn;
});

async function ensureConnected() {
  if (printer.connected) return true;
  if (!supported()) { $('#unsupported').hidden = false; $('#unsupported').scrollIntoView({ behavior: 'smooth' }); return false; }
  try {
    paintConnection(true);
    if (printer.device) await printer.send(new Uint8Array()); // reconnect known device
    else await printer.connect();
    status(`Connected to ${printer.name} 🎉 Try a test print!`);
    track('printer_connected', { printer_model: printer.name });
    return true;
  } catch (e) {
    track('printer_connect_failed', { reason: e.name });
    status(e instanceof UnsupportedPrinter
      ? `${e.message} uses a different protocol that PurrPrint doesn't support yet.`
      : e.name === 'NotFoundError' ? 'No printer selected.' : 'Could not connect. Turn the printer off and on, close its phone app, and try again.', true);
    return false;
  } finally { paintConnection(); }
}

$('#connect').addEventListener('click', async () => {
  if (printer.connected) { printer.disconnect(); status('Disconnected.'); return; }
  await ensureConnected();
});

let printing = false;
async function printBits(bits, { isText = false, copies = 1 } = {}) {
  if (printing) return false;
  if (!(await ensureConnected())) return false;
  printing = true;
  const btn = $('#print'), bar = $('#progress');
  btn.disabled = true;
  const job = buildJob(bits, {
    profile: printer.profile, darkness: state.darkness, speed: +$('#speed').value, compress: $('#compress').checked, isText,
  });
  try {
    for (let n = 1; n <= copies; n++) {
      $('#print-label').textContent = copies > 1 ? `Printing ${n}/${copies}…` : 'Printing…';
      await printer.send(job, (p) => (bar.style.width = `${p * 100}%`));
      if (n < copies) await sleep(1500);
    }
    status('Printed! ✨');
    return true;
  } catch (e) {
    console.error(e);
    track('print_failed', { mode: state.mode, reason: e.name });
    status('Printing stopped — the printer disconnected. Check it is on and charged, then try again.', true);
    return false;
  } finally {
    printing = false; btn.disabled = false; bar.style.width = '0';
    $('#print-label').textContent = 'Print';
  }
}

$('#print').addEventListener('click', async () => {
  if (!state.bits) { status(state.mode === 'photo' ? 'Choose a photo first.' : 'Nothing to print yet.', true); return; }
  if (await printBits(state.bits, { isText: state.mode !== 'photo', copies: state.copies }))
    track('print', { mode: state.mode, style: state.style, darkness: state.darkness, copies: state.copies, printer_model: printer.name });
});

$('#test-print').addEventListener('click', async () => {
  if (!(await ensureConnected())) return;
  await R.loadFont('clean', true);
  const c = R.testPage(printer.name, ['Light', 'Normal', 'Dark', 'Extra dark'][state.darkness - 1]);
  const bits = dither(toGray(c.getContext('2d'), c.width, c.height), c.width, c.height, 'atkinson');
  if (await printBits(bits)) track('test_print', { printer_model: printer.name, profile: printer.profile.name });
});

$('#feed').addEventListener('click', async () => {
  if (!(await ensureConnected())) return;
  try { await printer.send(feedJob(printer.profile)); } catch { status('Could not feed paper.', true); }
});

// ---- copies
const setCopies = (n) => { state.copies = Math.max(1, Math.min(10, n)); $('#copies').value = state.copies; update(); };
$('#minus').onclick = () => setCopies(state.copies - 1);
$('#plus').onclick = () => setCopies(state.copies + 1);

// ---- tabs
for (const t of $$('[role=tab]')) {
  t.addEventListener('click', () => {
    state.mode = t.dataset.mode;
    for (const x of $$('[role=tab]')) x.setAttribute('aria-selected', String(x === t));
    for (const p of $$('[data-panel]')) p.hidden = p.dataset.panel !== state.mode;
    update();
  });
}

// ---- photo input: picker, camera, drag & drop, paste
function loadImage(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    state.image = img; state.rotate = 0;
    $('#thumb').src = url; $('#thumb').hidden = false; $('#drop-hint').hidden = true;
    if (state.mode !== 'photo') $('[data-mode=photo]').click(); else update();
  };
  img.onerror = () => status('That file could not be opened as an image.', true);
  img.src = url;
}
$('#file').onchange = (e) => loadImage(e.target.files[0]);
$('#camera').onchange = (e) => loadImage(e.target.files[0]);
const drop = $('#drop');
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file').click(); } });
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); loadImage(e.dataTransfer.files[0]); });
window.addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) { e.preventDefault(); loadImage(f); }
});
$('#rotate').onclick = () => { state.rotate = (state.rotate + 90) % 360; update(); };

// ---- text / list / qr inputs
fontChips($('#text-fonts'), 'font');
fontChips($('#list-fonts'), 'listFont');
pressGroup($('#text-align'), 'align');
pressGroup($('#qr-kind'), 'qrKind', (v) => { $('#qr-link').hidden = v !== 'link'; $('#qr-wifi').hidden = v !== 'wifi'; });
$('#insert-date').onclick = () => {
  const t = $('#text');
  const d = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  t.value = `${t.value}${t.value && !t.value.endsWith('\n') ? '\n' : ''}${d}`;
  update();
};
$('#list-presets').addEventListener('click', (e) => {
  const p = PRESETS[e.target.closest('button')?.dataset.preset];
  if (p) { $('#list-title').value = p[0]; $('#list-items').value = p[1]; update(); }
});

// ---- look
pressGroup($('#style'), 'style');
pressGroup($('#darkness'), 'darkness');
$('#reset-adjust').onclick = () => { $('#brightness').value = 0; $('#contrast').value = 0; $('#invert').checked = false; update(); };

for (const el of $$('input, textarea')) if (el.type !== 'file') el.addEventListener('input', updateSoon);

// ---- boot
const startMode = new URLSearchParams(location.search).get('mode'); // shareable ?mode=text|list|qr
if (startMode) document.querySelector(`[role=tab][data-mode="${CSS.escape(startMode)}"]`)?.click();
if (!supported()) $('#unsupported').hidden = false;
document.fonts.ready.then(update);
window.addEventListener('load', update); // qrcode lib is deferred
update();
