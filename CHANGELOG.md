> This changelog covers this fork (silentnoodle3/smartbed-mqtt) starting at v1.1.22-reverie.1, when it diverged
> from upstream. For the original project's history before the fork, see
> [richardhopton/smartbed-mqtt](https://github.com/richardhopton/smartbed-mqtt/blob/main/CHANGELOG.md).

## v1.1.22-reverie.19

**Bug Fixes**

- (Common) Fix every bed command stalling for ~36 seconds and then failing, with nothing happening in between. Controllers call `bleDevice.connect()` defensively before each write (for non-persistent devices the link may have dropped since the last command). That was free when the old library sent the now-removed V1 `CONNECT` request, which the proxy answered immediately for an already-connected device - but the `1.3.6` upgrade sends the V3 connect types, which aren't necessarily answered for an address that's already connected, so every single command sat through the full response timeout plus this add-on's connect retries before giving up. `BLEDevice.connect()` now returns immediately when already connected; real drops still clear that state (proxy notification, proxy connection loss, or the periodic health check), so reconnects are unaffected
- (Reverie RevCB) Log each command as it's written. Previously a successful write logged nothing and only failures logged, which made "I pressed a button and nothing happened" indistinguishable from "the press never reached the add-on" - both were completely silent

## v1.1.22-reverie.18

**Bug Fixes**

- (Common) Fix the real cause of the bed going unresponsive that `.13`'s watchdog could detect but never recover from: the pinned `@2colors/esphome-native-api` client library (`1.3.1`) had a bug in its frame parser. On an unparseable incoming message it silently returned `undefined` instead of throwing, crashing the next line (`Cannot set properties of undefined (setting 'length')`), and never cleared its read buffer afterward - not even on reconnect. So the same corrupted bytes at the head of the buffer failed identically forever, leaving the proxy connection stuck in a `HelloResponse` timeout / parse-error loop every ~30s for hours. `.13`'s reconnect logic couldn't route around it, because the thing actually broken was the ESPHome proxy connection underneath, not the BLE link to the bed. Bumped to `@2colors/esphome-native-api@^1.3.6`, which fixes this upstream (clears its buffer on connect/close/end, closes the socket instead of corrupting parser state) and adds the newer `AuthenticationRequest`/`AuthenticationResponse` handshake current ESPHome firmware expects in place of the legacy `ConnectRequest`/`ConnectResponse` this add-on was still sending. Also resolves the `bluetoothProxyFeatureFlags` `as any` cast in `ESPHome/connect.ts`, a TODO that was explicitly waiting on this library update
- (Common) A single device failing to connect no longer takes down the whole add-on. `BLEDevice.connect()` retries a transient failure up to 3 times (3s apart) before giving up, and `index.ts` catches per-device setup failures instead of letting them become an uncaught exception that killed the process - MQTT and any already-working devices now stay up

**Note on `.14`-`.17`**

Those releases carried a regression introduced by this fork and are superseded by `.18`; don't run them. Alongside the library fix, `.14` also added an `unsubscribeBluetoothAdvertisementService()` call after the one-time startup device scan, on the assumption the advertisement stream was just wasted traffic once the scan finished. It isn't: in ESPHome's `bluetooth_proxy`, that subscription is what registers the API client as the proxy's Bluetooth subscriber. Unsubscribing tells the proxy the client is done with Bluetooth entirely, so it tears down that client's BLE connections - including ones still mid-handshake. Every connect attempt from `.14` onward therefore hung until timeout (`sendMessage timeout waiting for BluetoothDeviceConnectionResponse`), with the proxy's own debug log showing it scheduling a disconnect ~75ms into each attempt with nothing client-side having asked for one, plus the repeated-disconnect busy loop from esphome/esphome#9332. `.15`-`.17` were attempts to diagnose that symptom from the wrong end (connect-v3 cache mode, proxy firmware, the bed itself); `.18` removes the unsubscribe, which was the actual cause. Dropping the local listener is enough to ignore advertisements we no longer care about - the proxy-side subscription has to stay for the life of the connection.

## v1.1.22-reverie.13

**Bug Fixes**

- (Common) Fix the BLE connection to a bed silently going stale after a few hours - the underlying GATT link to the bed can drop (ESP32 Bluetooth proxy or the bed itself) without ever firing a clean disconnect event, leaving the add-on's process and MQTT connection up while entities keep showing their last known value and the bed stops responding. Only a manual add-on restart used to fix it. `BLEDevice` now: (1) reacts to real disconnect/error events from the proxy connection and from the BLE peripheral link itself, kicking off an automatic reconnect; (2) runs a periodic health check (a cheap characteristic read every few minutes, opt-in via `startHealthMonitoring()`) that tears down and re-establishes the connection if it times out or fails, since that's the only way to catch a drop that never announces itself; and (3) backs off exponentially (5s up to a 5 minute cap) between repeated reconnect failures instead of hammering the proxy. Applies to every bed type that keeps its BLE connection open persistently, not just Reverie - wired through the same `stayConnected` concept Richmat/MotoSleep already had (and fixed it actually reaching `BLEController` for Richmat, where it was silently dropped before reaching the connection)
- (Common) Home Assistant now shows entities as `unavailable` when the BLE link to the bed is actually down, instead of only reflecting whether the add-on's MQTT client is connected. Each persistently-connected device publishes a retained per-device availability topic reflecting real BLE health (`BLE/setupConnectionAvailability`), and every entity's HA discovery config now gates on both its own topic and this one (`availability_mode: "all"`). This also gives Home Assistant something real to automate against - e.g. restarting the add-on after N minutes of genuine unavailability - instead of a blind timer

## v1.1.22-reverie.12

**Bug Fixes**

- (Docs) Fix the "Preset: Memory 1-4" recall buttons in the dashboard template not doing anything when tapped - same `tap_action: toggle` gap as the Program buttons, just missed on this set when the dashboard was first built. Dashboard-only change, no add-on code affected

## v1.1.22-reverie.11

**Bug Fixes**

- (Common) Properly fix `MQTTConnection.publish()` for primitive (non-object) payloads - a number/boolean now gets stringified like everything else, instead of reaching the mqtt client raw and throwing `ERR_INVALID_ARG_TYPE`. This was the underlying gap behind the position-sensor crash fixed back in `1.1.22-reverie.2`, worked around locally there at the time rather than fixed at the source; fixed properly here now

## v1.1.22-reverie.10

**New Features**

- (Docs) Add a ready-made Home Assistant dashboard template under `dashboards/` - position sliders, exact-value number entries, presets, and a dedicated page per memory slot for adjusting/saving/viewing what's stored there. Templated with `{{TOKEN}}` placeholders (entity IDs vary per install) with a full walkthrough for finding your own IDs and importing it

## v1.1.22-reverie.9

**New Features**

- (Reverie RevCB) Add "Head Target"/"Foot Target" number entities - a numeric text box alternative to dragging the position cover's slider, for typing an exact value directly. Stays in sync with the bed's actual position regardless of how it was actually moved (this box, the cover slider, a preset, or a memory recall), since it listens to the same live position notify events as everything else
- (Common) Add an optional `mode` option to `NumberSlider` (`'slider' | 'box' | 'auto'`, matching the MQTT `number` entity's own mode config), defaulting to `'slider'` - zero behavior change for every existing caller

## v1.1.22-reverie.8

**New Features**

- (Reverie RevCB) Head/foot motor covers now support driving directly to an absolute position (drag the slider to a value, the bed drives there and stops on its own) instead of only open/close/stop. Discovered via a live capture of the official app's position slider: the same GATT characteristic used for position feedback is also writable, and writing a target byte there makes the device close the position loop itself - no polling or client-side stop timing needed on the add-on's side. The hold-to-move up/down/stop commands remain available and are still used to interrupt an in-progress move.

## v1.1.22-reverie.7

**Bug Fixes**

- (Common) Fix every entity (not just Reverie's) showing as permanently "Unavailable" in Home Assistant after a Home Assistant restart, if it happened to coincide with the add-on's own restart. Root cause: an entity's "online" availability is published exactly once, ~500ms after it's created, and is never retained on the broker - if Home Assistant's MQTT connection wasn't fully back up and subscribed at that exact moment, the message was lost forever with nothing to resend it. There was already a mechanism for "Home Assistant came back online" (re-announcing each entity's discovery config), it just never also replayed availability. Now it does - replaying whatever the entity's last real availability was, not blindly forcing "online" regardless of legitimate offline states elsewhere in the codebase (a couple of Sleeptracker features use those for real reasons)

## v1.1.22-reverie.6

**New Features**

- (Reverie RevCB) Track what position is saved in each Program Memory slot. The bed never reports what's stored in a slot - the add-on now captures its own live head/foot position sensors at the moment you press Program, publishes it as a "Memory N Head/Foot Position" sensor pair, and persists it to the add-on's `/data` volume so it survives a restart
- (Common) Add optional MQTT retain support to `MQTTConnection.publish()`/`StatefulEntity` (opt-in, defaults to off - no behavior change for any existing entity), used by the new memory-position sensors so they survive a Home Assistant restart too

## v1.1.22-reverie.5

**New Features**

- (Reverie RevCB) Add Program Memory 1-4 buttons - saves the bed's current position into a memory slot. Confirmed via a live BLE capture: each is the matching recall code with the high bit set (e.g. Memory 1 recall `0x04` -> program `0x84`); only Memory 1 was individually captured, 2-4 are extrapolated from that pattern.

## v1.1.22-reverie.4

**New Features**

- (Tools) Add `tools/` - the standalone BLE reverse-engineering scripts used to build RevCB support (`capture.js`, a one-shot GATT dumper; `prober.js`, an interactive BLE read/write console; `parse-btsnoop.js`, a parser for Android BLE traffic captures), plus a README documenting what each does and how to use them, linked from the end of the main README

**Bug Fixes**

- (Tools) Fix the btsnoop parser misattributing traffic to the target device after it disconnected - Android reuses BLE connection-handle numbers across unrelated devices, and the parser now drops a handle from its active set on that connection's Disconnection Complete event instead of tracking "ever seen" indefinitely

## v1.1.22-reverie.3

**New Features**

- (Docs) Rewrite the README as a self-contained install guide for this fork specifically - prerequisites, step-by-step add-on installation, two methods for finding a Reverie control box's BLE broadcast name (this add-on's own built-in scanner mode, or the nRF Connect phone app), exact configuration, and what entities to expect once it's running

**Config**

- (Config) Trim the add-on's configuration UI down to `type` (now just `reverie`/`scanner`, down from a dozen brands), `bleProxies`, `reverieDevices`, `scannerDevices`, and the MQTT fields. This only hides the other brands' fields from the Configuration tab - their implementation code under `src/` is untouched and fully intact

## v1.1.22-reverie.2

**Bug Fixes**

- (Reverie RevCB) Fix the add-on crashing shortly after any command that produces motor position notifications (e.g. clicking Anti-Snore or Zero-G moved the bed, then the whole add-on died). Root cause: `MQTTConnection.publish()` only `JSON.stringify()`s a payload if it's `instanceof Object`, which a primitive number is not - so the raw position byte from the new head/foot sensors reached the underlying MQTT client unstringified and threw an uncaught exception, crashing the entire process. Fixed locally by publishing position as a string instead of a raw number.

## v1.1.22-reverie.1

**New Features**

- (Reverie RevCB) Add support for a second Reverie control box variant - the "RevCB" module (BLE service UUID `db801000-f324-29c3-38d1-85c0c2e86885`, seen on a Reverie 3EMT king adjustable base), which upstream's existing `simple` Reverie variant doesn't support. Reverse engineered from a live BLE capture (Android HCI snoop log) of the official Reverie Nightstand app, since GATT dumps and known command-byte guesses from a related control box got nowhere. Adds Zero-G/Anti-Snore/Flat/Memory 1-4 preset buttons, head/foot motor covers (open/close/stop only - no absolute positioning at the protocol level), an under-bed light switch, and raw head/foot position sensors.
- (Branding) Rebrand this fork as "Smartbed MQTT Reverie" (slug `smartbed-mqtt-reverie`) so it installs as a completely distinct Home Assistant add-on alongside the official one, with no name/slug collision risk
