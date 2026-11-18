# LG LA130GC

ThinQ2 model `WIN_056905_WW`, firmware `353700`, EEPROM checksum `0x0522`.
Investigated against live hardware on November 18, 2026. The existing WIN handler
also serves heating window units, so discovery follows protocol capabilities,
not a device UUID, country, firmware string, or assumed physical model name.
Production metadata identifies this unit only as `WIN_056905_WW`.

## Implemented behavior

- Climate: off, cool, dry and fan-only; low, medium and high fan speeds.
- Setpoint: 16–30°C in whole degrees. Room temperature retains 0.5°C precision.
- Power sensor: appliance-reported watts, without a guessed correction.
- Active energy control: off, 80%, 60% and 40%; available only while cooling.
- Beep and display-light switches, plus a diagnostic error-code sensor.
- Filter remaining time and filter lifetime in hours, plus a verified native reset button.
- Native turn-on/turn-off timers (0–24 hours) and sleep timer (0–12 hours), in
  whole-hour steps. Zero cancels a timer. Turn-on is available while off;
  turn-off while on; sleep while cooling, the state verified during testing.
- Climate action: cooling, drying, fan, idle and off, according to reported state.
- Device name belongs under discovery `device`, preserving the existing climate
  unique ID and MQTT control topics. Initial state is published after discovery.
- Commands reject unsupported options and invalid temperatures. Mode changes send
  power, mode, fan and setpoint together; a bare power-on bit was ignored by this unit.
- The capture/MCP packet decoder recognizes the unit's `0xA7` report kind.

## Evidence

Values below are **local protocol values**, not modelJSON enum labels. The real
capability mask is `0x2C1=7`, fan mask `0x2C2=0x54`, temperature control
`0x2C4=1`, and energy capability `0x2D5=0x60`.

| Feature                       | TLV ID                    | Raw values                                      | Conversion / meaning                                        | Verification                                                                                          |
| ----------------------------- | ------------------------- | ----------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Power state                   | `0x1F7`                   | 0, 1                                            | Off, on; on requires accompanying settings                  | Live controls and LG cloud                                                                            |
| Cool                          | `0x1F9`                   | 0                                               | `cool`                                                      | Live state and LG cloud                                                                               |
| Dry                           | `0x1F9`                   | 1                                               | `dry`; previous write mapping 8 was incorrect for this unit | Live controls and LG cloud                                                                            |
| Fan-only                      | `0x1F9`                   | 2                                               | `fan_only`                                                  | Live controls and LG cloud                                                                            |
| Fan speed                     | `0x1FA`                   | 2, 4, 6                                         | Low, medium, high                                           | Live controls and packet replay                                                                       |
| Room temperature              | `0x1FD`                   | e.g. 54, 53                                     | Divide by two: 27, 26.5°C                                   | Live packets and LG cloud                                                                             |
| Target temperature            | `0x1FE`                   | 32, 48, 52, 56                                  | Divide by two: 16, 24, 26, 28°C                             | Live controls and packet replay                                                                       |
| Limits / increment            | `0x2E1`, `0x2E2`, `0x2C4` | 32, 60, 1                                       | 16–30°C, 1°C steps                                          | Capability response; remote control confirms minimum; raw 49 write retained 48                        |
| Instantaneous power           | `0x2B3`                   | e.g. 50, 393, 608, 823                          | Watts, unchanged                                            | Live cooling/fan/off observations; local 823 matched cloud `airState.energy.onCurrent=823`            |
| Accumulated energy candidates | `0x232`, `0x233`          | Increasing values; both reset to 0 on power-off | Units and counter composition unverified                    | Captured only; no kWh entity                                                                          |
| Swing                         | `0x2CD`, `0x321`, `0x322` | Capability 0; no swing state tags               | Unsupported on this unit                                    | Live capability/state and modelJSON fixed airflow; no commands sent                                   |
| Active energy control         | `0x20D`                   | 0, 80, 60, 40                                   | Off / input-power limit in percent                          | All options accepted in live cooling; capability `0x34F` bit 10                                       |
| Beep                          | `0x3A0`                   | 0, 1                                            | On, muted                                                   | Both writes accepted; modelJSON and cloud agree; capability `0x374` bit 2                             |
| Action                        | `0x6C` with power/mode    | 0, 1                                            | Idle / active thermal operation                             | Live transitions and power correlation; replay regression                                             |
| Error code                    | `0x221`                   | 0 observed                                      | LG diagnostic code; zero means no reported error            | Local value matched cloud `airState.diagCode`; faults were not deliberately induced                   |
| Filter remaining / lifetime   | `0x355`, `0x356`          | 249, 250                                        | Remaining hours / rated lifetime hours                      | Local values match LG cloud; semantics corroborated by another WIN unit's app verification in PR #285 |

Display light is `0x21F`: 0 means on, 1 means off. Both commands and returned
states were verified live. This control is restricted to EEPROM `0x0522`, because
other LG indoor units use different polarities.

| Additional feature | TLV ID  | Raw values tested | Conversion                           | Verification                                                       |
| ------------------ | ------- | ----------------- | ------------------------------------ | ------------------------------------------------------------------ |
| Display light      | `0x21F` | 0, 1              | On, off                              | Live writes, returned state and packet replay                      |
| Turn-on timer      | `0x21C` | 60, 59, 0         | Minutes to whole hours; zero cancels | Live set/countdown/clear while off; replay through the new handler |
| Turn-off timer     | `0x21B` | 60, 0             | Minutes to whole hours; zero cancels | Live set/clear through the new handler                             |
| Sleep timer        | `0x21A` | 60, 0             | Minutes to whole hours; zero cancels | Live set/clear through the new handler while cooling               |

Native timers use `0x21C` (turn-on), `0x21B` (turn-off), and `0x21A` (sleep).
Each accepted a 60-minute request and a cancellation. A request can already read
back as 59 minutes because the appliance owns the countdown. HA displays hours,
rounded up to the next selectable hour, following the existing RAC timer pattern.
Caps `0x2D3` bits 2/4 advertise on/off timers; bit 14 advertises the 12-hour sleep
timer. Timer expiry itself was not awaited; all timers were cleared after testing.
Sleep automatically changed the display state; the handler reports this without
reapplying a previous display preference.

The watts unit is corroborated by the established ThinQ integration:
[power state key and decoding](https://github.com/ollo69/ha-smartthinq-sensors/blob/master/custom_components/smartthinq_sensors/wideq/devices/ac.py)
and [power sensor unit](https://github.com/ollo69/ha-smartthinq-sensors/blob/master/custom_components/smartthinq_sensors/sensor.py).
No external power meter was available. The unit reports **50 W even while off**;
this is an appliance estimate with a standby floor, not a calibrated wall-meter
reading. No RAC bias subtraction or fabricated standby value is applied.

The metadata-advertised read-only `energyStateCtrl/Get` request for
`airState.energy.inCurrent` returned LG error `0005`. Snapshots and notifications
exposed instantaneous power, but did not establish the two energy counters' units.
No daily/weekly/monthly or `total_increasing` energy sensor is claimed.
Home Assistant's [Integral helper](https://www.home-assistant.io/integrations/integration/)
can integrate the power sensor into estimated kWh; its result inherits the
appliance's standby-floor error and must not be presented as directly measured energy.

Filter semantics reuse [PR #285's live app verification](https://github.com/anszom/rethink/pull/285):
174/250 hours was shown as 70% remaining on another WIN unit. This agrees with
the established ThinQ integration's inversion of the cloud's misleading `useTime`
field. Our unit's raw 249/250 values were independently checked against its cloud
snapshot. The initial climate-validation run did not reset filter counters;
later user-authorized reset experiments are described below.

### Filter reset

LG's [LA130GC owner's manual, page 13](https://gscs-b2c.lge.com/open/downloadFile?fileId=BVGPLmXofBZUTHZvJFphcg)
documents a physical reset after cleaning: press **Temp ▲ and ▼ together on the
unit's control panel**. The manual specifies the panel rather than the remote
control, and identifies the reminder interval as 250 operating hours.

A native reset was verified: send **`0x355=0`** using the normal TLV setter. This
field reads remaining hours but writes elapsed hours. The appliance reported
**250/250 hours** after the zero write. Sending 250 instead exhausted the reminder
to zero; the subsequent zero write restored the full interval. The reset button
uses the zero write and waits for appliance reports without overwriting the sensor
cache with the command value. Discovery requires EEPROM `0x0522`, native filter
support flags and observed remaining/lifetime fields; other revisions are unverified.

This unit reports `0x2F1=0x201`;
modelJSON calls the advertised flags `SUPPORT` and `SUPPORT_NO_RESET_24_HOURS`.
The existing RAC handler skips its basic filter-reset path for those flags.
The metadata's generic `filterMngStateCtrl` Get/Set declaration alone does not
prove which reset operation this window unit accepts.

Live reset experiments recorded a native baseline of **248/250 hours**. A
`filterMngStateCtrl/Get` request returned a separate record: used time 0, lifetime
720, change date 0. The getter generated the existing private filter query
(`cmd=0x02`, read subtype `0x02`).

| Tested reset path                                                          | Actual result                                                   | Native reminder afterward |
| -------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------- |
| Cloud `Set` with metadata-style `dataSetList`                              | Error `0100`; emitted an empty TLV command                      | 248/250                   |
| Cloud `Set` with `dataKeyList` / `dataValueList`                           | Error `9006`; no reset packet observed                          | 248/250                   |
| Cloud `Set`, `useTime=0`                                                   | Error `9006`; no reset packet observed                          | 248/250                   |
| Cloud `Set`, `remainTime=250`                                              | Error `9006`; no reset packet observed                          | 248/250                   |
| Existing `RAC.sendFilterReset` using its freshly queried 720-hour lifetime | Successful appliance ACK; auxiliary change date became 20261118 | 248/250                   |
| Restore original auxiliary record through the same private write           | Successful ACK and readback: 0 used, 720 lifetime, date 0       | 248/250                   |
| Native TLV write `0x355=250`                                               | Interpreted as elapsed hours; exhausted reminder                | 0/250                     |
| Native TLV write `0x355=0`                                                 | Reset confirmed by notification and fresh full-state reply      | 250/250                   |
| Repeat through modified WIN handler's `filterreset` button                 | Same command bytes; full reminder retained                      | 250/250                   |

The RAC reset command is accepted but does **not** reset this unit's native
250-hour reminder. The auxiliary record was restored and stayed at 0/720/date 0
during the successful native reset. The handler exposes **Reset filter usage**
at `$this/filterreset/set`, accepting `PRESS`. The native reminder is now 250/250;
its previous elapsed history was cleared by this authorized test. The physical
panel procedure was not performed.

An initial read-state attempt timed out before any local reset was issued. A
separate power-off command appeared in the capture; the harness did not send it,
and following reset checks preserved the off state. Reset writes did not change
power, mode, fan, target temperature, timers, display or beep settings.

Detailed requests, replies, before/after states and restoration evidence are in
ignored `state/win-investigation/filter-reset/`. Sanitized actual packets are inline in
[`WIN_056905_WW.test.ts`](../../tests/cloud/devices/WIN_056905_WW.test.ts).
Regression coverage ensures auxiliary reset ACKs and 720-hour data do not overwrite
native sensors, verifies the native zero-write packet and returned 250/250 values,
and rejects reset discovery for unverified revisions or missing capabilities/data.

Other investigated fields remain unexposed: outdoor/pipe
thermistors and compressor-frequency candidates lacked window-model conversion
proof. Humidity was not advertised or observed. No raw debugging entities are added.

## Compatibility and tests

Mode/fan masks filter bidirectional enum mappings. Heating is retained when its bit
is present. Older units without those capability fields retain the previous heat,
two-speed fan and half-degree setpoint defaults. Swing also requires a reported
`0x322` value. Legacy compatibility tests
are explicitly synthetic; no LW1823HRSM hardware was available for retesting.

Related upstream work includes [capability-based WIN support (#284)](https://github.com/anszom/rethink/pull/284)
and [unified RAC support (#89)](https://github.com/anszom/rethink/pull/89).
This implementation keeps the existing WIN handler: the current RAC handler's fan
labels, power corrections and capability handling do not match this window unit.
It reuses the common TLV transport and enum helper; energy-limit values are defined
locally in the WIN handler.

Captured packets and command/reply cases are inline in
[`WIN_056905_WW.test.ts`](../../tests/cloud/devices/WIN_056905_WW.test.ts), following
the neighboring device tests. Synthetic negative/legacy cases are labeled.
Full experiment timestamps and results remain in the ignored investigation captures.
Tests cover registration, initialization, modes, fan speeds, scaling and limits,
unsupported input, missing/truncated data, power updates, discovery structure,
availability, optional-feature gating, native timers, display polarity and backward
compatibility. Captured off-state temperature commands were ignored by the unit;
the handler relies on the returned state rather than inventing acceptance.

Local investigation artifacts under ignored `state/win-investigation/` include the
original settings, full JSONL captures, cloud snapshots, experiment results and
`experiment.mjs`. The harness sends commands sequentially using the repository's
TLV sender, checks fresh appliance reports, stops on failure, and restores settings.
Its `--handler` mode executes the modified handler's `setProperty` method against
the real appliance without installing that handler in production.

Repository gates:

```sh
npm ci
npm run check
npm test
npm run build
npx prettier . --check --ignore-path .gitignore
```

On Windows, use Git Bash as npm's script shell for the existing Unix build/test
scripts. Two existing cloud-state tests require `D:\tmp` when the checkout is on
drive D because they hardcode `/tmp`. A CRLF checkout also needs Prettier's
`--end-of-line auto` for worktree checking; clean exported source uses LF.

The tests check MQTT discovery structure against the documented contract, including
device-level naming, topics, unique IDs and availability. An actual Home Assistant
discovery acceptance check remains part of deployment validation.

## Deployment and rollback

The production Home Assistant add-on has **not been replaced**. Local command
validation does not mean the modified handler is installed there.
Prepared deployment files are in ignored `state/win-investigation/deploy/`.
The source base is `4e60281` (`v0.1.4-16-g4e60281`), newer than production 0.1.3;
rollback therefore preserves the complete original data directory.

1. Preserve a full Home Assistant backup containing the Rethink add-on and its data.
   Export current add-on options and retain the exact original image/version.
   Preserve device registrations, bridge credentials, CA/key files and storage paths.
2. Review the source diff and validation results. Build from the clean source
   archive, which excludes `oauth.json`, `state/`, `.serena/`, keys and node_modules.
   The repository Dockerfile accepts `GIT_REVISION`; use a distinct custom image tag.
3. Obtain explicit approval before changing the production add-on. Use a local
   add-on copy with a distinct slug and the existing add-on's architecture, options,
   networking and data-mount contract. Do not run both servers against the appliance
   simultaneously, reprovision it, or overwrite its persistent data.
4. After approved replacement, confirm startup identifies `WIN_056905_WW`, discovery
   has `device.name` and no root `name`, heat/swing are absent for this unit, medium
   fan is present, setpoints are 16–30°C in 1°C steps, and power updates match ThinQ.
   Verify entity availability on add-on/device reconnect and confirm no HA MQTT
   discovery validation errors. Keep the existing climate unique ID.
5. If validation fails, stop the custom instance and restore the original add-on
   image/version, options and backed-up data at their original paths. Restore the
   full backup if a newer version migrated storage. Start only the original instance
   and verify bridge login, device registration and the original climate entity.

Use the clean archive as Docker build context, not a checkout containing live OAuth
credentials: the repository Dockerfile copies its build context. A custom add-on
image was not built here because Docker is unavailable on this workstation.
