/* Keychain Buddy — E-PAPER VARIANT
 *
 * Deliberately not an animation. The face only changes when something happens,
 * and every change pays a refresh. That is the whole lesson of this page:
 * e-paper holds an image for free and charges for motion.
 *
 * Panel: 2.9" Waveshare-class, 296x128, 1-bit. The 128x64 face is blitted at
 * integer scale 2 (256x128) and centred — no geometry rewrite needed.
 */

const { FrameBuffer, renderFace, blitScaled } = KB;

/* Typical panel costs, reported in the UI. Wall-clock here also includes
   browser timer throttling, which would make the numbers lie. */
const PARTIAL_MS = 400;
const FULL_MS = 2400;

const PW = 296, PH = 128;
const SCALE = 2;

/* ---------------- state ---------------- */
const state = {
  mode: 'idle',
  boops: 0,
  battery: 100,
  glance: 0,
  offsetX: 0,
  zphase: 0,
  refreshes: 0,
  awake: false,
};

/* ---------------- buffers + canvas ---------------- */
const panel = new FrameBuffer(PW, PH);
const canvas = document.getElementById('epd');
const ctx = canvas.getContext('2d');
const img = ctx.createImageData(PW, PH);

const PAPER = [0xf4, 0xf3, 0xee];
const INK = [0x14, 0x13, 0x0f];

function compose() {
  panel.clear();
  const small = new FrameBuffer(128, 64);
  renderFace(small, state);

  // Centre on the *content*, not the buffer: the face art has margins (eyes
  // start at y=15), so centring the 128x64 canvas leaves it sitting low.
  // Centre on the face only — the battery pip on the bottom row is HUD, not
  // face, and folding it into the bbox drags the whole pet left and down.
  const HUD_Y = 54;
  let minX = small.w, maxX = -1, minY = small.h, maxY = -1;
  for (let y = 0; y < HUD_Y; y++) {
    for (let x = 0; x < small.w; x++) {
      if (small.buf[y * small.w + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return;                       // nothing drawn

  const w = (maxX - minX + 1) * SCALE;
  const h = (maxY - minY + 1) * SCALE;
  const ox = Math.round((PW - w) / 2) - minX * SCALE;
  const oy = Math.round((PH - h) / 2) - minY * SCALE;
  blitScaled(panel, small, SCALE, ox, oy);
}

/* paint the framebuffer, optionally flipped (the full-refresh invert phase) */
function paint(invert = false) {
  for (let i = 0; i < PW * PH; i++) {
    const on = panel.buf[i];
    const useInk = invert ? !on : !!on;
    const c = useInk ? INK : PAPER;
    img.data[i * 4] = c[0];
    img.data[i * 4 + 1] = c[1];
    img.data[i * 4 + 2] = c[2];
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/* fill the panel flat — the black/white clearing stages of a full refresh */
function flood(light) {
  const c = light ? PAPER : INK;
  for (let i = 0; i < PW * PH; i++) {
    img.data[i * 4] = c[0];
    img.data[i * 4 + 1] = c[1];
    img.data[i * 4 + 2] = c[2];
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const el = (id) => document.getElementById(id);

/* ---------------- power model ---------------- */
function setPower(awake, microamps, note) {
  el('pw-state').textContent = awake ? 'refreshing' : 'asleep';
  el('pw-draw').textContent = awake ? `${(microamps / 1000).toFixed(0)} mA` : `${microamps} µA`;
  el('pw-note').textContent = note;
  el('pw-bar').style.width = awake ? '100%' : '2%';
  el('pw-bar').style.background = awake ? 'var(--accent)' : 'var(--ink)';
}

/* ---------------- refresh routines ---------------- */
let busy = false;

async function fullRefresh(reason) {
  busy = true;
  el('st-mode').textContent = 'full';
  canvas.classList.add('refreshing');
  setPower(true, 20000, 'inverting the whole panel — this is the flash you hear about');

  flood(false); await wait(260);         // black
  flood(true);  await wait(420);         // white
  paint(true);  await wait(260);         // invert
  flood(true);  await wait(240);
  compose(); paint(false);               // final image

  canvas.classList.remove('refreshing');
  busy = false;
  const ms = FULL_MS;                    // modelled panel time, not host jitter
  state.refreshes++;
  state.battery = Math.max(2, state.battery - 0.05);
  el('st-ms').textContent = '~' + ms + ' ms';
  el('st-count').textContent = state.refreshes;
  setPower(false, 9, 'the image persists with no power at all; the draw is the MCU in deep sleep');
  log(`full refresh · ${ms} ms · ${reason}`);
  telemetry();
}

async function partialRefresh(reason) {
  if (busy) return;
  busy = true;
  el('st-mode').textContent = 'partial';
  canvas.classList.add('refreshing');
  setPower(true, 15000, 'rewriting only the changed pixels — faster, but it leaves ghosting');

  compose(); paint(false);
  await wait(300);                       // panel settling time
  // ghost: the previous frame lingers faintly, which is what partial refresh does
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = 'rgba(20,19,15,1)';
  ctx.fillRect(0, 0, PW, PH);
  ctx.globalAlpha = 1;
  await wait(90);
  compose(); paint(false);

  canvas.classList.remove('refreshing');
  busy = false;
  const ms = PARTIAL_MS;                 // modelled panel time, not host jitter
  state.refreshes++;
  state.battery = Math.max(2, state.battery - 0.015);
  el('st-ms').textContent = '~' + ms + ' ms';
  el('st-count').textContent = state.refreshes;
  setPower(false, 9, 'the image persists with no power at all; the draw is the MCU in deep sleep');
  log(`partial · ${ms} ms · ${reason}`);
  telemetry();
}

/* ---------------- behaviour ----------------
 * No tick loop. State changes are the only thing that triggers work.
 */
function setMode(m, why) {
  const prev = state.mode;
  if (prev === m) return;
  state.mode = m;
  el('st-state').textContent = m;
  // a mode change is what a real device would wake for
  partialRefresh(`${prev} → ${m}${why ? ' · ' + why : ''}`);
  if (m === 'idle') {
    // schedule the next "blink" as a slow, deliberate event
    clearTimeout(state.blinkTimer);
    state.blinkTimer = setTimeout(() => {
      if (state.mode !== 'idle') return;
      state.mode = 'blink';
      el('st-state').textContent = 'blink';
      partialRefresh('idle → blink');
      setTimeout(() => {
        if (state.mode === 'blink') {
          state.mode = 'idle';
          el('st-state').textContent = 'idle';
          partialRefresh('blink → idle');
        }
      }, 700);
    }, 6000 + Math.random() * 6000);
  }
}

function boop() {
  if (state.mode === 'sleep') { setMode('idle', 'wake'); return; }
  state.boops++;
  setMode('happy', 'boop');
  setTimeout(() => { if (state.mode === 'happy') setMode('idle'); }, 2500);
}

function shake() {
  setMode('dizzy', 'shake');
  setTimeout(() => { if (state.mode === 'dizzy') setMode('idle'); }, 2500);
}

/* ---------------- UI ---------------- */
let logLines = 0;
function log(msg) {
  const s = document.createElement('span');
  s.innerHTML = `<b>${String(state.refreshes).padStart(2, '0')}</b> ${msg}`;
  el('log').prepend(s);                 // newest at the top, list grows downward
  if (++logLines > 4) el('log').lastElementChild.remove();
}

function telemetry() {
  el('st-bat').textContent = Math.round(state.battery) + '%';
  el('st-bat').classList.toggle('warn', state.battery < 20);
}

canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); boop(); });
el('boop').addEventListener('click', boop);
el('shake').addEventListener('click', shake);
el('sleepBtn').addEventListener('click', () => {
  if (state.mode === 'sleep') setMode('idle', 'wake');
  else setMode('sleep', 'manual');
});
el('fullBtn').addEventListener('click', () => fullRefresh('ghosting cleanup'));
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); boop(); }
  if (e.key === 's' || e.key === 'S') shake();
});

/* ---------------- boot ---------------- */
(async function boot() {
  compose();                       // first paint is a full refresh — always
  flood(true);
  await wait(120);
  paint(true);
  await wait(200);
  compose(); paint(false);
  state.refreshes = 1;
  state.battery = 96;
  el('st-mode').textContent = 'full';
  el('st-ms').textContent = '2400 ms';
  el('st-count').textContent = '1';
  el('st-state').textContent = 'idle';
  setPower(false, 9, 'the image persists with no power at all; the draw is the MCU in deep sleep');
  log('boot · full refresh · clearing ghosting');
  telemetry();
})();
