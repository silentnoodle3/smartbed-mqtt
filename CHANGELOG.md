> This changelog covers this fork (silentnoodle3/smartbed-mqtt) starting at v1.1.22-reverie.1, when it diverged
> from upstream. For the original project's history before the fork, see
> [richardhopton/smartbed-mqtt](https://github.com/richardhopton/smartbed-mqtt/blob/main/CHANGELOG.md).

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
