# Progress

Living status for the Smart Dynamic Alarm build. Architecture lives in [PLAN.md](./PLAN.md);
code style and structure in [CONVENTIONS.md](./CONVENTIONS.md).

**Legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

_Last updated: 2026-08-09_

---

## Resolved: the alarm is now fully native

The finding below was real and has been fixed by rewriting the alarm in Kotlin.
Nothing on the path from "the alarm is due" to "the phone makes noise" touches
JavaScript any more. **Awaiting device re-verification.**

```
AlarmManager.setAlarmClock          exempt from Doze, shows in the status bar
  -> AlarmReceiver (broadcast)      minimal work, system holds a wake lock
    -> AlarmService (foreground)    plays USAGE_ALARM audio, looping
                                    holds its own wake lock
                                    posts the full-screen-intent notification
                                    Dismiss / Snooze broadcast back to the receiver
BootReceiver                        re-arms from AlarmStore after a restart
AlarmStore (SharedPreferences)      durable, readable with no JS and no DB
```

`react-native-notify-kit` is removed entirely. `AlarmScheduler` kept its
interface, so the ring screen, engine, routing and tests were unaffected; only
the implementation behind it changed. The ring screen no longer starts or stops
audio, it only asks the service to stop or snooze, which means the alarm rings
correctly even if that screen never appears.

Foreground service type is `specialUse` with subtype `alarm`. `mediaPlayback`
would also work and is what several alarm apps declare, but it is meant for
user-initiated media and would be a misdeclaration on a Play listing.

---

## Original finding: the alarm cannot ring while the app is killed

Confirmed on device 2026-08-09, after a reboot and after a force-quit: the
notification appears at the right moment, but **no sound plays until the app is
opened by hand.**

The cause is architectural, not a bug. Audio is started from JavaScript, in the
notifee background event handler. When the process is dead there is no JS running,
and Android does not boot a JS context just to deliver a scheduled notification.
The `AlarmManager` part works fine, since that lives in the system. The sound does
not, because it lives in our bundle.

The cheap workaround does not hold either. Moving the sound onto the notification
channel would make Android play it natively, but notify-kit hardcodes
`USAGE_NOTIFICATION` when it sets a channel sound
(`ChannelManager.java:78`), so the alarm would play at *notification* volume on the
notification stream. For an alarm clock that is the wrong stream: a user with
notifications turned down and alarm volume up would not be woken.

**The alarm has to be fully native**, the way the system Clock app does it:
`AlarmManager` to a `BroadcastReceiver`, which starts a foreground `Service` that
plays the tone with `USAGE_ALARM` and posts the full-screen-intent notification.
JavaScript then only schedules and reads state, and is never on the path between
the alarm firing and the phone making noise. `docs/PLAN.md` already listed this as
the fallback if notify-kit proved insufficient.

Everything else built so far survives: `AlarmScheduler` keeps its interface, the
ring screen, actions, routing and engine are unaffected.

## M0 is complete

Every failure mode that would make this untrustworthy as an alarm has been
exercised on hardware (LineageOS, Android 36, preview build) and passes:

| Verified | |
|---|---|
| Sound on the alarm stream, user's own system tone | pass |
| Ring screen over the lock screen | pass |
| Through Focus / Do Not Disturb | pass |
| With battery saver on | pass |
| After force-quit from recents | pass |
| After a device reboot | pass |
| Notification Dismiss with the app killed | pass |
| Dismiss returns to the lock screen | pass |
| Two alarms armed at once | pass |
| Missed alarm recorded and notified, app never opened | pass |

The alarm is entirely native. Nothing between "the alarm is due" and "the phone
makes noise" touches JavaScript.

**Next:** M1. `apps/api` still does not exist.

---

## Current state

**Milestone M0: de-risk the alarm.** All code written; nothing verified on hardware.

The next action is an **EAS development build**, then the device checklist below.
No alarm has ever rung. Until one does, none of this counts.

Locally verified: 51 engine tests pass, all workspaces type-check, `expo prebuild`
generates a valid Android project with the correct permissions. **Not** verified:
whether any of the native code compiles, there is no Android SDK on this machine,
so `react-native-notify-kit` on RN 0.86.2 and the Kotlin module are still unproven.

---

## M0: prove the alarm works

The whole product is worthless if this fails, so it comes first. No transport APIs
and no UI polish until an alarm has actually woken someone up.

### Scaffolding
- [x] Root workspace (`package.json`, `tsconfig.base.json`, `tsconfig.json`, `.gitignore`)
- [x] `apps/mobile`: Expo SDK 57 via `create-expo-app`
- [x] `apps/mobile` cleaned of template demo content
- [x] `packages/types`: domain types, DTOs, `API_ENDPOINTS`, tuning constants
- [x] `packages/core`: engine, risk buffers, monitor cadence, fixture provider (51 tests)
- [ ] `apps/api`: Express 5 + TypeORM + Knex *(deferred; M0 does not need it)*
- [x] `docker-compose.yml`: postgres :5433 + redis :6380 (non-default ports, no clash)
- [x] Metro config for monorepo (`watchFolders`, `disableHierarchicalLookup`, src aliases)
- [x] Cross-workspace type-check passes

### Native alarm
- [x] `react-native-notify-kit` installed (10.5.0, peer range `react-native >=0.73`)
- [x] **…and compiling on RN 0.86.2.** The EAS build succeeded and the APK installed and ran.
      The biggest open risk in M0 is closed; no SDK 56 downgrade needed.
- [x] `modules/alarm-sound` local Expo module. Kotlin compiled, present in the binary
      (the Expo Go "Cannot find native module 'AlarmSound'" error is absent on the dev build)
- [x] Ringtone picker via `ACTION_RINGTONE_PICKER` + `OnActivityResult`
- [x] Playback on `USAGE_ALARM` stream, looping, with mute detection
- [x] `expo prebuild` produces an Android project with all 8 alarm permissions
- [x] `AlarmScheduler` abstraction + Android impl (`SET_ALARM_CLOCK`) + iOS fallback
- [x] Full-screen intent config + ring route + cold-start/foreground routing
- [x] `eas.json` with a `development` profile
- [x] Runs in Expo Go with alarms cleanly disabled (no crash, honest banner)
- [x] EAS dev build installs and launches on the physical Android device
- [ ] **Rebuild needed:** the first APK predates the AsyncStorage dependency

### House conventions adopted from the other apps
- [x] Prettier: 4-space, single quotes, 100 cols
- [x] `assets/Stylesheet.ts` tokens (`Spacing`, `FontSize`, `Radius`, `Colors`)
- [x] `ThemeContext` + `useThemeColor`, light/dark persisted
- [x] i18n with **nl** and **en**, Dutch first
- [x] `Axios` static class + `config.ts`
- [x] PascalCase components, `utils/{contexts,hooks,modules}` layout
- [x] ESLint configured; `npx expo lint` passes clean, with the native-import guard rule

### Known Android behaviour (not a bug)

**A full-screen intent does not, by itself, let an activity show over the lock
screen.** It only *launches* the activity; without `android:showWhenLocked` and
`android:turnScreenOn` on `MainActivity`, Android starts it behind the keyguard,
so the alarm rings but nothing is visible until the phone is unlocked by hand.
This is exactly what separates our alarm from the system Clock app. Applied via
`plugins/withAlarmLockScreen.js`, because `android/` is generated and a manual
manifest edit would be wiped by the next prebuild.


**A full-screen intent does not launch while the phone is unlocked and in use.**
From Android 13 on, the system deliberately shows a heads-up notification instead.
The ring screen only takes over the display when the device is locked, which is
the case that actually matters for an alarm clock.

**Test the 30-second alarm with the screen off and the phone locked.** Testing it
unlocked exercises the heads-up path and proves nothing about waking anyone.

**After a reboot, alarms are only restored once the phone has been unlocked at
least once.** Android delivers `BOOT_COMPLETED` after first unlock for apps that
are not direct-boot aware, and notify-kit's reboot receiver re-arms from there.
So a phone that reboots overnight and sits at the lock screen has no alarm armed
until someone touches it. Every mainstream alarm app has this limitation, but it
is a real hole in the promise and M1 should decide whether to say so in the UI.

Use the 10-minute button for reboot tests; 30 seconds is not enough time to
restart.

### Verify on a `preview` build, not a `development` one

A development build is a real APK containing our own native code, so it does
genuinely exercise the alarm chain. It is still the wrong thing to sign off on,
for one concrete reason: it is `assembleDebug` and **loads its JavaScript from
Metro over the network**.

After a reboot, or with the laptop asleep or off the network, there is no Metro.
The native alarm will ring, because that path is now pure Kotlin, but the ring
screen is JavaScript and cannot load, and `expo-dev-launcher` may show its own
screen instead of the app. That reads as a failure when it is not one.

It also means **the earlier reboot test was confounded.** Under the old design the
sound came from JavaScript, so "no Metro" and "no JS context" were
indistinguishable. The conclusion held anyway, since JS-dependent audio is wrong
either way, but the evidence was weaker than it looked.

```bash
npx eas build --profile preview --platform android    # release, JS bundled in
```

Same package id, so installing it replaces the development build; reinstall the
development build afterwards to go back to hot reload.

For the record, the debug-only manifest additions (`SYSTEM_ALERT_WINDOW`,
`usesCleartextTraffic`) live in `android/app/src/debug/AndroidManifest.xml` and
never reach a release build. That closes an earlier open question about stray
permissions before a Play submission. One consequence worth knowing when a
preview build cannot reach the API: **a release build cannot talk to `http://`
at all**, so a LAN address baked into one fails instantly, with a message that
blames the network.

### JavaScript changes do not need a build. `eas update` ships them

Found on 2026-08-17, when the free plan's Android build allowance ran out with
the push path still unverified. It cost nothing, because none of it needed a
build.

`expo-updates` is installed and configured: `runtimeVersion` follows the app
version, and each profile publishes to a channel of its own name. So an installed
preview build can be given new JavaScript over the air, unlimited and free, for
as long as its **native** code still matches:

```bash
npx eas update --branch preview --message "what changed"
```

The line that decides whether this is allowed is in the git history, not in a
config file: **no native dependency has changed since `c1f50d8` (2026-08-13)**,
the commit that added `expo-task-manager`. Everything since is JavaScript. Check
before assuming:

```bash
git log -p <last-build-commit>..HEAD -- apps/mobile/package.json | grep "^[+-].*\"expo\|^[+-].*react-native"
```

Empty output means an update is enough. Any line at all means a build, and a
build the store of installed apps will not accept as an update until it exists.

Two things an update carries that are easy to forget it carries:

- **`EXPO_PUBLIC_*` values are inlined into the bundle**, so an update can fix a
  wrong API address in an already-installed build. Pass `--environment preview`
  so it takes them from EAS rather than from the local `.env`, which holds a LAN
  address a release build cannot use.
- **Nothing native.** New permissions, new Kotlin, a new Expo module: none of it
  travels this way, and an update that assumes otherwise produces a JavaScript
  error on a phone rather than a build failure on a machine.

### Device verification (each is a separate pass/fail, do not collapse)
- [x] **Makes a sound** (verified on LineageOS, system alarm tone via the picker)
- [x] **Ring screen appears over the lock screen** (needs `USE_FULL_SCREEN_INTENT`
      granted by hand on a sideloaded build; the harness shows its state)
- [x] **Rings with the app backgrounded** (heads-up notification, Dismiss works from it)
- [ ] Dismiss returns to the lock screen rather than the app home screen
- [x] Rings with the screen locked (app alive)
- [x] **Rings after force-quit from recents** (preview build, LineageOS). The
      ring screen appears over the lock screen and the alarm sounds. This is the
      test the JS design failed and the native rewrite exists for.
- [x] **Rings after a device reboot**, when the phone is unlocked before the
      alarm is due. Sound plays, the notification opens the app.
- [x] **Notification Dismiss works with the app killed**, both from the lock
      screen and the home screen. It broadcasts straight to the native receiver,
      so no JS is involved.
- [x] **Dismiss leaves the ring screen** and hands back the lock screen
- [x] **A missed alarm is recorded and surfaced**, both as a notification and in
      the app
- [x] **The missed notification arrives at boot with the app never opened.**
      Confirmed 2026-08-09.

### `BOOT_COMPLETED` arrives 100 to 175 seconds after boot

Measured on device across two restarts: 100s and 174s. Not immediate, and not
tied to app launch.

That delay caused a wrong diagnosis earlier. Opening the app within the first
couple of minutes lets the app-start re-arm run first, which looks exactly like
"the boot receiver never fires". Two separate mistakes fed it: the readout
initially lumped `MY_PACKAGE_REPLACED` in with `BOOT_COMPLETED` under one "boot"
label, so installing a build was indistinguishable from restarting the phone; and
it recorded when the receiver ran without recording when the device booted, which
made the timestamp uninterpretable.

Both fixed. The diagnostic now records the real intent action and stamps each
boot re-arm with the boot it belonged to, so a stale timestamp cannot be read as
a current one.

**Product consequence:** an alarm due within roughly three minutes of a restart
completing may be missed, because nothing re-arms it until the broadcast lands.
Irrelevant for a phone that reboots overnight ahead of an 06:53 alarm, and the
missed notice covers it honestly when it does happen. Worth remembering rather
than fixing.

- [x] **Two alarms armed at once.** Confirmed working, which is what the
      `PendingIntent` identity keyed on alarm id was for.

### Not yet exercised at all
- An alarm surviving an app update rather than a reboot (`MY_PACKAGE_REPLACED`)
- Snooze end to end (disabled behind `SNOOZE_ENABLED`)
- Anything on iOS

### Deliberate behaviour: an alarm that expires while the phone is off does not fire

Observed and expected. `AlarmStore.pruneExpired` drops alarms whose time has
already passed before the boot receiver re-arms the rest. Firing a 06:53 alarm at
09:40 is not a recovery, it is a second problem.

The consequence is that a phone which reboots overnight and is not unlocked has
no alarm at all that morning. `BOOT_COMPLETED` only arrives after the first
unlock, so nothing can run before then either way.

**Now handled.** `pruneExpired` moves expired alarms onto a missed list instead of
deleting them, and `MissedAlarmNotifier` posts a notification from the boot
receiver. Natively, so it works with no JS running.

The notification matters more than the in-app notice: someone who overslept
because their phone rebooted will look at their phone, not open an alarm app they
have no reason to open. The in-app banner is a backstop for a dismissed
notification, with an acknowledge button that clears the list.

Its wording rides on the stored alarm (`missedTitle`, `missedBody`), resolved
through i18n at schedule time, for the same reason the Dismiss label does: the
boot receiver has no React tree to translate anything. `{time}` is substituted
natively so it honours the device's 12 or 24 hour setting.

Deliberately a **separate, quieter channel** at `IMPORTANCE_DEFAULT`, not the
alarm channel. It does not bypass Do Not Disturb and does not use the alarm
stream. The moment for waking someone has passed; a second klaxon would be worse
than useless.
- [x] **Rings with battery saver enabled**
- [x] **Audible through Focus / Do Not Disturb**

### Keys
- [x] NS `Ns-App` subscription obtained
- [x] TomTom API key obtained
- [x] `apps/api/tools/smokeTransport.ts`: one live call each to NS and TomTom, then a real wake time from the result

```
Arrive by Wednesday 12 Aug 08:30 (Europe/Amsterdam)
  WALK   07:42 Origin -> Utrecht Centraal
  TRAIN  07:56 Utrecht Centraal -> Amsterdam Zuid
  WALK   08:19 Amsterdam Zuid -> Destination
  wake at 06:58, leave at 07:33, 4m risk buffer, feasible: true
```

---

## M1: static smart alarm

Real alarm driven by the engine. The API turned out to reach further than planned:
the transport providers were built early to de-risk them, so `/plan/preview` runs
against live NS and TomTom rather than a hand-entered duration.

**Backend**

- [x] `packages/core` wake-time engine + vitest table tests (51 tests)
- [x] Anonymous device registration (`POST /api/v1/devices`, expo-secure-store)
- [x] Entities: Device, Place, Routine, RoutineStep, Schedule
- [x] Places CRUD + `GET /places/autosuggest` proxying NS Places
- [x] Routines CRUD, steps replaced as a unit
- [x] Schedules CRUD with cross-resource ownership checks
- [x] `POST /plan/preview` for all three modes (fixed, public transport, car)
- [x] `CarJourneyService` + `TransportProviderFactory`, so the engine reads one shape
- [x] `tools/smokeApi.ts`: 16 live checks against real NS and TomTom, including the refusals
- [x] 53 integration tests over the real app, database and middleware (`npm test -w @alarm/api`)
- [x] `.env.dist` for envsubst-based deployment
- [x] Postman collections in `docs/postman/`, split app-facing and backend-only

**App**

- [x] Settings screen: three opt-in disruption settings, filtered by travel mode, diagnostics behind the version
- [x] Reach the API from a physical device (base URL resolution, cleartext on preview builds)
- [x] Typed API client over the M1 endpoints, device registered on first launch
- [x] Onboarding flow (places, routine, schedule, train choice, adjustments)
- [x] Routine editor
- [x] Schedule screen: arrival time, days of week, fixed travel duration
- [x] Engine result drives a real scheduled alarm
- [ ] Offline mirror (expo-sqlite + drizzle)
- [ ] Language selector in settings (see PLAN.md). The storage key and the language
      list already exist; what is missing is the row that writes them

The offline mirror is the only M1 item left, and it is deliberately last. Its
point is recomputing the anchor with no connectivity, which only matters once the
monitor is moving times around; today the device arms from a single API call and
says plainly that it does not update while you sleep.

Push token registration landed with the first M2 chunk: the app requests
notification permission, fetches an Expo token and sends it, only when it has
changed. Every failure is a named reason shown in the debug panel rather than an
exception, because a device without a token still wakes on its anchor.
- [x] Move the M0 harness off the home screen into a hidden debug panel


## M2: NS live

Where the product actually becomes itself.

- [ ] `TransportProvider` interface + `FixtureProvider`
- [x] `NsModule`: `/api/v3/trips` station to station, `searchForArrival`, `addChangeTime`
- [x] `JourneyPlannerService`: door-to-door composed from NS rail + TomTom walking legs, since the `Ns-App` key refuses coordinate planning (`API_KEY_NOT_ALLOWED_TO_PLAN_DOOR_TO_DOOR`)
- [x] `ctxRecon` refresh path (walks re-attached from the stored journey, so a refresh stays one NS call)
- [x] Places autosuggest proxy for address entry
- [x] `ScheduleOccurrence` + `AlarmEvent` entities, with the unique (schedule, date) key and the (state, next_check_at) index the loop claims on
- [x] Monitor loop: minute tick, `nextCheckAt`, `FOR UPDATE SKIP LOCKED` with a five minute lease
- [x] Cadence ladder (30m / 10m / 3m bands), verified against the live database: five armed occurrences claimed, refreshed and pushed out 30 minutes in 1.1s
- [x] The tick is a route driven by the VPS scheduler, not a timer inside the process (see below)
- [x] Global disruption sweep promoting affected occurrences, one NS call per tick for everyone
- [x] Anchor vs live split, with the monotonic-later rule now where it belongs: on the device, applied to what the OS actually holds
- [~] High-priority push → device reschedules. Written and wired both ends; unverified on a phone, see below
- [x] NS call-count instrumentation and loud 429 logging. Every tick reports what
      it spent and what the process has spent in the last five minutes, and a
      warning fires at two thirds of the budget rather than waiting for the
      refusal. Measured: a sweep-only tick costs 1 NS call, a re-check 1, and a
      cancellation re-plan 4 NS plus 2 TomTom
- [x] Audited the call sites afterwards. One saving: the sweep now asks the
      database whether anything is armed before asking NS anything, which stops
      roughly a thousand requests a day during the hours no alarm exists. The
      rest were already minimal, and PLAN.md records why so it is not
      re-litigated monthly
- [ ] The "you can sleep 12 minutes longer" moment works end to end

### What the M2 tests assert, and what they deliberately do not

31 new assertions, chosen by one question: what breaks without anything failing?

- **The sweep's suppression rule** (`releaseTime` vs `lastCheckedAt`). Losing it
  breaks nothing visible: alarms still move, nothing errors. The only symptom is
  the per-night call count going from about 35 to 360 and a 429 in the middle of
  someone's night. Mutation checked: removing the comparison fails the test.
- **Push bookkeeping.** A failed send must write nothing, so it is
  indistinguishable from one that never happened and the next tick retries it. A
  successful one must record what it sent, so the same time is not sent twice.
  This branch is unreachable in development, where no device has a push token,
  so a test is the only thing that has ever exercised it.
- **Two workers, one database.** Four due occurrences, two concurrent claims,
  and every id claimed exactly once. This is the property that makes running a
  second API instance safe rather than merely tempting.
- **The monotonic rule, both halves**, in `packages/core` beside the cadence
  tests: whether the server should send, and whether the device should apply.
  Including the case that only appears in production, a retried push arriving
  after the device has already moved on.

Two things moved to make that possible, and both are better for it. The rule now
lives in `@alarm/core` as `shouldSendWakePush` and `resolvePushedWake`, so the
server and the app cannot drift apart; a disagreement between two copies would
have surfaced as somebody waking at the wrong time rather than as a failing
build. And delivery moved out of `MonitorService` into `PushDeliveryService`,
which takes its `PushService` through the constructor, so the bookkeeping can be
asserted without a live Expo call.

**Not tested, and said plainly rather than implied:** the payload reader in
`apps/mobile/src/push/wakeChangePush.ts`. `apps/mobile` has no test runner at
all, and adding one for a single function is not worth it yet. The decision it
feeds is tested in core; the parsing itself is verified the only way that
actually counts, by a push arriving on a real phone.

### The disruption sweep closes the gap the cadence leaves

The ladder is slow far from the alarm on purpose: an occurrence six hours out is
checked every thirty minutes. That leaves a real gap, a cancellation announced at
04:10 for an alarm checked at 04:00 and 04:30, and it is exactly the case the
product exists for.

One NS call per tick closes it for everybody at once: a flat 1440 a day whether
there is one occurrence or ten thousand. Anything touching a station an armed
occurrence travels through is pulled forward to be checked immediately, so a
cancellation is noticed within about a minute even in the widest band.

The part worth remembering is when it stops. A six hour disruption would
otherwise promote the same occurrence every minute, turning 35 calls a night into
360 for one alarm. Promotion is therefore tied to the disruption's own
`releaseTime`: an occurrence is promoted only if it has not been checked since
that disruption was last published. An announcement costs one extra check, an
update to it costs one more, and a disruption that merely continues costs
nothing.

Verified against the live feed, which had 14 active disruptions at the time: an
occurrence travelling Oss to Tilburg was left alone, the same occurrence pointed
at a disrupted Utrecht station was promoted and its `nextCheckAt` pulled to now,
and the third pass left it alone once it had been checked since publication.

### The push path, and what is not yet proven about it

The monitor sends a **data-only** push the moment a wake time moves: no title, no
body, so nothing is displayed. A visible notification at 03:00 would wake the
person it is trying to let sleep longer. Expo's TTL is set to the wake time
itself, so a message that arrives after the alarm has already rung is dropped by
the delivery service rather than by the app.

The device applies it under the rule that keeps this safe: **later is applied,
earlier is refused unless the server marked it an emergency.** The comparison is
against what this phone actually holds, recorded after the OS confirms the alarm
rather than when it was asked, since a device that missed a message would
otherwise judge the next one against a time nothing is holding.

Delivery is best effort and nothing pretends otherwise. `pushedWakeAt` is written
only on a successful send, so a failed push is indistinguishable from one that
never happened and the next tick retries it; a push not acknowledged within ten
minutes is assumed lost and sent again. There is no queue and no delivery
receipt, because the phone is already holding an OS alarm at the anchor time and
the worst case is waking early.

**Verified so far:** Expo rejects a dead token with `DeviceNotRegistered` and the
row's push token is cleared, so a stale token stops costing a request per tick; a
device with no token is a recorded outcome rather than an exception; the retry
window suppresses a second push of the same time.

**Registration works, confirmed 2026-08-17 from the `devices` table.** Two
Android rows carry an `ExponentPushToken`, the older since 2026-08-13, both on
`0.1.0` and both seen the same afternoon. This paragraph previously said no
device had ever registered one, which was true when it was written and had
quietly stopped being true; a claim about production state is only worth what its
date is worth. The server therefore has somewhere to push, and the last unproven
step is delivery rather than registration.

**Not verified, and it needs the phone:**

- No push has been seen to arrive and move an alarm on a locked device. That is
  now testable with what is already installed: stage a simulation from the debug
  panel, run a tick, and watch the time change without touching the phone.
- The same phone appears twice, because clearing the app's data registers a new
  device rather than reclaiming the old one. The older row still holds a token
  and still owns its schedules, so its occurrences are still monitored and still
  pushed to. Expo answers `DeviceNotRegistered` for a token that install no
  longer holds and the row is cleared, which is the designed outcome, but a
  tidier answer is worth having before anyone else installs this.
- `expo-task-manager` was added for background delivery, which **desynchronises
  every installed build until it is rebuilt**. The harness banner names it.
- The exact shape Android hands the background task is documented loosely, so
  the payload reader tries the known shapes and validates the result rather than
  assuming one. The debug panel keeps the last ten handled pushes, because a
  background task's console output is visible to nobody.

Until a push is seen to move an alarm on a locked phone, the home screen keeps
saying the alarm does not update while you sleep. That copy changes when the
device proves it, not when the code is written.

### The tick runs from outside the process

`POST /api/v1/monitor/tick`, called every minute by the VPS's Ofelia scheduler,
which reads the job from labels on this app's own compose file. That is the
server's convention: app jobs deploy through the app's CI, never as host cron.
PLAN.md said `node-cron` in the API process; this replaces that, and no
dependency was added.

`job-exec` rather than a fresh container: the tick needs the database pool and
the NS response caches the running process already holds, and a new process each
minute would reconnect to an external MySQL across the internet to find, most
minutes, that nothing is due.

Three things the loop does that are easy to get wrong:

- **It re-plans rather than adding the delay to the stored time.** A delay that
  breaks a connection changes the whole journey, and arithmetic on the old one
  would not notice.
- **It re-reads the routine.** The stored breakdown would keep waking someone for
  a morning they have since edited.
- **It refuses to move an alarm the device did not ask it to.** All three
  disruption settings are opt in, so a device that never answered keeps its time.
  Moving somebody's alarm because nobody objected is the wrong way round.

Nothing here pushes yet. This pass recomputes and records; delivery is next, and
separating them means a bug in one cannot silently corrupt the other. Until the
push path exists, a moved time is picked up when the app next opens.

## M2.5: the app becomes usable

Decided 2026-08-14 after the first real morning. The alarm rang correctly; the
app around it could not show what was armed, which train it had chosen, or let a
schedule be changed. See the information architecture section in PLAN.md.

- [x] Tab shell: Today, Schedules, Settings
- [x] Schedules tab: list with each schedule's next armed time
- [x] Schedule editor: name, deadline, days and the morning routine, then a
      recalculate that shows the departures those edits produce and lets one be
      chosen before saving. Pause and delete live on the list
- [x] Changing where a schedule travels, its travel mode, and how the station is
      reached at either end
- [x] The editor lives at `/schedules/[id]/overview`, not `/schedule/[id]`. Route
      groups are invisible in URLs, so onboarding's schedule step already owned
      `/schedule`, and expo-router does not strip `/index` from a pushed href.
      Both surfaced only on the device, as an unmatched route. See CONVENTIONS.md
- [x] Arm every active schedule rather than only the first, and cancel OS alarms
      for occurrences that no longer exist
- [x] `GET /api/v1/occurrences` for this device's armed occurrences
- [x] Journey detail: leg-by-leg timeline with platforms and delays, the buffer
      breakdown that answers "why this time", and the `alarm_events` trail, which
      had existed in the database since M2 and had never been shown to anyone.
      Today is a summary again: wake time, leave-home time, which train, and a
      way in
- [x] Tapping a train leg lists the stations it calls at, the way the NS app
      does. `JourneyLeg.stops` is new: NS returns them per leg and nothing was
      reading them. Stations the train only passes through are dropped at the
      mapping layer, because a list naming a stop the train runs past is worse
      than a short one. About 1.8 KB per stored journey, measured
- [x] Simulated delay and cancellation, so the interesting path can be tested on
      demand rather than twice a month. `POST /occurrences/:id/simulate`, device
      authenticated and limited to that device's own morning, staged for the next
      check and consumed by it, expiring after an hour. Only the timetable is
      invented: the engine, the opt-in settings, the push and the phone's
      monotonic rule are all the real ones. Proved end to end against a live
      occurrence, which moved 07:10 to 07:30 and recorded
      `SIMULATED: A service is delayed, so the alarm moved to 07:30.`
- [~] Show disruption on screen. Done: the journey screen strikes the planned
      time through and prints the delayed one in red, a cancelled leg carries a
      pill, and the cancelled train is listed above the one that replaced it
      (`replacedJourney`, new column). The ring screen names the delay or
      cancellation whatever the disruption settings say, since those decide
      whether the alarm may move and were never meant to decide whether somebody
      is told their train is gone
- [x] The server pushes a disruption notice even when the alarm does not move,
      so the phone holds the news before the alarm rings rather than needing a
      request at 06:00. Deduplicated by state (`DELAY:12`, `CANCELLATION`), so a
      delay that persists is silent and one that grows pushes again
- [x] Cancellations re-plan. The monitor never did: a trip that could not be
      reconstructed produced a wake time computed from no journey at all, which
      is why a simulated cancellation showed a vanished train and no replacement
- [x] The emergency-earlier path, which PLAN.md has described since day one and
      nothing implemented. A cancellation that forces an earlier start now moves
      the alarm regardless of the opt-in switches, since not moving is a
      guaranteed failure rather than a risk
- [x] Which replacement is acceptable: a direction and a travel window per
      schedule, set on the travel screen. The rule lives in `@alarm/core` with
      eight tests, and the replacement path now asks the planner for late
      arrivals too, since a list that by construction contains only on-time
      departures can never satisfy "I would rather take a later train". Proven
      against live NS: preferring later moved 08:10 to 08:24, preferring earlier
      moved 08:24 to 08:10, and a 09:30 window left the alarm alone
- [x] Today says what happened: the delay or cancellation, the minutes gained
      rather than only a new time, and, when nothing moved, whether that was a
      switch being off or the journey's own spare time absorbing it. Measured
      against the anchor, which is the time the morning was armed with and never
      moves, so it is the honest baseline for "compared to what you expected"
- [x] Reachable from the debug panel, which is how it is meant to be used on a
      phone: it targets the soonest armed morning, shows what is staged, and says
      that the next check applies it

## M3: car

- [x] `TomTomProvider`: `arriveAt`, through `CarJourneyService`, which expresses
      a drive as a one-leg `Journey` so the engine cannot tell the modes apart
- [x] Predictive → live traffic switch inside the departure window. TomTom
      answers any *future* departure with historic and predictive data, and live
      conditions only for a departure of now, so an alarm armed at 22:00 is
      running on what that road usually does and would never learn about the
      lorry that jackknifed at 06:20. The forecast is planned first, because it
      is the only way to learn when departure actually is; if that lands inside
      the window the route is asked again as a departure of now and the live
      duration wins. Two TomTom calls, only ever in the last hour before leaving
- [x] The live request is deliberately sent with **no** `departAt` at all. A
      literal timestamp of now is a future departure to TomTom and silently
      falls back to predictive data, which would look identical in the response
      and be wrong in exactly the case the switch exists for
- [x] Departure stays where the plan put it and only the duration is taken from
      the live answer. Adopting the live route's own departure would move the
      whole morning by however long the request happened to take
- [x] A failed or empty live request keeps the forecast. Worse than live
      conditions, far better than nothing, and it keeps the alarm working through
      a TomTom outage
- [x] Continuous risk buffer, `max(5m, 0.15 x travelTime)`, relaxed by a quarter
      once inside the same window. The engine and the provider now agree about
      when the estimate stops being a forecast, which they have to: relaxing the
      padding while still planning on historic data would be the one combination
      that loses a morning
- [x] Nine tests, with TomTom stubbed, since "an hour before departure" and "a
      provider outage" cannot be arranged on demand against a live API

### Two things a cleared cache found

Both fixed 2026-08-17, both invisible with an app that had already registered.

- **Onboarding never appeared on a fresh install.** Screens fetch on mount and
  registration was racing them, so the first requests went out unauthenticated
  and Today showed a 401 banner where the setup prompt belongs. Registration
  moved into the request layer, so the launch order stops mattering. See
  CONVENTIONS.md.
- **Settings was a heading with nothing under it.** The disruption switches are
  chosen by how the user's schedules travel, and a device with no schedules has
  none to show. It now says so.

### Deleting a device used to be impossible

2026-08-17. A device owns its places, routines and schedules, and all three
cascade from `devices`, but `schedules` pointed at places and routines with
`RESTRICT`. So deleting a device asked MySQL to remove a place while a schedule
still referenced it, and the statement failed:

```
Cannot delete or update a parent row: a foreign key constraint fails
(`schedules`, CONSTRAINT `schedules_destination_place_id_foreign`)
```

No order of operations fixes that, since MySQL does not promise to cascade the
schedules before it tries the places. The three keys are `CASCADE` now.

**The guard moved rather than disappeared.** `RESTRICT` was there so that
deleting a place a schedule still needs would fail loudly instead of silently
breaking tomorrow's alarm. `PlaceService.remove` already refused first and
returned the names of the schedules in the way, which is a sentence rather than a
driver error, and that check is now the only guard. It has to stay.

Verified against a real MySQL, not just read off the migration: the constraints
report `CASCADE` on all ten foreign keys, and deleting the busiest device removes
its 2 places, 1 routine, 1 step, 1 schedule and 1 occurrence in one statement.
`tools/fkcheck.ts` runs that inside a transaction it always rolls back, so the
check can be repeated without destroying anything.

### A third, from the first preview build on a phone

2026-08-17. The app showed "could not reach the server" against an API that was
demonstrably up: healthy from three networks, valid certificate, correct address
in the build's own diagnostics. Clearing the app's data fixed it, and the cause
was never proven. What the hunt did prove is that the app cannot report this
class of failure honestly, which is why it took a morning:

- **Every unrecognised error was reported as a network failure.** The fallback in
  `ApiRequestError.from` turned anything that was not an `AxiosError` into
  `NETWORK_UNREACHABLE`, so a bug inside the app told the user to check their
  wifi and sent the search to the router, the DNS and the certificate chain.
  Unclassified failures now say they are unclassified.
- **Nothing ever recovered from a rejected token.** `clearToken()` existed with
  no callers, and the copy on screen said "it will register again" while nothing
  did. A phone that ran a development build against the laptop keeps that token
  when a preview build replaces it, since the package id is the same and secure
  storage survives the install, and the production API has never heard of it. The
  only cure was clearing app data by hand. A 401 now discards that token,
  registers again and retries once, comparing before it clears so a burst of
  simultaneous 401s cannot each delete the replacement the last one just wrote.

### The ring screen keeps a note per morning, not one note

Checked on 2026-08-17, because "does the alarm actually say the train is
cancelled" is the question the whole disruption path exists to answer.

It does, and it does not need the network to: the note is written by all three
things that learn anything, the overnight push, the Today screen and the ring
screen itself, and read from the device before any request is made. It is shown
whatever the disruption settings say, since those decide whether the alarm may
move and were never meant to decide whether somebody is told.

The check found one real hole. The note was a **single** stored entry, and every
active schedule arms an occurrence of its own, so two armed mornings shared one
slot. A cancellation pushed for Thursday was erased the moment Today refreshed
and found Wednesday running normally, because clearing was unconditional and
keyed on nothing. Thursday's alarm then rang with an empty screen, which is the
exact failure the note exists to prevent. It is now a map keyed by occurrence,
capped at five, and clearing one morning cannot touch another. The old shape is
still read, so a phone that updates overnight keeps the note it already had.

**Still true until a push token registers:** with no push, the only writers left
are the app being opened and the ring screen's own request at 06:00. A
cancellation that happens after the last time the app was opened is therefore
only shown if the network answers while the alarm is ringing.

### Three things simulating a disruption on a phone found

- **Arming pushed a staged simulation out of reach.** Staging makes an occurrence
  due now; arming recomputes the cadence, which for a morning still beyond the
  eight hour window means "look again in seven hours". Arming now leaves a staged
  simulation due immediately.
- **An occurrence checked too early was never checked again.** The monitor had
  its own copy of the next-check calculation without the arming-window fallback,
  so anything examined more than eight hours out was stored with no next check at
  all. One calculation now, in `OccurrenceService`.
- **Arming erased an applied simulation seconds after the tick produced it**, by
  re-planning against live data where nothing is actually delayed. A simulation
  now stays on the row until it expires, marked applied rather than deleted, and
  arming leaves the plan alone while it is in force.

Plus a timezone bug behind all of it: `created_at` defaulted to the database
server's `CURRENT_TIMESTAMP`, which is local, while everything else is UTC. See
CONVENTIONS.md.

## Agreed, not yet scheduled

Both decided 2026-08-16, both written up in PLAN.md.

- [x] Cache every API read so the app stays readable when the backend does not
      answer, with cached answers labelled and dated. Lives inside `Axios.get`,
      the single place every read passes through, so no screen changed and none
      can forget it. Served only for a genuine outage: a 404, a 401 and a 400 are
      answers rather than failures and are never papered over, and a rejected
      token empties the cache because every body in it belonged to the device
      that was just refused. Writes are refused rather than queued, with their
      own `OFFLINE_WRITE` code and sentence, since a queued edit to an alarm
      lands while its owner is asleep
- [x] `useApiQuery` puts the cached copy on screen first and corrects it when the
      server answers, rather than waiting. Schedules uses it, which also stopped
      the list blanking every time somebody returns from the editor
- [x] Today too, under the rule that separates it from every other screen:
      **render the cached morning, act only on live data.** `useNextAlarm` does
      not just read, it arms alarms and cancels orphans, and doing that from a
      stored list would re-arm a schedule deleted since or cancel an alarm the OS
      rightly holds because yesterday's list did not mention it. So the read that
      feeds arming passes `{ live: true }` and fails rather than falling back,
      while the preview comes from a direct peek and touches nothing. Whether it
      is armed is read from the OS, a local question with a local answer, so a
      cached morning does not claim to be unarmed
- [x] Forty mobile tests now: the cache, the disruption note, the time helpers
      and the error mapping. Writing them found a real bug on the first run.
      Delay minutes were **rounded**, so a 31 second wobble read as "1 minute
      late" and, at 05:00, was a push that woke a radio to report nothing. The
      app and the server shared the logic exactly, which is the property that
      matters, so both floor now and both still agree
- [x] `apps/mobile` has tests. Ten of them, on the cache, and they exist because
      that feature produced three bugs in an afternoon that both the type checker
      and the linter passed. Mutation tested: making `peekCache` mark the app
      stale, and making a rewritten key keep its old position in the eviction
      queue, each fails exactly the test written for it
- [ ] The M1 offline mirror still wants doing, and should reuse this store rather
      than start a second one. What is missing is recomputing a wake time on the
      device from cached schedules and routines, which is what would let the app
      arm a morning with no backend at all
- [ ] Alarm sound in settings: the system ringtone picker (already built, but
      only reachable from the debug panel) plus a file the user owns, copied into
      app storage rather than referenced, because a document picker's URI does
      not survive a reboot and the alarm is played hours later by a native
      service. See PLAN.md
- [x] Theme choice in settings: system, light or dark, with system staying the
      default. The context stores the preference rather than the resolved colour,
      because resolving `system` at the moment it is picked would freeze the app
      at whatever the phone was doing that evening. Applied before the first
      paint by holding the native splash until the stored value is read, so a
      light-phone user who chose dark no longer gets a white flash on every
      launch. The ring screen deliberately does not follow it: it is pinned dark
      with every text colour stated, which is the right answer for 06:00
- [x] A third palette: NS house style. Yellow fills the tab bar, the headers,
      the selected rows and the input surfaces, and never draws text: it is 1.5:1
      as a foreground on white and 7.8:1 as a surface under NS blue. The first
      attempt used it only as a pale tint behind a chosen row and the result
      looked plain blue, which is the lesson: a house style lives on the large
      surfaces. Contrast was measured rather than eyeballed, and caught two
      failures that looked fine, the shared amber at 2.69:1 and the shared red at
      4.23:1 on this palette's warm banner surface; both are darker here and
      every pair now passes AA. Adding it turned the theme types into keys of the `Colors`
      map, so a fourth is an entry there plus a label, and React Navigation's own
      theme is now derived rather than picked from its two stock ones. `danger`
      and `warning` keep their meanings in every palette
- [x] **Ask for the alarm's permissions outside the debug panel.** Was the
      largest hole in the app: `requestPermissions()` was called from exactly one
      place, behind ten taps on the version and a password, so a normal install
      could arm a morning the OS would never ring while the home screen told its
      owner to "check permissions in the debug panel". Now a final onboarding
      step, after the schedule is saved, which is the moment the request explains
      itself. `useAlarmPermissions` re-reads on every foreground, because two of
      the four are granted on a system screen that returns no result and all four
      can be revoked at any time. A refusal is a permanent honest banner on
      Today with the fix attached, never a nag, and required (notifications,
      exact alarms) is kept separate from recommended (full-screen intent,
      battery), since one means the alarm is broken and the other means it is
      imperfect. No native code: every call already existed
- [ ] Optional lock on stopping the alarm: arithmetic, or a typed word or PIN,
      opt in and off by default. The hard part is the constraint list, not the
      puzzle: stopping must always be possible through a ten second hold, the
      lock guards dismiss rather than silence, and it must survive the ring
      screen failing to render

## M4: iOS

- [ ] AlarmKit module wired behind `AlarmScheduler`
- [ ] EAS iOS build + TestFlight
- [!] Device verification blocked: no iOS 26 device

---

## Decisions log

Reversals and corrections worth remembering. Rationale lives in PLAN.md.

| Date | Decision |
|---|---|
| 2026-08-13 | **The traveller picks the train, and what is stored is a position rather than a departure.** The engine takes the latest journey that still arrives on time, which buys the most sleep and is the wrong answer for anyone who wants a seat, the direct train, or some margin. `journeyOffset` counts back from the latest on-time option and is re-applied to whatever NS offers each morning, so a cancellation moves the choice along the list instead of invalidating it. Pinning a departure could not work: the alarm recurs, and an NS `ctxRecon` identifies one trip on one day rather than a standing preference. A morning with fewer options clamps to the earliest rather than refusing to plan, because leaving someone without an alarm over a comfort setting is the worse failure. |
| 2026-08-13 | **`POST /plan/options` returns a whole `WakePlan` per option, not a list of departures.** The number being chosen between is the wake-up time, and that only exists once the routine and the buffers have been applied; returning departures would make the app redo the engine's arithmetic. One provider call serves all three, so the options cost the same NS budget as a single preview. |
| 2026-08-13 | **How you reach the station is asked, per end.** Both access legs were computed as walking, silently, which is wrong for the usual Dutch commute: a bike at the home end and a walk at the other. Measured on a real Oss to Tilburg route, cycling to the local station moved the wake time from 06:58 to 07:07 for the same train, and a longer access leg moves it considerably more. Two columns rather than one, because the two ends genuinely differ and the bike is almost always at the home end only. `AccessMode` deliberately offers only WALK and BIKE: driving to a station is a real habit, but the parking time and the walk from the car park are unmodelled, so a car access leg would be optimistic in exactly the direction that makes someone miss a train. |
| 2026-08-13 | **Transport mode is asked rather than assumed.** The onboarding draft hardcoded `PUBLIC_TRANSPORT` and never showed the question, while the engine and both providers had supported car all along. The gap was in the app, not the model. |
| 2026-08-13 | **The app infers the API address from the Metro host, and refuses to guess otherwise.** The old default, `10.0.2.2:3000`, is the Android *emulator's* alias for the host machine and means nothing on a real phone. `Constants.expoConfig.hostUri` is the machine serving Metro, which during development is the machine running the API, so a development build works on a real device with nothing configured. Outside a dev build there is no Metro host, and `config.apiUrl` is null rather than `localhost`, which on a phone means the phone: every request would fail as a network error pointing at the wifi instead of at the missing configuration. The inferred port can still be wrong, because the API moves off 3000 when it is taken. |
| 2026-08-13 | **Cleartext HTTP is permitted only while `EXPO_PUBLIC_API_URL` is `http://`.** Development builds already allowed it through the debug manifest Expo generates, which never reaches a release build, so the gap was preview builds, which is where this project verifies anything that matters. `withCleartextDevApi` keys the manifest flag to the configured URL, so the permission exists exactly while it is needed and disappears when the API becomes HTTPS, with nobody having to remember to remove it. |
| 2026-08-13 | **Every API failure is one `ApiRequestError` with a `code`.** The UI branches on the code and translates it; the server's `message` is English, written for a log, and never reaches a screen. Two client-side codes join the server's: `API_URL_MISSING` and `NETWORK_UNREACHABLE`, so a screen reads one set of codes rather than a mix of codes and exception types. |
| 2026-08-13 | **Registration is allowed to fail without blocking the app.** The alarm that matters most is the one already armed on the device, which needs no network, so an unreachable API must never stop the app opening. `useApiConnection` reports the state and offers a retry, because the usual causes (API not running, wrong network, wrong address) are fixable while looking at the screen. |
| 2026-08-13 | **No response envelope.** A success is the resource itself, a failure is a flat `{ code, message, details }`. The status code already said whether it worked, so `{ success, data }` restated it and made every caller unwrap a level. Changed while nothing consumed it yet. The trade, taken deliberately: a bare array has nowhere to put pagination later, which is fine because every list is one device's own places, routines or schedules. A collection that could grow unbounded should get an object with its own `items` field rather than quietly becoming an envelope again. |
| 2026-08-13 | **A shared lint base, not a shared config.** `eslint.config.base.mjs` holds the rules that are as true on the server as in the app (`no-floating-promises`, `no-misused-promises`, `await-thenable`, no `any`). Platform rules stay in `apps/mobile`, where `eslint-config-expo` and the native-module `no-restricted-imports` rule belong. Type-aware rules are on: they are slower, and they are the only ones that catch a promise nobody awaited. Turning it on found 11 real problems in the API and 2 in `packages/core`, including a `default:` branch the compiler had narrowed to `never` while it stayed reachable from the command line. |
| 2026-08-13 | **`alarm/no-dashes` enforces the no-em-dash rule.** It scans raw source rather than the AST, because the dashes kept appearing in comments, which a node visitor would not see. Not auto-fixable on purpose: a dash separating a label from its description wants a colon and one joining two clauses wants a comma, so the substitution depends on the sentence. It found three violations in files nobody had thought to grep. |
| 2026-08-13 | **`packages/core` gained `tsconfig.check.json`.** Its build config excludes `*.test.ts` so tests stay out of `dist`, which also put them outside any program, so 51 tests were neither type-checked nor lintable. The build config is untouched; the new one covers everything and is what `type-check` and eslint use. |
| 2026-08-13 | **The dev server moves to the next free port, loudly. Production refuses to.** Another project holding port 3000 is routine on a development machine, and the useful response is to keep going and say twice which port was actually used, since the app and the Postman collections point at the configured one. In production the port is what a reverse proxy forwards to, so moving would leave the deployment running and unreachable, which looks like a healthy service and is not one. Bounded to ten ports: a machine with ten consecutive ports in use has a different problem, and scanning until something answers eventually lands on a port that means something else. |
| 2026-08-13 | **Refusals are returned, not thrown.** `ApiError` is gone. Middleware writes its own 401 and 422, services return outcomes (`Place \| null`, the names of the schedules blocking a delete, a `ScheduleProblem` union) and controllers render them. An exception now means the code is wrong, so `errorHandler` only ever produces a 500 or the upstream 429. The one deliberate exception is `NsRateLimitError`, thrown three layers down in an HTTP module, where threading a result type up through the service and controller would cost more than it explains. |
| 2026-08-13 | **No wrapper around route handlers.** Verified rather than assumed: Express 5 forwards a rejected promise from an async handler to the error middleware on its own. With `deviceAuth` guaranteeing `req.device` and `validate` guaranteeing the body, the base `Controller` had nothing left to do and was deleted. `req.device` is declared non-optional on `Express.Request`, which is a small lie for the one route without the middleware and is what removes a narrowing wrapper from every handler. |
| 2026-08-13 | **`sendSuccess<T>` cannot infer its type argument.** `sendSuccess(res, x)` with an inferred `T` can never fail, because the argument is what defines the expectation. `NoInfer<T>` plus a `never` default makes the type argument compulsory, so every endpoint names a response type declared in `@alarm/types` and the mapper's output has to satisfy it. Proven with a probe file: an unnamed type and a wrong shape both fail to compile. |
| 2026-08-13 | **Validation is route middleware, and checks every part before answering.** `validate({ params, body, query })` reports all issues at once with each path prefixed by its source. Stopping at the first failing part would report a bad id, then on the retry a bad body. Query and params go to `req.validatedQuery` / `req.validatedParams`: Express 5 made `req.query` a getter with no setter, and the router rewrites `req.params` per layer, so neither survives being written back. |
| 2026-08-13 | **The test suite refuses to run against a database whose name does not end in `_test`, or without `.env.test` present.** Both, because either alone is easy to satisfy by accident: without that file dotenv falls back to whatever `DB_*` happens to be set, which on a developer machine is the development database, and the suite truncates every table it can see before each test. Verified by pointing it at `dynamic_alarm_db` and watching it refuse. |
| 2026-08-13 | **Tests never call NS or TomTom.** The provider factory is spied and answers with `FixtureTransportProvider`. A suite that depends on a live timetable fails when a train is late, which is neither true nor fixable, and it spends a 300-per-5-minutes budget shared by the whole deployment. |
| 2026-08-11 | **Another device's resource answers 404, not 403.** The device id is part of the lookup rather than checked after it. A found-then-compare would answer 403 for a real id and 404 for an invented one, which tells anyone holding a token exactly which place ids exist. Both are indistinguishable now, because to that device they genuinely are. |
| 2026-08-11 | **Cross-resource ownership is checked on every schedule write.** A schedule names a place and a routine by id, and the foreign keys accept any valid id, so without an explicit check a device could point a schedule at another device's place and read back where that person lives through `/plan/preview`. That is the most sensitive data the app holds, and it is the only place in the API where the check is load-bearing rather than tidy. |
| 2026-08-11 | **NS Places autosuggest needs an explicit `type` filter.** The default response contains addresses only, so a user typing "Utrecht Centraal" is offered four streets and no station. Now requests `stationV2,address,poi`. |
| 2026-08-11 | **Autosuggest enforces a three-character minimum server-side.** It proxies an NS endpoint drawing on the same 300 requests per 5 minutes as journey planning, and it is the one route a user can fire per keystroke. Client debouncing is still needed, but the ceiling cannot depend on the client behaving. |
| 2026-08-11 | **Routine steps are replaced wholesale, and position in the array is the order.** The editor renames, reorders and deletes together, so reconstructing which happened from a set of ids is guesswork that gets the order wrong. `order` was removed from the create DTO: two sources for one fact means something has to break the tie when they disagree, and the user reads that as the app losing their arrangement. |
| 2026-08-11 | **The nearest station is not the nearest *useful* station.** For a home address near the Spoorwegmuseum, NS `/stations/nearest` returned Utrecht Maliebaan (755m, `heeftVertrektijden: false`), a museum halt with no scheduled service. `searchForArrival` then answered with the last train that ever left it, the previous evening, so an 08:30 deadline produced a 16:59 departure that satisfied every check and reported `feasible: true`. Nearest-station lookup now over-fetches and filters on `heeftVertrektijden`. Two days were lost to formats and timezones because the output was internally consistent, which is what made it dangerous. |
| 2026-08-11 | **The planner drops trips departing in the past.** "Arrive by" has no lower bound, so any sparsely served origin can produce a yesterday journey that passes the deadline arithmetic and yields a wake time already gone. The filter is a second line of defence: the station fix removes the known cause, this removes the failure mode. |
| 2026-08-10 | **MySQL 8, not Postgres.** The production hosting only offers MySQL. Caught before M2 was built on it. Three Postgres habits do not survive: no `gen_random_uuid()` default (TypeORM generates UUIDs app-side, since MySQL's `UUID()` is version 1 and leaks a MAC address), no array columns (`days_of_week` is JSON), and no `timestamptz` (every instant is `datetime(3)` in UTC with the connection pinned to UTC, because MySQL `timestamp` silently converts to the session zone and stops in 2038). Decimal columns need a transformer, as the driver returns them as strings and a latitude of `"52.090700"` reaches NS as nonsense. **The M2 monitor design survives:** MySQL 8.0 supports `FOR UPDATE SKIP LOCKED`. |
| 2026-08-10 | Migrations run through `tools/migrate.ts` under `tsx`, not the Knex CLI. The CLI needs a TypeScript loader registered before it can read the knexfile, and without one it fails with a syntax error pointing at the knexfile rather than at the missing loader. |
| 2026-08-10 | Device tokens are hashed with SHA-256, not bcrypt. Slow hashing exists to survive guessing; this is 256 bits of machine randomness, so guessing is not the threat and slowness would tax every authenticated request. Hashing at all is what stops a database dump handing over every device's identity. |
| 2026-08-09 | Alarm only ever moves **later** by default; earlier is best-effort emergency only. |
| 2026-08-09 | NS product is **`Ns-App`** (self-serve), not `Public-Travel-Information`, the deprecation notice there covers only the price API. |
| 2026-08-09 | No 9292 contract needed, NS `/api/v3/trips` already fronts 9292 data for bus/tram/metro. |
| 2026-08-09 | Alarm sound plays from the ring screen, **not** the notification channel, channel sounds are immutable after creation and capped at ~30s. |
| 2026-08-09 | Android uses the user's own system alarm tones via `ACTION_RINGTONE_PICKER`; iOS must bundle audio (no public API). |
| 2026-08-09 | Landed on Expo SDK **57**, not 56, that is what `create-expo-app` ships. notify-kit compat on RN 0.86.2 unverified. |
| 2026-08-09 | Dropped `expo-audio`. It cannot set Android audio usage (the reason `modules/alarm-sound` exists) and it pulled `RECORD_AUDIO` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` into the manifest. A microphone permission on an alarm clock is a Play Store review problem for zero benefit. |
| 2026-08-09 | The alarm notification channel is created **silent**; the ring screen plays audio itself. Channel sound is frozen at creation and capped at ~30s. |
| 2026-08-09 | `AlarmPermissionStatus` deliberately omits full-screen-intent state, Android exposes no way to query it, and a guessed `true` would be a lie. Only device testing can confirm it. |
| 2026-08-09 | Engine feasibility is measured against the real deadline, not the buffered target. Eating into the arrival buffer is *tight*, not *late*, flagging it would be crying wolf. |
| 2026-08-09 | The app must run in Expo Go with alarms disabled. Native modules are loaded optionally and degrade to no-ops behind an honest banner, so UI and engine work never needs a 15-minute native build. See CONVENTIONS.md. |
| 2026-08-09 | **No native module is imported at module scope anywhere.** Three separate M0 crashes (`AlarmSound`, `expo-notifications`, `AsyncStorage`) had the same shape: a throwing import cascades into "Route is missing the required default export" for unrelated screens. All access now goes through `optionalModule.ts` / `Storage.ts`, with the degrade behaviour chosen per concern. Verified: autolinking resolves all 9 RN modules correctly in this monorepo, the failures were stale binaries, not broken linking. |
| 2026-08-09 | Added `nativeDiagnostics.ts` + a "Rebuild required" banner listing missing modules and the exact rebuild command. Adding a native dependency desynchronises every installed dev client, and that needs to be diagnosable in one glance. |
| 2026-08-09 | **Enforced the rule in ESLint** after it recurred a fourth time (`expo-localization`). `no-restricted-imports` now errors on module-scope imports of every import-time-unsafe native module, with a message pointing at CONVENTIONS.md. Documentation alone demonstrably did not hold. |
| 2026-08-09 | **Alarm audio moved off the ring screen and onto the notification event.** Original design was wrong: Android does not launch a full-screen intent while the phone is unlocked, so an alarm firing during use opened no screen and therefore made no sound at all. Playback now hangs off `onBackgroundEvent`/`onForegroundEvent` and rings in every app state; the ring screen is a control surface, not the source. |
| 2026-08-09 | Added a custom `index.js` entry so the notifee background handler registers before the app does, a handler installed in a React effect misses a cold start. Uses `require('expo-router/entry')`, since an ES `import` would be hoisted above the registration and silently defeat it. |
| 2026-08-09 | Added `canUseFullScreenIntent()` / `openFullScreenIntentSettings()` to the native module. Android 14 made `USE_FULL_SCREEN_INTENT` user-revocable and it commonly starts **denied** for non-Play installs, which silently downgrades the alarm to a notification. Now shown in the harness with a button to fix it. |
| 2026-08-09 | **Dismiss hands the phone back the way the alarm found it.** When the alarm took over the lock screen the user never asked to open the app, so landing them on our home screen makes it feel like the app hijacked the phone. The ring route now carries a `takeover` flag; on takeover, dismissing steps off the route and calls a new native `moveAppToBackground()` (`moveTaskToBack`, not `finish()`, so state survives), revealing the lock screen. In-app alarms still just navigate back. |
| 2026-08-09 | Broke a require cycle (`alarmActions -> index -> AndroidAlarmScheduler -> alarmActions`) by moving the action ids into a leaf module, `alarmActionIds.ts`. Metro warns rather than errors on cycles, but whichever module it evaluates first sees the other half as `undefined`, which here meant notification actions could be built with an undefined press-action id. |
| 2026-08-09 | **Ring routing also re-checks on app resume.** The mount effect runs once; if the app was merely backgrounded when the alarm fired, no remount happens and `onForegroundEvent` does not fire for a background delivery, so nothing routed and the user unlocked to the home screen. An `AppState` listener plus a routed-alarm ref (to avoid stacking ring screens) closes it. |
| 2026-08-09 | Snooze put behind `APP_CONSTANTS.ALARM.SNOOZE_ENABLED`, defaulted **off**, gated inside `snoozeAlarm()` rather than only in the UI so a notification scheduled before the flip cannot resurrect it. |
| 2026-08-09 | **Ring screen now opens from "is an alarm notification displayed?", not `getInitialNotification()`.** A full-screen intent starts MainActivity directly, so the initial-notification API returns nothing, the user landed on the home screen with the alarm blaring and no way to stop it. Gated on `useRootNavigationState()` so the cold-start navigation is not dropped before the navigator mounts. |
| 2026-08-09 | Added **Dismiss** and **Snooze** actions to the notification, handled in both foreground and background handlers with no `launchActivity`, silencing an alarm should not require opening the app. Same buttons on the ring screen. Snooze reuses the alarm id so it replaces rather than stacks. |
| 2026-08-09 | **All copy moved into i18n; hardcoded fallbacks removed.** i18n now initialises synchronously so `t()` works inside notifee background handlers, which is what made the fallbacks seem necessary. Non-React modules return keys (`reasonKey`, `impactKey`) instead of sentences. |
| 2026-08-09 | **Alarm audio confirmed working on device** (LineageOS, user's own system alarm tone). The screen not appearing was traced to `MainActivity` lacking `showWhenLocked` / `turnScreenOn`, added via a config plugin. |
| 2026-08-09 | Build failure: a valueless `return@AsyncFunction` in the new Kotlin, Expo types those lambdas as `() -> Any?`, so it fails with `expected 'Any?', actual 'Unit'`. Rewritten as `if/else`. Rule written up in CONVENTIONS.md, since nothing local compiles Kotlin and each mistake costs a ~5-minute cloud build. |
| 2026-08-09 | Adopted the house conventions from `espressions_app` / `drinking_games_app`: 4-space Prettier, `Stylesheet.ts` tokens, `ThemeContext` + `useThemeColor`, i18n, `Axios` class. |
| 2026-08-09 | **Reviewed and kept** routes-only in `src/app/` rather than nesting everything under `app/` like the other apps. expo-router's `require.context` turns every file under the app root into a route and eagerly `loadRoute()`s each one in dev, which spams the "missing default export" warning we relied on twice during M0, and re-exposes the eager-import failure mode. Folder names are otherwise identical; route grouping comes via `(group)` dirs in M1. Full reasoning in CONVENTIONS.md. |

## Open questions

- ~~Does the native code compile on RN 0.86.2?~~ **Resolved 2026-08-09**, the EAS
  development build succeeded and ran on device. notify-kit and the Kotlin module are
  both fine on SDK 57; no downgrade needed.
- NS publishes no rate limits. Real ceiling unknown until M2 instrumentation runs.
- `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` / `SYSTEM_ALERT_WINDOW` are still
  in the manifest from a transitive dependency. Harmless for a dev build; trace and
  strip them before any Play Store submission.
- Bundled fallback alarm tone not yet chosen.
