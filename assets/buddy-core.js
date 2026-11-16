/* Keychain Buddy — drawing core
 *
 * DOM-free on purpose: this file holds the framebuffer and the face geometry,
 * exactly what the firmware pushes to an SSD1306. `buddy.js` wires it to a
 * canvas in the browser; `tools/render-preview.mjs` renders it to PNG in Node.
 * One source of truth for the pixels.
 *
 * Exposes: globalThis.KB
 */

(function (root) {
  const W = 128, H = 64;

  class FrameBuffer {
    constructor(w = W, h = H) {
      this.w = w; this.h = h;
      this.buf = new Uint8Array(w * h);
    }
    clear() { this.buf.fill(0); }
    px(x, y, v = 1) {
      x |= 0; y |= 0;
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
      this.buf[y * this.w + x] = v ? 1 : 0;
    }
    get(x, y) {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
      return this.buf[y * this.w + x];
    }
    fillRect(x, y, w, h, v = 1) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, v);
    }
    roundRect(x, y, w, h, r, v = 1) {
      this.fillRect(x + r, y, w - 2 * r, h, v);
      this.fillRect(x, y + r, r, h - 2 * r, v);
      this.fillRect(x + w - r, y + r, r, h - 2 * r, v);
      for (let j = 0; j < r; j++) {
        const inset = r - Math.floor(Math.sqrt(r * r - (r - j) * (r - j)));
        this.fillRect(x + inset, y + j, w - 2 * inset, 1, v);
        this.fillRect(x + inset, y + h - 1 - j, w - 2 * inset, 1, v);
      }
    }
    line(x0, y0, x1, y1, v = 1) {
      // Coerce to integers: non-integer endpoints (e.g. EYE.w / 2 = 8.5) make
      // the termination test unreachable and the loop never returns.
      x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
      let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
      let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      for (;;) {
        this.px(x0, y0, v);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
      }
    }
  }

  /* ---- geometry (mirrors the .ino constants) ---- */
  const EYE = { w: 17, h: 19, y: 15, lx: 33, rx: 78 };

  function eyeOpen(fb, x, y, pupilDx = 0) {
    fb.roundRect(x, y, EYE.w, EYE.h, 4, 1);
    fb.fillRect(x + 5 + pupilDx, y + 5, 6, 9, 0);
    fb.px(x + 6 + pupilDx, y + 6, 1);   // catchlight
  }
  function eyeBlink(fb, x, y) {
    fb.fillRect(x, y + EYE.h - 5, EYE.w, 4, 1);
  }
  function eyeHappy(fb, x, y) {
    for (let t = 0; t < 3; t++) {
      fb.line(x + 1, y + 13 + t, x + EYE.w / 2, y + 4 + t, 1);
      fb.line(x + EYE.w / 2, y + 4 + t, x + EYE.w - 2, y + 13 + t, 1);
    }
  }
  function eyeDizzy(fb, x, y) {
    for (let t = 0; t < 2; t++) {
      fb.line(x + 2, y + 4 + t, x + EYE.w - 3, y + EYE.h - 4 + t, 1);
      fb.line(x + EYE.w - 3, y + 4 + t, x + 2, y + EYE.h - 4 + t, 1);
    }
  }
  function eyeSleep(fb, x, y) {
    fb.fillRect(x + 1, y + 10, EYE.w - 2, 2, 1);
  }

  function mouth(fb, mode) {
    const y = 44;
    if (mode === 'happy') {
      fb.roundRect(55, y, 18, 12, 6, 1);   // solid block
      fb.fillRect(57, y + 3, 14, 8, 0);    // hollow out -> U-shaped smile
    } else if (mode === 'dizzy') {
      for (let i = 0; i < 14; i++) {
        const yy = y + (i % 4 < 2 ? 0 : 2);
        fb.px(57 + i, yy, 1);
        fb.px(57 + i, yy + 1, 1);
      }
    } else if (mode === 'sleep') {
      /* eyes only */
    } else if (mode === 'blink') {
      fb.fillRect(56, y, 16, 2, 1);
    } else {
      fb.fillRect(56, y, 16, 2, 1);
      fb.px(55, y - 1, 1);
      fb.px(72, y - 1, 1);
    }
  }

  function zzz(fb, phase) {
    for (let i = 0; i < 3; i++) {
      const zx = 96 + i * 7;
      const zy = 26 - i * 7 - (phase % 4);
      if (zy < 2) continue;
      fb.fillRect(zx, zy, 5, 1, 1);
      fb.px(zx + 3, zy + 1, 1);
      fb.px(zx + 2, zy + 2, 1);
      fb.px(zx + 1, zy + 3, 1);
      fb.fillRect(zx, zy + 4, 5, 1, 1);
    }
  }

  function heart(fb, x, y) {
    fb.fillRect(x + 1, y, 2, 1, 1);
    fb.fillRect(x + 4, y, 2, 1, 1);
    fb.fillRect(x, y + 1, 7, 2, 1);
    fb.fillRect(x + 1, y + 3, 5, 1, 1);
    fb.fillRect(x + 2, y + 4, 3, 1, 1);
    fb.px(x + 3, y + 5, 1);
  }

  function battery(fb, pct) {
    const bars = Math.max(0, Math.min(4, Math.ceil(pct / 25)));
    for (let i = 0; i < 4; i++) {
      if (i < bars) fb.fillRect(108 + i * 4, 58, 3, 4, 1);
    }
    fb.fillRect(107, 57, 1, 6, 1);
    fb.fillRect(124, 58, 1, 4, 1);
  }

  /** Draw one full frame. `s` = { mode, glance, offsetX, zphase, battery } */
  function renderFace(fb, s) {
    const ox = s.offsetX || 0;
    const mode = s.mode || 'idle';

    if (mode === 'sleep') {
      eyeSleep(fb, EYE.lx + ox, EYE.y);
      eyeSleep(fb, EYE.rx + ox, EYE.y);
      zzz(fb, s.zphase || 0);
    } else {
      for (const ex of [EYE.lx + ox, EYE.rx + ox]) {
        if (mode === 'blink') eyeBlink(fb, ex, EYE.y);
        else if (mode === 'happy') eyeHappy(fb, ex, EYE.y);
        else if (mode === 'dizzy') eyeDizzy(fb, ex, EYE.y);
        else eyeOpen(fb, ex, EYE.y, (s.glance || 0) * 2);
      }
      mouth(fb, mode);
      if (mode === 'happy') heart(fb, 100, 12);
    }
    battery(fb, s.battery == null ? 100 : s.battery);
    return fb;
  }

  /** Nearest-neighbour blit with integer scale — the same operation an e-paper
   *  driver does when the source art is smaller than the panel. */
  function blitScaled(dst, src, scale, ox, oy) {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const v = src.buf[y * src.w + x];
        if (!v) continue;
        const dx = ox + x * scale, dy = oy + y * scale;
        for (let j = 0; j < scale; j++) {
          for (let i = 0; i < scale; i++) dst.px(dx + i, dy + j, 1);
        }
      }
    }
    return dst;
  }

  /** Render at a larger panel size: draws into the native 128x64 face buffer,
   *  then blits scaled and centred. Keeps one set of geometry constants. */
  function composeFace(dst, s, opts = {}) {
    const scale = Math.max(1, Math.floor(opts.scale || 1));
    const small = new FrameBuffer(128, 64);
    renderFace(small, s);
    const ox = opts.ox != null ? opts.ox
      : Math.floor((dst.w - small.w * scale) / 2);
    const oy = opts.oy != null ? opts.oy
      : Math.floor((dst.h - small.h * scale) / 2);
    return blitScaled(dst, small, scale, ox, oy);
  }

  root.KB = { W, H, FrameBuffer, EYE, renderFace, composeFace, blitScaled };
})(typeof globalThis !== 'undefined' ? globalThis : this);
