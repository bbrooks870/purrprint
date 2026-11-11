// Web Bluetooth transport for 0xAE30 cat printers.
import { isPause, isResume } from './protocol.js';

const SERVICE = 0xae30, WRITE = 0xae01, NOTIFY = 0xae02;
const PREFIXES = ['SC0', 'GB0', 'GT0', 'MX0', 'MX1', 'YT0', 'X5', 'X6', 'X7', 'X8', 'MPA', 'P1', 'P2', 'D1', 'LY0', 'Mini', 'Pocket', 'Cat'];

export const supported = () => !!navigator.bluetooth;

export class Printer extends EventTarget {
  device = null; char = null; paused = false; chunk = 180;

  get connected() { return !!this.device?.gatt?.connected; }
  get name() { return this.device?.name || 'Printer'; }

  async connect() {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE] }, ...PREFIXES.map((namePrefix) => ({ namePrefix }))],
      optionalServices: [SERVICE],
    });
    this.device.addEventListener('gattserverdisconnected', () => this.emit());
    await this.#open();
  }

  async #open() {
    // ponytail: these printers often refuse the first GATT connect; 3 tries covers it
    let err;
    for (let i = 0; i < 3; i++) {
      try {
        const server = await this.device.gatt.connect();
        const svc = await server.getPrimaryService(SERVICE);
        this.char = await svc.getCharacteristic(WRITE);
        try {
          const n = await svc.getCharacteristic(NOTIFY);
          n.addEventListener('characteristicvaluechanged', (e) => {
            const b = new Uint8Array(e.target.value.buffer);
            if (isPause(b)) this.paused = true;
            if (isResume(b)) this.paused = false;
          });
          await n.startNotifications();
        } catch { /* flow control is optional */ }
        this.emit();
        return;
      } catch (e) { err = e; await sleep(800); }
    }
    throw err;
  }

  disconnect() { this.device?.gatt?.disconnect(); }

  // onProgress(0..1)
  async send(bytes, onProgress = () => {}) {
    if (!this.connected) await this.#open();
    for (let i = 0; i < bytes.length; ) {
      while (this.paused) await sleep(50);
      const part = bytes.subarray(i, i + this.chunk);
      try {
        await this.char.writeValueWithoutResponse(part);
      } catch (e) {
        if (this.chunk > 20) { this.chunk = 20; continue; } // small-MTU devices
        throw e;
      }
      i += part.length;
      onProgress(i / bytes.length);
      await sleep(this.chunk > 20 ? 50 : 8); // same pacing TiMini-Print uses on SC03h
    }
  }

  emit() { this.dispatchEvent(new Event('change')); }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
