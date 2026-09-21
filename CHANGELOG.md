> This changelog covers this fork (silentnoodle3/smartbed-mqtt) starting at v1.1.22-reverie.1, when it diverged
> from upstream. For the original project's history before the fork, see
> [richardhopton/smartbed-mqtt](https://github.com/richardhopton/smartbed-mqtt/blob/main/CHANGELOG.md).

## v1.1.22-reverie.17

**Diagnostics**

- (Common) Reverted `.16`'s `useCache: true` experiment back to the library default (`false`). Watching the ESPHome proxy's own live debug log during a connect attempt (not just this add-on's logs) showed the `.16` theory was wrong: it's not slow GATT discovery blocking the response - the proxy accepts the connect request, starts connecting, then schedules and runs its own disconnect after only ~100ms, before any connection ever stabilizes, on every single attempt. That's proxy-side behavior neither the add-on nor the `useCache` flag controls. Reverting this variable to get a clean before/after comparison with proxy-side logs on both sides while the real cause gets diagnosed further

## v1.1.22-reverie.16

**Bug Fixes (experimental)**

- (Common) After `.15`, one device (a Reverie RevCB bed with many characteristics on one custom service) was still deterministically timing out on `BluetoothDeviceConnectionResponse` on every single connect attempt - proxy healthy, advertisement discovery instant, proxy reboot didn't help, phone's official app connected to the bed instantly. Root cause candidate: the `1.3.6` library bump necessarily switched the BLE connect request from the old `CONNECT` type (formally deprecated/removed upstream - "V1 removed, use V3 variants") to the new `CONNECT_V3_WITHOUT_CACHE`, which makes the proxy run a full fresh GATT service discovery as part of connecting, before it can even reply "connected". For a device with a lot of characteristics on one service, that discovery may now take longer than the client's fixed wait for a response. Switched to requesting `CONNECT_V3_WITH_CACHE` instead, which skips that re-discovery. Marked experimental because it addresses the most likely mechanism given the evidence, not something bench-confirmed against this specific bed yet

## v1.1.22-reverie.15

**Bug Fixes**

- (Common) Fix the add-on crashing and stopping entirely (instead of recovering) if the very first BLE connect attempt at startup times out - which is exactly what happened updating into `.14`: the library fix worked (no more parse-error crash loop), but the first `connectBluetoothDeviceService` call still timed out once, almost certainly leftover state on the proxy from the old crash loop never having cleanly disconnected. Nothing caught that failure, so it became an uncaught exception that killed the whole process (MQTT connection and all). Two fixes: `BLEDevice.connect()` now retries a transient failure up to 3 times (3s apart) before giving up, absorbing exactly this kind of one-off blip silently; and `index.ts` no longer lets any single device's setup failure take down the whole add-on - it's now caught and logged, so MQTT and every other already-working device stay up instead of the entire container dying

## v1.1.22-reverie.14

**Bug Fixes**

- (Common) Fix the actual cause of the bed going unresponsive that v1.1.22-reverie.13's watchdog exposed but couldn't recover from: the pinned `@2colors/esphome-native-api` client library (v1.3.1) had a real bug in its frame parser - on an unrecognized/unparseable incoming message it silently returned `undefined` instead of throwing, which crashed the next line (`Cannot set properties of undefined (setting 'length')`), and never cleared its read buffer afterward (not even on reconnect), so the same corrupted bytes at the head of the buffer failed the exact same way forever. Confirmed from a live log: the proxy connection was stuck in a tight `HelloResponse` timeout / parse-error loop every ~30s for hours, immune to v13's reconnect logic because the reconnect loop it was retrying underneath - the ESPHome proxy `Connection` itself - was the thing actually broken, not the BLE peripheral link. Bumped to `@2colors/esphome-native-api@^1.3.6`, which fixes this upstream (clears its buffer on connect/close/end, and closes the socket instead of corrupting state on an unparseable message) and adds compatibility with the newer `AuthenticationRequest`/`AuthenticationResponse` handshake current ESPHome firmware versions expect instead of the legacy `ConnectRequest`/`ConnectResponse` this add-on was still sending. Also resolves the `bluetoothProxyFeatureFlags` `as any` cast in `ESPHome/connect.ts` that was left as a known TODO waiting on exactly this
- (Common) Stop leaking the BLE-advertisement subscription used for the one-time device scan at startup - `ESPConnection.discoverBLEDevices()` was never calling `unsubscribeBluetoothAdvertisementService()` afterward, so the proxy kept streaming every BLE advertisement it heard (from any nearby device, not just the bed) to this add-on for the rest of the process's life with nothing listening anymore. Harmless by itself, but needless load on the exact connection that needs to stay healthy

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
