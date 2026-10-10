# The bench rig

Target: about ₹3,000, one evening to build, four faults we can induce on camera.

## Bill of materials

| Part | Why | Typical price (IN) |
|---|---|---|
| ESP32 dev board (WROOM-32) | Wi-Fi + enough speed to sample at 1–3 kHz | ₹450 |
| MPU6050 or ADXL345 accelerometer | Vibration. MPU6050 is cheaper; ADXL345 is cleaner at high g | ₹150 |
| Small DC motor or 12 V fan + mount | The machine under test | ₹600 |
| Aluminium plate, bolts, washers, shims | Mounting; the shims induce misalignment | ₹500 |
| DS18B20 or NTC thermistor | Housing temperature | ₹120 |
| Breadboard, jumpers, 12 V supply | Wiring | ₹600 |
| Optional: IR tachometer module | Real speed rather than a nominal value | ₹350 |

A phone is the camera for the measurement coach. No other hardware.

## Wiring (MPU6050, I²C)

```
MPU6050        ESP32
VCC      ───   3V3
GND      ───   GND
SCL      ───   GPIO22
SDA      ───   GPIO21
```

Mount the sensor on **bare metal** as close to the bearing housing as possible.
A sensor on plastic or on a painted surface reads mush, and no amount of
modelling fixes that.

## Sampling

The MPU6050 tops out around 1 kHz usable bandwidth, so:

- sample at **2 kHz**, low-pass at 184 Hz (the MPU6050's DLPF setting in
  `firmware/esp32_rig/esp32_rig.ino`),
- expect shaft orders (1×…5× ≈ 30–150 Hz) to be clean,
- expect **bearing resonances not to be visible** — that band is 2–5 kHz.

That is fine and is the honest framing: the rig proves imbalance, misalignment,
looseness and rub; bearing races come from CWRU recordings at 12 kHz. If you want
real bearing faults on hardware, an ADXL345 at 3.2 kHz gets you closer, and a
piezo accelerometer with an amplifier gets you there properly — out of scope for
this build.

## Inducing the four faults

| Fault | How | Undo |
|---|---|---|
| Imbalance | Tape a ₹5 coin to one blade | Remove the coin |
| Misalignment | Put a 1 mm shim under one motor foot | Remove the shim |
| Looseness | Back one mounting bolt off by a full turn | Torque it back |
| Rub / blockage | Partially block the airflow, or let a zip tie touch the rotor | Remove it |

Record **before and after** every induction: the after-capture is what proves the
repair worked, and the pair is what the verification slide uses.

## Safety

Keep fingers, cables and the phone away from the rotor. Run the motor at low
voltage first. Nothing in this project sends commands to hardware — the software
only ever reads.
