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
permissions before a Play submission.

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

- [ ] Reach the API from a physical device (base URL resolution, cleartext on preview builds)
- [ ] Typed API client over the M1 endpoints, device registered on first launch
- [ ] Onboarding flow
- [ ] Routine editor
- [ ] Schedule screen: arrival time, days of week, fixed travel duration
- [ ] Engine result drives a real scheduled alarm
- [ ] Offline mirror (expo-sqlite + drizzle)
- [ ] Move the M0 harness off the home screen into a hidden debug panel

### The debug panel

The home screen is currently the M0 diagnostics harness: permissions, native
module status, alarm scheduling, the missed-alarm list, the copyable report. All
of it stays, none of it belongs in front of a user who just wants an alarm.

It moves behind the pattern every phone already teaches: **tap the app version in
settings ten times**. The panel then asks for a password before opening.

The password stops someone stumbling in, which is what it is for. It is not a
security boundary and must never be treated as one: it ships inside the bundle
and anyone who wants it can read it out. That is acceptable here because the
panel shows the user their own device's diagnostics, nothing that belongs to
anyone else. Anything that would matter if it leaked does not go on this screen.

The report is deliberately untranslated, because it exists to be pasted into a
bug report rather than read in the app, and that fits a screen a normal user
never sees.

## M2: NS live

Where the product actually becomes itself.

- [ ] `TransportProvider` interface + `FixtureProvider`
- [x] `NsModule`: `/api/v3/trips` station to station, `searchForArrival`, `addChangeTime`
- [x] `JourneyPlannerService`: door-to-door composed from NS rail + TomTom walking legs, since the `Ns-App` key refuses coordinate planning (`API_KEY_NOT_ALLOWED_TO_PLAN_DOOR_TO_DOOR`)
- [x] `ctxRecon` refresh path (walks re-attached from the stored journey, so a refresh stays one NS call)
- [ ] Places autosuggest proxy for address entry
- [ ] `ScheduleOccurrence` + `AlarmEvent` entities
- [ ] Monitor loop: minute tick, `nextCheckAt`, `FOR UPDATE SKIP LOCKED`
- [ ] Cadence ladder (30m / 10m / 3m bands)
- [ ] Global disruption sweep promoting affected occurrences
- [ ] Anchor vs live split + monotonic-later rule
- [ ] High-priority push → device reschedules
- [ ] NS call-count instrumentation + loud 429 logging
- [ ] The "you can sleep 12 minutes longer" moment works end to end

## M3: car

- [ ] `TomTomProvider`: `arriveAt`
- [ ] Predictive → live traffic switch inside the departure window
- [ ] Continuous risk buffer

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
