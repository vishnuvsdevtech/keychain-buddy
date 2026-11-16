/*
 * Keychain Buddy — ESP32 + SSD1306 128x64
 *
 * The browser POC (../index.html) draws into the same 1-bit framebuffer and
 * runs the same state machine, so the geometry and timings here are already
 * proven on screen before you solder anything.
 *
 * Wiring
 *   OLED VCC -> 3V3      OLED GND -> GND
 *   OLED SDA -> GPIO8    OLED SCL -> GPIO9
 *   Button   -> GPIO4 to GND (INPUT_PULLUP), tap = boop
 *   Optional MPU6050 on the same I2C bus for shake detection
 *
 * Libraries: Adafruit SSD1306, Adafruit GFX, (optional) Adafruit MPU6050
 *
 * Power: the OLED and ESP32 both live on 3V3. A LiPo through a TP4056 feeds
 * the 5V/VIN pad. Deep sleep after NAP_MS keeps a 150 mAh cell alive for days.
 */

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SCREEN_W 128
#define SCREEN_H 64
#define SDA_PIN  8
#define SCL_PIN  9
#define BTN_PIN  4

Adafruit_SSD1306 display(SCREEN_W, SCREEN_H, &Wire, -1);

// ---- geometry, identical to the simulator --------------------------------
static const int EYE_W = 17, EYE_H = 19, EYE_Y = 15;
static const int EYE_LX = 33, EYE_RX = 78;

enum Mode { IDLE, BLINK, HAPPY, DIZZY, SLEEP };

static Mode   mode        = IDLE;
static uint32_t modeSince = 0;
static uint32_t nextBlink = 2200;
static uint32_t idleSince = 0;
static uint32_t nextGlance = 5000;
static int8_t   glance    = 0;
static int8_t   offsetX   = 0;
static uint8_t  zphase    = 0;
static uint16_t boops     = 0;

static const uint32_t BLINK_MS  = 130;
static const uint32_t HAPPY_MS  = 900;
static const uint32_t DIZZY_MS  = 1400;
static const uint32_t SLEEP_AFTER = 18000;   // then deep sleep
static const uint32_t NAP_MS    = 5UL * 60UL * 1000UL;

// ---- drawing -------------------------------------------------------------
void drawEyeOpen(int x, int y, int pupilDx) {
  display.fillRoundRect(x, y, EYE_W, EYE_H, 4, SSD1306_WHITE);
  display.fillRect(x + 5 + pupilDx, y + 5, 6, 9, SSD1306_BLACK);
  display.drawPixel(x + 6 + pupilDx, y + 6, SSD1306_WHITE);
}

void drawEyeBlink(int x, int y) {
  display.fillRect(x, y + EYE_H - 5, EYE_W, 4, SSD1306_WHITE);
}

void drawEyeHappy(int x, int y) {
  for (int t = 0; t < 3; t++) {
    display.drawLine(x + 1, y + 13 + t, x + EYE_W / 2, y + 4 + t, SSD1306_WHITE);
    display.drawLine(x + EYE_W / 2, y + 4 + t, x + EYE_W - 2, y + 13 + t, SSD1306_WHITE);
  }
}

void drawEyeDizzy(int x, int y) {
  for (int t = 0; t < 2; t++) {
    display.drawLine(x + 2, y + 4 + t, x + EYE_W - 3, y + EYE_H - 4 + t, SSD1306_WHITE);
    display.drawLine(x + EYE_W - 3, y + 4 + t, x + 2, y + EYE_H - 4 + t, SSD1306_WHITE);
  }
}

void drawEyeSleep(int x, int y) {
  display.fillRect(x + 1, y + 10, EYE_W - 2, 2, SSD1306_WHITE);
}

void drawMouth(Mode m) {
  const int y = 44;
  switch (m) {
    case HAPPY:
      display.fillRoundRect(55, y, 18, 12, 6, SSD1306_WHITE);  // solid block
      display.fillRect(57, y + 3, 14, 8, SSD1306_BLACK);       // hollow -> U smile
      break;
    case DIZZY:
      for (int i = 0; i < 14; i++) {
        int yy = y + ((i % 4 < 2) ? 0 : 2);
        display.drawPixel(57 + i, yy, SSD1306_WHITE);
        display.drawPixel(57 + i, yy + 1, SSD1306_WHITE);
      }
      break;
    case SLEEP:
      break;
    case BLINK:
      display.fillRect(56, y, 16, 2, SSD1306_WHITE);
      break;
    default:
      display.fillRect(56, y, 16, 2, SSD1306_WHITE);
      display.drawPixel(55, y - 1, SSD1306_WHITE);
      display.drawPixel(72, y - 1, SSD1306_WHITE);
  }
}

void drawZzz(uint8_t phase) {
  for (int i = 0; i < 3; i++) {
    int zx = 96 + i * 7;
    int zy = 26 - i * 7 - (phase % 4);
    if (zy < 2) continue;
    display.fillRect(zx, zy, 5, 1, SSD1306_WHITE);
    display.drawPixel(zx + 3, zy + 1, SSD1306_WHITE);
    display.drawPixel(zx + 2, zy + 2, SSD1306_WHITE);
    display.drawPixel(zx + 1, zy + 3, SSD1306_WHITE);
    display.fillRect(zx, zy + 4, 5, 1, SSD1306_WHITE);
  }
}

void drawHeart(int x, int y) {
  display.fillRect(x + 1, y, 2, 1, SSD1306_WHITE);
  display.fillRect(x + 4, y, 2, 1, SSD1306_WHITE);
  display.fillRect(x, y + 1, 7, 2, SSD1306_WHITE);
  display.fillRect(x + 1, y + 3, 5, 1, SSD1306_WHITE);
  display.fillRect(x + 2, y + 4, 3, 1, SSD1306_WHITE);
  display.drawPixel(x + 3, y + 5, SSD1306_WHITE);
}

void render() {
  display.clearDisplay();
  int ox = offsetX;

  if (mode == SLEEP) {
    drawEyeSleep(EYE_LX + ox, EYE_Y);
    drawEyeSleep(EYE_RX + ox, EYE_Y);
    drawZzz(zphase);
  } else {
    for (int k = 0; k < 2; k++) {
      int ex = (k == 0 ? EYE_LX : EYE_RX) + ox;
      if (mode == BLINK)      drawEyeBlink(ex, EYE_Y);
      else if (mode == HAPPY) drawEyeHappy(ex, EYE_Y);
      else if (mode == DIZZY) drawEyeDizzy(ex, EYE_Y);
      else                    drawEyeOpen(ex, EYE_Y, glance * 2);
    }
    drawMouth(mode);
    if (mode == HAPPY) drawHeart(100, 12);
  }
  display.display();
}

// ---- behaviour -----------------------------------------------------------
void setMode(Mode m) { mode = m; modeSince = millis(); }

void boop() {
  if (mode == SLEEP) { setMode(IDLE); idleSince = millis(); return; }
  boops++;
  setMode(HAPPY);
}

void tick() {
  uint32_t now = millis();
  uint32_t inMode = now - modeSince;

  if (mode == HAPPY && inMode > HAPPY_MS)      { setMode(IDLE); idleSince = now; }
  else if (mode == DIZZY && inMode > DIZZY_MS) { setMode(IDLE); idleSince = now; }
  else if (mode == BLINK && inMode > BLINK_MS) { setMode(IDLE); }

  if (mode == IDLE) {
    if ((int32_t)(now - modeSince) > (int32_t)nextBlink) {
      nextBlink = 2200 + random(0, 3400);
      setMode(BLINK);
    }
    if ((int32_t)(now - idleSince) > (int32_t)nextGlance) {
      nextGlance = 3200 + random(0, 4200);
      glance = (int8_t)(random(0, 3) - 1);
      idleSince = now;
    }
    if (millis() - idleSince > SLEEP_AFTER) setMode(SLEEP);
  }

  // dizzy wobble
  offsetX = (mode == DIZZY) ? (int8_t)(sin(inMode / 60.0) * 3) : 0;

  if (mode == SLEEP) {
    zphase = (inMode / 260) % 8;
    if (inMode > (uint32_t)NAP_MS) {
      display.clearDisplay();
      display.display();
      display.ssd1306_command(SSD1306_DISPLAYOFF);
      esp_deep_sleep_start();
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(BTN_PIN, INPUT_PULLUP);

  Wire.begin(SDA_PIN, SCL_PIN);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 not found");
    for (;;) delay(1000);
  }
  display.setRotation(0);
  display.dim(false);
  randomSeed(esp_random());
  setMode(IDLE);
  idleSince = millis();
  render();
}

void loop() {
  static bool lastBtn = HIGH;

  bool btn = digitalRead(BTN_PIN);
  if (btn == LOW && lastBtn == HIGH) {     // press edge, debounce by frame
    delay(12);
    if (digitalRead(BTN_PIN) == LOW) boop();
  }
  lastBtn = btn;

  tick();
  render();
  delay(60);                                // ~16 fps, matches the POC
}
