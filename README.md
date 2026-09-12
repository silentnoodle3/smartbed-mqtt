# Smart Bed MQTT Reverie

A private fork of [richardhopton/smartbed-mqtt](https://github.com/richardhopton/smartbed-mqtt) for Home Assistant,
focused specifically on **Reverie adjustable bases** - in particular the "RevCB" control box variant (the module used
on a Reverie 3EMT king adjustable base, and likely other Reverie models sharing the same control box).

This fork adds full support for that control box (upstream only supports a different, incompatible Reverie variant),
and trims the add-on's configuration down to just Reverie plus a diagnostic scanner mode, since that's all this fork
is meant to be used for. The other bed brands upstream supports (Sleeptracker, ErgoWifi, Richmat, Linak, Keeson,
etc.) still exist untouched in the source code, just hidden from this fork's add-on configuration UI - see
[the original project](https://github.com/richardhopton/smartbed-mqtt) if you need one of those.

## What you'll need

- A Home Assistant instance with the [Mosquitto MQTT broker add-on](https://github.com/home-assistant/addons/tree/master/mosquitto) installed and running.
- A dedicated ESP32 running [ESPHome's Bluetooth proxy](https://esphome.io/projects/?type=bluetooth), on the same network as Home Assistant. **Do not** add this ESP32 to Home Assistant as a Bluetooth proxy integration - due to an ESPHome limitation, only one connection can use an ESP32's Bluetooth proxy at a time, and this add-on needs that connection for itself.
- A Reverie adjustable base that's controllable via the Reverie Nightstand app over Bluetooth directly (not one that only uses Bluetooth to join Wi-Fi - those use Reverie's AWS cloud instead and aren't supported here or upstream).

## Installation

1. In Home Assistant: **Settings → Add-ons → Add-on Store**.
2. Click the ⋮ menu (top right) → **Repositories**.
3. Paste `https://github.com/silentnoodle3/smartbed-mqtt`, click **Add**, then **Close**.
4. Refresh the page. Find **Smartbed MQTT Reverie** in the store, click it, then **Install**. This builds a Docker image on your Home Assistant host and can take 10-20+ minutes depending on your hardware - be patient.
5. Once installed, go to the **Configuration** tab (see below for what to put there) before starting it.

## Finding your bed's Bluetooth name

Every Reverie RevCB control box broadcasts a Bluetooth name starting with `RevCB_` (e.g. `RevCB_E1`) while powered
on. You need your bed's *exact* name (case-sensitive, underscore included) for the configuration below. Two ways to
get it:

### Option A: Use this add-on's built-in scanner (recommended, no extra app needed)

1. Set the add-on's `type` to `scanner` and `scannerDevices` to `[{ "name": "revcb" }]` (a lowercase prefix match is enough - you don't need to know the exact name yet).
2. Also set `bleProxies` to point at your ESP32 (see Configuration below).
3. Start the add-on and open its **Log** tab.
4. Make sure the bed is powered on, then look for a line like:
   ```
   [Scanner] Found device: RevCB_E1 (d63aec0f994a): {...}
   ```
   The name shown (`RevCB_E1` in this example - yours will differ) is what you need.
5. Stop the add-on, switch `type` back to `reverie`, and continue to Configuration below.

### Option B: Use a phone BLE scanner app

Install [nRF Connect](https://www.nordicsemi.com/Products/Development-tools/nrf-connect-for-mobile) (free, Android &
iOS), open it near the bed, start a scan, and look through the list of nearby devices for one whose advertised name
starts with `RevCB_`. Tap it to see the full name if it's truncated in the list.

## Configuration

On the add-on's **Configuration** tab, set:

```yaml
type: reverie
bleProxies:
  - host: your-ble-proxy.local   # the ESP32 running ESPHome's Bluetooth proxy
reverieDevices:
  - name: RevCB_E1                # the exact name you found above
    friendlyName: Reverie Bed     # whatever you want it called in Home Assistant
```

If your ESP32's `.local` hostname doesn't resolve, use its IP address instead.

Save, go to the **Info** tab, and click **Start**. Check the **Log** tab for a line like:

```
[Reverie] Setting up entities for device: RevCB_E1
```

If instead you see `[Reverie] Device not supported`, your control box uses a different (unsupported) protocol - see
the notes on the two Reverie variants below.

## What you get

A new device in Home Assistant (named whatever you set `friendlyName` to) with:

- Buttons: **Preset: Zero G**, **Preset: Anti Snore**, **Preset: Flat**, **Preset: Memory 1-4**
- An **Under Bed Lights** switch
- **MotorHead** / **MotorFeet** covers with a real position slider - drag to a value and the bed drives there and stops on its own, the same way the official app's slider works
- **Head Target** / **Foot Target** number entities - a numeric text box alternative to dragging the cover's slider, for typing an exact value. Stays in sync with the bed's actual position no matter how it was moved (this box, the cover slider, a preset, or a memory recall)
- **Head Position** / **Foot Position** sensors (raw position counters from the bed - not calibrated to real degrees)
- **Program: Memory 1-4** buttons (tucked into Home Assistant's Configuration entity category, since it's a save action) and matching **Memory N Head/Foot Position** sensors - the bed itself never reports what's stored in a memory slot, so the add-on captures its own live position sensors at the moment you press Program and remembers it (persisted to disk, so it survives an add-on restart)

# Reverie Support (BLE)

## Configuring

You must specify at least one bleProxy as demonstrated in the config defaults. You also need to supply at least one Reverie controller with `name` and `friendlyName`.

## Current features include:

- Buttons to trigger the standard presets
- Buttons to trigger the user presets
- Buttons to program the user presets
- Button to toggle under bed lights
- Controls for the head & foot massage intesity & massage wave
- Covers to control motors for setting the position of the head/feet

## Possible future features:

- Controls for the under bed light brightness

## Notes

This remains connected to the bed controller and due to the bed only accepting one connection it will stop you from using the app to control the bed.

Initial prototyping was only possible due to assistance from Vitaliy on Discord.

# Reverie RevCB Support (BLE)

> This variant is only in this fork, not upstream. It covers a different Reverie control box than the
> [Reverie](#reverie-support-ble) variant above - one that advertises BLE service UUID
> `db801000-f324-29c3-38d1-85c0c2e86885` (seen on a Reverie 3EMT king adjustable base). It's auto-detected
> alongside the other Reverie variant, using the same `reverieDevices` configuration.

## Configuring

You must specify at least one bleProxy as demonstrated in the config defaults. You also need to supply at least one Reverie controller with `name` and `friendlyName`, the same as the [Reverie](#reverie-support-ble) variant above.

## Current features include:

- Buttons to trigger the standard presets (Zero-G, Anti-Snore, Flat)
- Buttons to trigger the user presets (Memory 1-4)
- Buttons to program the user presets (Memory 1-4) - saves the bed's *current* position into that slot
- Switch to control the under bed light
- Sensors reporting raw head/foot position
- Covers with a real position slider for the head/feet motors - drag to a value and the bed drives there and stops on its own, plus open/close (to 100/0) and stop (interrupts an in-progress move)
- Number entities (numeric text box) as an alternative to the cover's slider for typing an exact head/foot position

## Possible future features:

- Calibrated head/foot angle (in degrees) once the true min/max range is known

## Notes

Reverse engineered from a live BLE capture (Android HCI snoop log) of the official Reverie Nightstand app. Unlike the `simple` Reverie variant, there is no shared header/checksum command framing - each function (presets, head motor, foot motor, light) is its own GATT characteristic, and values are written directly.

Program Memory codes were confirmed the same way (a live capture of the app saving the bed's current position), and turned out to be a clean pattern rather than an arbitrary new number: each is the matching recall code with the high bit set (e.g. Memory 1 recall is `0x04`, program/save is `0x84`). Only Memory 1 was individually captured - 2-4 are extrapolated from that pattern.

The head/foot motors have two independent control paths that both turned out to be real: a "hold to move" register (write a direction, it moves until you write stop) used for the manual up/down buttons, and - discovered later, from a live capture of the official app's position slider - the *same characteristic used for position feedback* is also writable, and writing a target byte there drives the motor to that position autonomously, stopping on its own without any further commands. Stop is still sent via the hold-to-move register's stop code; this is assumed (not yet directly confirmed) to also interrupt an in-progress autonomous move, since it's the same underlying motor either way.

The per-slot position sensors are published with MQTT retain (nothing else in this add-on does this) specifically so they survive a Home Assistant restart without needing a fresh Program press - Home Assistant would otherwise show them as unavailable until the next save, even though the add-on's own on-disk record is still correct.

# Support

This fork is unsupported and maintained informally - if something's broken, you know who to ask. For the upstream
project (other bed brands, general questions), see
[richardhopton/smartbed-mqtt](https://github.com/richardhopton/smartbed-mqtt) and its Discord:
https://discord.gg/Hf3kpFjbZs

# Reverse-engineering tools

The [`tools/`](tools/) directory has the standalone scripts used to reverse-engineer the Reverie RevCB protocol
above - a one-shot GATT dumper, an interactive BLE read/write console, and a parser for Android BLE traffic captures
(the thing that actually cracked the protocol, after GATT dumps and blind command guessing got nowhere). They're not
part of the add-on itself; see [tools/README.md](tools/README.md) for what each one does and how to run them, useful
if this ever needs revisiting - new presets, a different hardware revision, or helping someone else with the same bed
family debug their own setup.

# Dashboard

The [`dashboards/`](dashboards/) directory has a ready-made Home Assistant dashboard for this add-on's entities -
position sliders, exact-value number entries, presets, and a dedicated page per memory slot for adjusting, saving,
and seeing what's currently stored there. It's a template (entity IDs vary per install), with a full walkthrough in
[dashboards/README.md](dashboards/README.md) for finding your own entity IDs and importing it.
