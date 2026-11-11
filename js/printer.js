// Web Bluetooth transport for 0xAE30 cat printers.
import { profileFor, parseStatus, stateQuery } from './protocol.js';

const SERVICE = 0xae30, SERVICE_MAC = 0xaf30; // some macOS stacks expose AE30 as AF30
const WRITE = 0xae01, NOTIFY = 0xae02;
const PREFIXES = ['SC0', 'GB0', 'GT0', 'MX', 'YT0', 'X5', 'X6', 'X7', 'X8', 'MPA', 'P1', 'P2', 'D1', 'LY0', 'FC02', 'Mini', 'Pocket', 'Cat'];
const PAUSE_TIMEOUT = 15000, OVERHEAT_TIMEOUT = 60000;

export const supported = () => !!navigator.bluetooth;

export class UnsupportedPrinter extends Error {}

export class Printer extends EventTarget {
  device = null; char = null; profile = null; status = null; chunk = 0;

  get connected() { return !!this.device?.gatt?.connected; }
  get name() { return this.device?.name || 'Printer'; }

  async connect() {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE] }, { services: [SERVICE_MAC] }, ...PREFIXES.map((namePrefix) => ({ namePrefix }))],
      optionalServices: [SERVICE, SERVICE_MAC],
    });
    this.profile = profileFor(this.device.name);
    if (!this.profile) {
      const name = this.name;
      this.device = null;
      throw new UnsupportedPrinter(name);
    }
    this.chunk = this.profile.chunk;
    this.device.addEventListener('gattserverdisconnected', () => { this.status = null; this.emit(); });
    await this.#open();
  }

  async #open() {
    // ponytail: these printers often refuse the first GATT connect; 3 tries covers it
    let err;
    for (let i = 0; i < 3; i++) {
      try {
        const server = await this.device.gatt.connect();
        const svc = await server.getPrimaryService(SERVICE).catch(() => server.getPrimaryService(SERVICE_MAC));
        this.char = await svc.getCharacteristic(WRITE);
        try {
          const n = await svc.getCharacteristic(NOTIFY);
          n.addEventListener('characteristicvaluechanged', (e) => {
            const st = parseStatus(new Uint8Array(e.target.value.buffer, e.target.value.byteOffset, e.target.value.byteLength));
            if (st) { this.status = st; this.dispatchEvent(new Event('status')); }
          });
          await n.startNotifications();
          await this.char.writeValueWithoutResponse(stateQuery()); // populate paper/battery flags
        } catch { /* status + flow control are optional */ }
        this.emit();
        return;
      } catch (e) { err = e; await sleep(800); }
    }
    throw err;
  }

  disconnect() { this.device?.gatt?.disconnect(); }

  // Wait while the printer asks us to pause or is overheating; bounded so a lost notification can't hang a print.
  async #waitIfBlocked() {
    const start = Date.now();
    while (this.status?.paused || this.status?.overheat) {
      if (Date.now() - start > (this.status.overheat ? OVERHEAT_TIMEOUT : PAUSE_TIMEOUT)) break;
      await sleep(50);
    }
  }

  // onProgress(0..1)
  async send(bytes, onProgress = () => {}) {
    if (!this.connected) await this.#open();
    for (let i = 0; i < bytes.length; ) {
      await this.#waitIfBlocked();
      const part = bytes.subarray(i, i + this.chunk);
      try {
        await this.char.writeValueWithoutResponse(part);
      } catch (e) {
        if (this.chunk > 20) { this.chunk = 20; continue; } // small-MTU devices
        throw e;
      }
      i += part.length;
      onProgress(i / bytes.length);
      await sleep(this.chunk > 20 ? this.profile.delay : 8);
    }
  }

  emit() { this.dispatchEvent(new Event('change')); }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
