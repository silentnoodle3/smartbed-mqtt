# Reverie RevCB reverse-engineering tools

Standalone scripts used to reverse-engineer and validate the Reverie RevCB BLE protocol
(`src/Reverie/revcb/`). These are **not** part of the add-on itself - they're diagnostic
tools you run directly with `node`, useful if this protocol ever needs revisiting (new
presets, a slightly different hardware revision, helping someone else with the same bed
family debug their setup, etc).

## Setup

```bash
cd tools
npm install
```

All three connect to a BLE device through an **ESPHome Bluetooth proxy** - the same
proxy your Home Assistant add-on uses - not directly over your machine's own Bluetooth
radio. Set `BLE_HOST` to that proxy's hostname or IP.

## `capture.js` - one-shot GATT dump

Connects to a device, dumps its full advertised services/characteristics tree
(UUIDs, properties, and any readable values) to a JSON file, then exits.

```bash
BLE_HOST=your-ble-proxy.local BLE_TARGET=RevCB_E1 node capture.js
```

Useful for a first look at unfamiliar hardware, but on its own it only shows a
**snapshot at rest** - it won't tell you which characteristic changes when you actually
press a button. Two captures taken before/after triggering some action can sometimes
show a diff, but for anything beyond a single obviously-changed byte, you need
`parse-btsnoop.js` on real traffic instead (see below) - this is exactly what happened
during Reverie RevCB reverse engineering: GATT dumps and blind command guessing got
nowhere, live traffic capture is what actually worked.

## `prober.js` - interactive BLE console

Connects, subscribes to every notify-capable characteristic, and gives you a live
`ble>` prompt to read/write arbitrary handles and watch notify traffic as it happens.

```bash
BLE_HOST=your-ble-proxy.local BLE_TARGET=RevCB_E1 node prober.js
```

Type `help` at the prompt for the full command list. The built-in `Commands` table and
"known handles" reference are specific to the Reverie RevCB protocol this was built
for - update them if pointing this at different hardware. Good for confirming a
hypothesis quickly (e.g. "does writing X to handle Y move the head or the foot?") once
you already have a rough idea what to try, and for reproducing a bug outside of the
full add-on (this is how the position-sensor MQTT crash was isolated - see the main
README/internal docs for that story).

## `parse-btsnoop.js` - Android BLE traffic capture parser

Parses a real `btsnoop_hci.log` (Android's Bluetooth HCI snoop log) and prints the
ATT-layer Write Request/Command and Handle Value Notification/Indication traffic for
one target device, by MAC address. This is what actually cracked the RevCB protocol.

**Capturing one:**

1. On the phone with the bed's official app installed: Settings → Developer options →
   enable **"Bluetooth HCI snoop log"** (pick "Full" if given a choice, not "Filtered").
   Toggle Bluetooth off/on (or reboot) so logging actually starts.
2. Open the app, connect to the bed, and trigger **one isolated action at a time**,
   with a few seconds of idle time between each (e.g. Zero-G, wait, Flat, wait, head up
   for ~2s then release, wait, ...) - this makes it trivial to line up a timestamp in
   the log with what you actually did.
3. Developer options → **"Bug report"** / **"Take bug report"** (Full report) → wait
   for it to generate → share/save the resulting zip.
4. Extract `FS/data/misc/bluetooth/logs/btsnoop_hci.log` from that zip.

**Parsing it:**

```bash
node parse-btsnoop.js /path/to/btsnoop_hci.log d63aec0f994a
```

(second argument is the target device's MAC, no colons - defaults to this project's
own bed if omitted). Output is a chronological list of writes and notifications on the
target device's connection, e.g.:

```
[137.890s] TX WriteRequest handle=46 value=02
[144.176s] TX WriteRequest handle=46 value=04
```

**Known gotcha this script guards against:** Android reuses BLE connection-handle
numbers across unrelated devices once a connection drops. If you see a burst of
traffic that makes no sense right after your target device disconnects, it's probably
a different accessory (earbuds, a watch, etc.) that got assigned the same handle
number later in the same capture - this script tracks connect/disconnect per handle to
avoid attributing that traffic to the wrong device, but always sanity-check timestamps
against what you actually did if something looks off.
