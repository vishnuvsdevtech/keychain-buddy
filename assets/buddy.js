/* Keychain Buddy — behaviour + browser wiring
 * Drawing lives in buddy-core.js; this file owns state and the DOM.
 */

const { W, H, FrameBuffer, renderFace } = KB;

/* ---------------- state machine (mirrors the .ino) ---------------- */
const state = {
  mode: 'idle',
  since: 0,
  nextBlink: 2200,
  idleSince: 0,
  nextGlance: 5000,
  glance: 0,
  offsetX: 0,
  zphase: 0,
  boops: 0,
  battery: 100,
  booted: 0,
};

const SLEEP_AFTER = 18000;
const BLINK_MS = 130;
const HAPPY_MS = 900;
const DIZZY_MS = 1400;

function setMode(m, why) {
  if (state.mode === m) return;
  state.mode = m;
  state.since = 0;
  log(`${m}${why ? ' · ' + why : ''}`);
}

function boop() {
  if (state.mode === 'sleep') { setMode('idle', 'wake'); flash(); return; }
  state.boops++;
  setMode('happy', 'boop');
  flash();
}

function shake() {
  setMode('dizzy', 'motion');
  flash();
}

function update(dt) {
  state.since += dt;
  state.idleSince += dt;
  state.booted += dt;
  state.battery = Math.max(6, state.battery - dt / 90000);

  if (state.mode === 'happy' && state.since > HAPPY_MS) { setMode('idle'); state.idleSince = 0; }
  else if (state.mode === 'dizzy' && state.since > DIZZY_MS) { setMode('idle'); state.idleSince = 0; }
  else if (state.mode === 'blink' && state.since > BLINK_MS) setMode('idle');

  if (state.mode === 'idle') {
    state.nextBlink -= dt;
    if (state.nextBlink <= 0) {
      state.nextBlink = 2200 + Math.random() * 3400;
      setMode('blink');
    }
    state.nextGlance -= dt;
    if (state.nextGlance <= 0) {
      state.nextGlance = 3200 + Math.random() * 4200;
      state.glance = [-1, 0, 1][Math.floor(Math.random() * 3)];
    }
    if (state.idleSince > SLEEP_AFTER) setMode('sleep', 'inactivity');
  }

  state.offsetX = state.mode === 'dizzy' ? Math.round(Math.sin(state.since / 60) * 3) : 0;
  if (state.mode === 'sleep') state.zphase = Math.floor(state.since / 260) % 8;
}

/* ---------------- canvas ---------------- */
const fb = new FrameBuffer();
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const img = ctx.createImageData(W, H);

const LIT = [0xff, 0x8a, 0x4d];
const UNLIT = [0x0a, 0x09, 0x08];

function draw() {
  fb.clear();
  renderFace(fb, state);
  for (let i = 0; i < W * H; i++) {
    const c = fb.buf[i] ? LIT : UNLIT;
    img.data[i * 4] = c[0];
    img.data[i * 4 + 1] = c[1];
    img.data[i * 4 + 2] = c[2];
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/* ---------------- loop, capped near the device refresh ---------------- */
let last = performance.now();
let acc = 0, frames = 0, fpsClock = 0;
const TARGET = 1000 / 16;

function loop(now) {
  const dt = now - last;
  last = now;
  acc += dt;
  fpsClock += dt;

  if (acc >= TARGET) {
    update(acc);
    draw();
    acc = 0;
    frames++;
  }
  if (fpsClock > 1000) {
    document.getElementById('st-fps').textContent = frames + ' fps';
    frames = 0; fpsClock = 0;
  }
  requestAnimationFrame(loop);
}

/* ---------------- UI ---------------- */
let logLines = 0;
function log(msg) {
  const el = document.getElementById('log');
  const s = document.createElement('span');
  const t = (state.booted / 1000).toFixed(1).padStart(5, ' ');
  s.innerHTML = `<b>${t}s</b> ${msg}`;
  el.prepend(s);
  if (++logLines > 6) el.lastChild.remove();
}

let flashing = null;
function flash() {
  const led = document.getElementById('led');
  led.classList.add('on');
  clearTimeout(flashing);
  flashing = setTimeout(() => led.classList.remove('on'), 220);
}

function telemetry() {
  document.getElementById('st-state').textContent = state.mode;
  document.getElementById('st-boops').textContent = state.boops;
  document.getElementById('st-bat').textContent = Math.round(state.battery) + '%';
  const s = Math.floor(state.booted / 1000);
  document.getElementById('st-up').textContent =
    s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}

document.getElementById('screen').addEventListener('pointerdown', (e) => { e.preventDefault(); boop(); });
document.getElementById('boop').addEventListener('click', boop);
document.getElementById('shake').addEventListener('click', shake);
document.getElementById('wake').addEventListener('click', () => {
  if (state.mode === 'sleep') { setMode('idle', 'wake'); flash(); }
  else setMode('sleep', 'manual');
});
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); boop(); }
  if (e.key === 's' || e.key === 'S') shake();
});

const motionBtn = document.getElementById('motion');
motionBtn.addEventListener('click', async () => {
  try {
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
      const p = await DeviceMotionEvent.requestPermission();
      if (p !== 'granted') { log('motion denied'); return; }
    }
    let lastMag = 0;
    window.addEventListener('devicemotion', (ev) => {
      const a = ev.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
      if (lastMag && Math.abs(mag - lastMag) > 12 && state.mode !== 'dizzy') shake();
      lastMag = mag;
    });
    motionBtn.textContent = 'Shake armed';
    motionBtn.disabled = true;
    log('accelerometer armed');
  } catch (err) {
    log('motion unavailable');
  }
});

setInterval(telemetry, 250);
log('boot · 128x64 · 1-bit');
requestAnimationFrame(loop);
