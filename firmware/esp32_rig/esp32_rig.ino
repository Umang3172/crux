/*
 * MechNova bench rig — vibration streamer
 *
 * ESP32 + MPU6050 (I2C) -> batched JSON -> POST /ingest
 *
 * Deliberately dumb: it samples at a fixed rate and ships raw counts. All
 * interpretation happens server side, so the physics stays in one place and the
 * firmware never needs to change when the diagnosis does.
 *
 * Wiring and sampling limits: docs/HARDWARE.md
 * Libraries: WiFi, HTTPClient (ESP32 core), Wire
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>

// ---------------------------------------------------------------- configuration
static const char *WIFI_SSID = "CHANGE_ME";
static const char *WIFI_PASSWORD = "CHANGE_ME";
static const char *INGEST_URL = "http://192.168.1.10:8080/ingest";  // your laptop, or Cloud Run
static const char *RIG_TOKEN = "CHANGE_ME";                          // matches RIG_INGEST_TOKEN
static const char *MACHINE_ID = "rig-01";

static const uint16_t SAMPLE_RATE_HZ = 2000;   // MPU6050 is usable to ~800 Hz
static const uint16_t BATCH_SAMPLES = 2000;    // one second per POST

// ------------------------------------------------------------------- MPU6050
static const uint8_t MPU_ADDR = 0x68;

static void mpuWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission(true);
}

static void mpuBegin() {
  Wire.begin(21, 22);
  Wire.setClock(400000);
  mpuWrite(0x6B, 0x00);  // wake up
  mpuWrite(0x1A, 0x01);  // DLPF 184 Hz: keep the band we can trust
  mpuWrite(0x1C, 0x10);  // accel range +/- 8g: impacts clip at 2g
}

// Z axis only: mount the sensor so Z is radial to the shaft.
static int16_t mpuReadAccelZ() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3F);  // ACCEL_ZOUT_H
  Wire.endTransmission(false);
  Wire.requestFrom((int)MPU_ADDR, 2, (int)true);
  int16_t high = Wire.read();
  int16_t low = Wire.read();
  return (high << 8) | low;
}

// ------------------------------------------------------------------ transport
static int16_t buffer[BATCH_SAMPLES];

static void postBatch(uint32_t startedAtMs) {
  if (WiFi.status() != WL_CONNECTED) return;

  String body;
  body.reserve(BATCH_SAMPLES * 7 + 160);
  body += "{\"machine_id\":\"";
  body += MACHINE_ID;
  body += "\",\"token\":\"";
  body += RIG_TOKEN;
  body += "\",\"sample_rate_hz\":";
  body += SAMPLE_RATE_HZ;
  body += ",\"started_at_ms\":";
  body += startedAtMs;
  body += ",\"scale_g_per_lsb\":0.000244";  // +/- 8g over 16 bits
  body += ",\"samples\":[";
  for (uint16_t i = 0; i < BATCH_SAMPLES; i++) {
    if (i) body += ',';
    body += buffer[i];
  }
  body += "]}";

  HTTPClient http;
  http.begin(INGEST_URL);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  if (code <= 0) {
    Serial.printf("post failed: %s\n", http.errorToString(code).c_str());
  }
  http.end();
}

// ----------------------------------------------------------------- lifecycle
void setup() {
  Serial.begin(115200);
  mpuBegin();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("wifi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print('.');
  }
  Serial.printf("\nconnected: %s\n", WiFi.localIP().toString().c_str());
}

void loop() {
  const uint32_t periodUs = 1000000UL / SAMPLE_RATE_HZ;
  const uint32_t startedAtMs = millis();

  // Fixed-rate sampling. Jitter here becomes noise in the spectrum, so we busy
  // wait rather than delay(): at 2 kHz the loop has 500 us to spare.
  uint32_t next = micros();
  for (uint16_t i = 0; i < BATCH_SAMPLES; i++) {
    while ((int32_t)(micros() - next) < 0) {
    }
    buffer[i] = mpuReadAccelZ();
    next += periodUs;
  }

  postBatch(startedAtMs);
}
