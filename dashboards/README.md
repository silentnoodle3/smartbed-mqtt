# Reverie RevCB dashboard

A ready-made Home Assistant dashboard for the entities this add-on creates - built and
refined interactively against a real Reverie 3EMT king base. Two tabs' worth of UI:

- **Reverie** - head/foot position sliders, a numeric "type an exact value" box for
  each, the standard presets, and buttons for all 4 memory slots (tap to recall,
  **long-press to jump to that slot's own page**)
- **Memory 1-4** - one page per slot: adjust the bed to exactly where you want it,
  hit Program to save, and see what's currently saved there (as a gauge, not just a
  number)

## Before you start

You need the add-on itself installed and working first - see the [main
README](../README.md) for that. Come back here once you can see your bed's entities
under Settings → Devices & Services → Entities.

## Step 1 - find your entity IDs

[`reverie-bed-dashboard.yaml`](reverie-bed-dashboard.yaml) is a template, not
something you can paste as-is - it's full of `{{TOKEN}}` placeholders because entity
IDs vary per install. Some of them are also genuinely unpredictable in advance: a
few entities on the original install ended up with an unexpected `master_bedroom_`
prefix (Home Assistant disambiguating a naming collision specific to that instance),
which nobody could have guessed ahead of time - so don't assume yours will match
someone else's, always look them up.

Go to **Settings → Devices & Services → Entities**, search for your bed's device
name, and fill in this table (click into the Entities table's column picker if you
don't see an "Entity ID" column):

| Token | Domain | Friendly name to search for |
|---|---|---|
| `{{HEAD_COVER}}` | cover | Head |
| `{{FOOT_COVER}}` | cover | Feet |
| `{{HEAD_TARGET}}` | number | Head Target |
| `{{FOOT_TARGET}}` | number | Foot Target |
| `{{PRESET_FLAT}}` | button | Preset: Flat |
| `{{PRESET_ZERO_G}}` | button | Preset: Zero G |
| `{{PRESET_ANTI_SNORE}}` | button | Preset: Anti Snore |
| `{{PRESET_MEMORY_1}}` | button | Preset: Memory 1 |
| `{{PRESET_MEMORY_2}}` | button | Preset: Memory 2 |
| `{{PRESET_MEMORY_3}}` | button | Preset: Memory 3 |
| `{{PRESET_MEMORY_4}}` | button | Preset: Memory 4 |
| `{{PROGRAM_MEMORY_1}}` | button | Program: Memory 1 |
| `{{PROGRAM_MEMORY_2}}` | button | Program: Memory 2 |
| `{{PROGRAM_MEMORY_3}}` | button | Program: Memory 3 |
| `{{PROGRAM_MEMORY_4}}` | button | Program: Memory 4 |
| `{{MEMORY_1_HEAD_POSITION}}` | sensor | Memory 1 Head Position |
| `{{MEMORY_1_FOOT_POSITION}}` | sensor | Memory 1 Foot Position |
| `{{MEMORY_2_HEAD_POSITION}}` | sensor | Memory 2 Head Position |
| `{{MEMORY_2_FOOT_POSITION}}` | sensor | Memory 2 Foot Position |
| `{{MEMORY_3_HEAD_POSITION}}` | sensor | Memory 3 Head Position |
| `{{MEMORY_3_FOOT_POSITION}}` | sensor | Memory 3 Foot Position |
| `{{MEMORY_4_HEAD_POSITION}}` | sensor | Memory 4 Head Position |
| `{{MEMORY_4_FOOT_POSITION}}` | sensor | Memory 4 Foot Position |
| `{{UNDER_BED_LIGHTS}}` | switch | Under Bed Lights |

## Step 2 - create the dashboard and note its URL

Settings → Dashboards → **+ Add Dashboard** → **New dashboard from scratch**. Give it
any name/icon. Open it, then look at your browser's address bar - the segment right
after your Home Assistant URL is this dashboard's own path, e.g.
`.../my-new-dashboard-slug/...`. Write that down as `{{DASHBOARD_PATH}}` - it's not an
entity, it's just needed so the Memory buttons' long-press can jump to the right tab
within *this* dashboard.

## Step 3 - fill in the template

Copy [`reverie-bed-dashboard.yaml`](reverie-bed-dashboard.yaml) into a text editor
(VS Code, Notepad++, anything with find & replace) and replace every `{{TOKEN}}`
(including the curly braces) with the real value from your table above. There are 25
tokens total (24 entities + the dashboard path) - do a "replace all" for each one so
you don't miss an occurrence, since most tokens appear more than once (the two
Target entities in particular appear on all 5 pages).

## Step 4 - import it

Back in your new dashboard: Edit Dashboard (pencil icon, top right) → ⋮ menu → **Edit
in YAML**. Select all the existing placeholder content and delete it, then paste in
your filled-in YAML. Save.

You should end up with 5 tabs across the top: Reverie, and Memory 1 through 4.

## Notes

- The gauges use `min: 0, max: 100` as a reasonable guess - the true mechanical range
  of each motor hasn't been calibrated (see the main README's notes on this). If your
  bed's head/foot never reaches anywhere near 100 on the gauge, that's expected for
  now, not a bug.
- The `tap_action: toggle` lines on button cards aren't decorative - without them,
  tapping some button cards opens a details popup instead of actually pressing the
  button. Don't remove them.
- If a `button` card's icon looks huge instead of appropriately sized, that's a known
  quirk of `type: button` cards scaling their icon relative to the *card's own width*
  rather than a fixed size - the `icon_height: 48px` lines pin it down. Don't remove
  those either.
- If you see numbers on the position tiles/gauges but the label ("Head"/"Foot") is
  missing, it's usually because the containing card ended up narrower than expected
  (a nested `grid` card wrapping something that's already inside a dashboard section's
  own grid will do this) - flatten the structure rather than fighting the card config.
