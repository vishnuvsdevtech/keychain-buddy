# Keychain Buddy — POC

A 128×64 pixel companion for a keychain-sized ESP32 + OLED build. This repo is
the **software proof of concept**: a browser twin of the firmware, plus the
sketch itself, so the face design and reaction timings are settled before any
parts are ordered.

**Live:** https://vishnuvsdevtech.github.io/keychain-buddy/

## Why this exists

The 8-bit keychain pet is a well-established maker project — HackCharm,
Simple Circuits' Keychain Buddy, and several open ESP32 virtual pets all cover
the hardware. What none of them help with is *deciding what the thing should
actually do* before you spend money on parts. This repo answers that by making
the behaviour adjustable in seconds.

Both layers draw into a **1-bit 128×64 framebuffer** — the same memory an
SSD1306 exposes — so geometry tuned in the browser is geometry you can paste
into the sketch.

## States

```
IDLE ──blink(130ms)──> BLINK ──> IDLE
  │                      
  ├──boop──> HAPPY (900ms) ──> IDLE
  ├──shake─> DIZZY (1400ms) ─> IDLE
  └──18s idle──> SLEEP ──boop──> IDLE
```

`SLEEP` continues into deep sleep after 5 minutes on the real device, so a
150 mAh cell survives days rather than hours.

## Layout

```
index.html                     the simulator page
assets/buddy.js                framebuffer + face + state machine
assets/style.css               device shell styling
firmware/keychain_buddy/       Arduino sketch (same geometry, same timings)
```

## Run it locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Click or tap the screen to boop. `Space` boops, `S` shakes. On a phone,
"Enable real shake" requests accelerometer access.

## Bill of materials

| Part | Note | ₹ |
|---|---|---|
| ESP32-C3 SuperMini | ESP32-S3 if you want headroom later | 450–900 |
| 0.96" I2C OLED (SSD1306) | 128×64, 4-pin | 200–350 |
| LiPo 3.7V 150–300 mAh | slim cell | 250–400 |
| TP4056 charge module | with protection | 80–150 |
| Slide switch, wire | hard power cut | 60 |
| 3D-printed shell | PETG | 0–200 |
| **Total** | | **1,040–2,060** |

## Wiring

```
OLED VCC → 3V3        OLED GND → GND
OLED SDA → GPIO8      OLED SCL → GPIO9
Button   → GPIO4 → GND (INPUT_PULLUP)
Battery + → TP4056 B+ ; OUT+ → ESP32 5V/3V3 ; battery − → B−/GND
```

## Flashing

1. Arduino IDE → ESP32 board package → **ESP32C3 Dev Module**
2. Install `Adafruit SSD1306` and `Adafruit GFX Library`
3. Open `firmware/keychain_buddy/keychain_buddy.ino`, select the port, upload

## Next step (the one worth doing)

The camera variant: swap the OLED-only build for **ESP32-S3 + OV2640**, and the
pet reacts to *who* is looking at it rather than only taps. That is the version
that connects to real edge-inference work instead of being another Tamagotchi —
but it needs a different compute budget, so it should be prototyped on the S3
before committing to a case design.

## Licence

MIT for the code. The pixel face is original.
