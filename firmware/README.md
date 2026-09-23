# Firmware

`esp32_rig/` streams the bench rig into the API.

## Flash it

1. Arduino IDE → Boards Manager → install **esp32** by Espressif.
2. Board: *ESP32 Dev Module*. Port: whichever appears when you plug it in.
3. Edit the configuration block at the top of `esp32_rig.ino`: Wi-Fi, the ingest
   URL (your laptop's LAN address while developing), and the token.
4. Upload, then open the serial monitor at 115200 to confirm it connected.

## What it sends

One POST per second:

```json
{
  "machine_id": "rig-01",
  "token": "...",
  "sample_rate_hz": 2000,
  "started_at_ms": 81234,
  "scale_g_per_lsb": 0.000244,
  "samples": [123, -98, ...]
}
```

Raw counts, not g: the scale factor travels with the batch so the server can
convert and so a range change does not silently rescale history.

## Known limits

- The MPU6050 is honest to roughly 800 Hz. Shaft orders are fine; bearing
  resonances (2–5 kHz) are not visible. See `docs/HARDWARE.md`.
- No buffering across Wi-Fi drops yet: a dropped batch is a lost second. If that
  bites during the demo, add a small ring buffer and a sequence number.
- The speed is assumed, not measured, until the tachometer module is wired.
