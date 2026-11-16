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
#include <math.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "esp_sleep.h"
#include "driver/gpio.h"

#define SCREEN_W 128
#define SCREEN_H 64
#define SDA_PIN  8
#define SCL_PIN  9
#define BTN_PIN  4

Adafruit_SSD1306 display(SCREEN_W, SCREEN_H, &Wire, -1);

// ---- optional hardware, probed at boot ----------------------------------
#define BATT_PIN   1        // ADC tap between two 100k resistors
#define BATT_DIV   2.0f     // 100k/100k divider halves the cell voltage
#define MPU_ADDR   0x68
static bool  hasMpu   = false;
static float lastMag  = 0;
static uint32_t accelShakes = 0;

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
static uint8_t  batPct    = 100;
static uint32_t nextBatt  = 0;

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

// ---- battery, MPU6050 ----------------------------------------------------
// Cell voltage through a 100k/100k divider on BATT_PIN. analogReadMilliVolts
// uses the calibrated reference, so no manual ADC maths.
float batteryVolts() {
  uint32_t mv = 0;
  for (int i = 0; i < 8; i++) mv += analogReadMilliVolts(BATT_PIN);  // average
  return (mv / 8.0f) * BATT_DIV / 1000.0f;
}

// 3.3V = empty-ish, 4.2V = full. Clamped so the bar never disappears.
uint8_t batteryPercent() {
  float v = batteryVolts();
  float pct = (v - 3.3f) / (4.2f - 3.3f) * 100.0f;
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return (uint8_t)pct;
}

void drawBattery(uint8_t pct) {
  uint8_t bars = (pct + 24) / 25;          // 0..4, same rounding as the POC
  if (bars > 4) bars = 4;
  for (int i = 0; i < 4; i++) {
    if (i < bars) display.fillRect(108 + i * 4, 58, 3, 4, SSD1306_WHITE);
  }
  display.fillRect(107, 57, 1, 6, SSD1306_WHITE);
  display.fillRect(124, 58, 1, 4, SSD1306_WHITE);
}

bool mpuBegin() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x75);                        // WHO_AM_I
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)MPU_ADDR, (uint8_t)1) != 1) return false;
  if (Wire.read() != 0x68) return false;
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B); Wire.write(0x00);      // PWR_MGMT_1: wake
  Wire.endTransmission();
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x1C); Wire.write(0x00);      // ACCEL_CONFIG: +/-2g
  Wire.endTransmission();
  return true;
}

// Returns the acceleration magnitude in g, or -1 when no sensor is present.
float accelMagnitude() {
  if (!hasMpu) return -1;
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);                        // ACCEL_XOUT_H
  if (Wire.endTransmission(false) != 0) return -1;
  if (Wire.requestFrom((uint8_t)MPU_ADDR, (uint8_t)6) != 6) return -1;
  int16_t ax = (Wire.read() << 8) | Wire.read();
  int16_t ay = (Wire.read() << 8) | Wire.read();
  int16_t az = (Wire.read() << 8) | Wire.read();
  const float scale = 16384.0f;            // LSB per g at +/-2g
  return sqrtf((ax * ax + ay * ay + az * az)) / scale;
}

void pollShake() {
  float mag = accelMagnitude();
  if (mag < 0) return;
  // A quick jolt shows up as a large frame-to-frame change, not as raw magnitude.
  if (lastMag > 0 && fabsf(mag - lastMag) > 0.9f && mode != DIZZY) {
    accelShakes++;
    setMode(DIZZY);
  }
  lastMag = mag;
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
  drawBattery(batPct);
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

  // battery: sampling every frame would mean an ADC read + float maths per
  // frame for a value that moves over hours
  if (now - nextBatt > 10000) {
    batPct = batteryPercent();
    nextBatt = now;
  }

  // dizzy wobble
  offsetX = (mode == DIZZY) ? (int8_t)(sin(inMode / 60.0) * 3) : 0;

  if (mode == SLEEP) {
    zphase = (inMode / 260) % 8;
    if (inMode > (uint32_t)NAP_MS) {
      display.clearDisplay();
      display.display();
      display.ssd1306_command(SSD1306_DISPLAYOFF);

      // Without a wake source the chip sleeps forever and only a power cycle
      // brings it back. GPIO4 is RTC-capable on the C3; LOW = button pressed.
      gpio_pullup_en((gpio_num_t)BTN_PIN);
      gpio_pulldown_dis((gpio_num_t)BTN_PIN);
      esp_deep_sleep_enable_gpio_wakeup(1ULL << BTN_PIN, ESP_GPIO_WAKEUP_GPIO_LOW);
      esp_deep_sleep_start();
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(BTN_PIN, INPUT_PULLUP);

  // battery divider tap
  analogReadResolution(12);
  analogSetPinAttenuation(BATT_PIN, ADC_11db);   // full 0–3.3V range

  Wire.begin(SDA_PIN, SCL_PIN);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 not found");
    for (;;) delay(1000);
  }
  display.setRotation(0);
  display.dim(false);

  hasMpu = mpuBegin();
  Serial.printf("MPU6050: %s\n", hasMpu ? "found" : "not found");
  batPct = batteryPercent();
  nextBatt = millis();

  randomSeed(esp_random());
  setMode(IDLE);
  idleSince = millis();
  render();
}

void loop() {
  static bool lastBtn = HIGH;
  static uint32_t lastPoll = 0;

  bool btn = digitalRead(BTN_PIN);
  if (btn == LOW && lastBtn == HIGH) {     // press edge, debounce by frame
    delay(12);
    if (digitalRead(BTN_PIN) == LOW) boop();
  }
  lastBtn = btn;

  // 120 ms is fast enough to catch a jolt and cheap enough to leave the
  // display alone; polling per frame would double the I2C traffic.
  if (millis() - lastPoll > 120) {
    pollShake();
    lastPoll = millis();
  }

  tick();
  render();
  delay(60);                                // ~16 fps, matches the POC
}
