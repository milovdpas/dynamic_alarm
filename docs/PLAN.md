# Smart Dynamic Alarm (NL), Architecture & MVP Plan

> **Status:** approved 2026-08-09. This is the architectural source of truth.
> For milestone/task state see [PROGRESS.md](./PROGRESS.md).
> Amendments made after approval are marked **[AMENDED]** inline.

## Context

Build a mobile app that answers *"what is the latest time I can wake up and still arrive on time?"*, deriving the alarm from a live journey rather than a fixed time. Netherlands-only for MVP. Repo `dynamic_alarm` is currently empty (LICENSE + README + the concept doc).

The structure mirrors `espressions_app`: npm workspaces, `apps/*` + `packages/*`, shared types package, Express 5 + TypeORM + Knex backend.

**Decisions locked with the user:**

| Area | Decision |
|---|---|
| Alarm | Real native alarm. EAS dev builds from day 1, no Expo Go. |
| Backend | Thin backend from day 1 (journey monitor + push). |
| Transport | Train + car. |
| Accounts | Anonymous device account. |
| Backend stack | Express 5 + TypeORM + Knex (espressions parity). |
| App stack | Unistyles v3 + TanStack Query + Zustand + expo-sqlite/drizzle. |
| Transport APIs | NS Reisinformatie + TomTom, real keys. |
| Fail-safe | Pessimistic anchor; alarm normally only ever moves **later**. |
| Platform | Android-first; iOS written but unverified (Apple account yes, no iOS device). |

---

## Research findings that change the design

### NS Reisinformatie API is far more capable than assumed

Pulled the live OpenAPI spec from the NS APIM portal. `GET /api/v3/trips` supports:

- `originLat/originLng` + `destinationLat/destinationLng` with `originWalk` / `destinationWalk` / `originBike` / `destinationCar` → **NS returns true door-to-door itineraries including the walk legs**. The user does not hand-enter "walk to station: 7 min".
- `dateTime` + `searchForArrival=true` → native "arrive by 08:30" planning.
- `addChangeTime` (minutes) → **transfer buffer is passed into the planner**, so tight transfers are rejected at plan time rather than patched afterwards.
- Leg modality enum includes `TRAIN, BUS, TRAM, METRO, FERRY, WALK, BIKE, CAR, TAXI`, and trip `source` includes `NEGENTWEE`. **NS already fronts 9292 data for bus/tram/metro, we do not need a 9292 commercial contract for MVP.**
- Realtime fields present: `plannedDateTime` / `actualDateTime`, `delayInSeconds`, `plannedTrack` / `actualTrack` (platform changes), `cancelled`, `changePossible`, `alternativeTransport`, `punctuality`, `transferMessages`.
- Trip `status` enum: `CANCELLED, CHANGE_NOT_POSSIBLE, ALTERNATIVE_TRANSPORT, DISRUPTION, MAINTENANCE, UNCERTAIN, REPLACEMENT, ADDITIONAL, SPECIAL, NORMAL`. Label types include `TRIP_CANCELLED, LEG_CANCELLED, LEG_TRANSFER_IMPOSSIBLE, REPLACEMENT, SHORTENED_TRAIN`.

**The critical one:** `GET /api/v3/trips/trip?ctxRecon={ctxRecon}` re-fetches *the exact same itinerary* with fresh realtime data. This is precisely the "do not blindly add the delay, recalculate the actual journey" requirement, refresh by `ctxRecon`, and only fall back to a full re-plan when status degrades to `CANCELLED` / `CHANGE_NOT_POSSIBLE` / `ALTERNATIVE_TRANSPORT`.

Other useful endpoints: `/api/v2/stations`, `/api/v2/stations/nearest?lat&lng`, `/api/v3/disruptions`, `/api/v2/departures`.

**Which product to subscribe to, `Ns-App`, not `Public-Travel-Information`.** The portal's deprecation notice ("we will no longer approve new subscriptions") sits on `Public-Travel-Information`, which contains *only* the NS.nl-Public-Price-Information API. NS's own notice redirects you to "the Reisinformatie API within the Ns-App product". Verified against the portal's product→API mapping:

| Product | Contains | Approval |
|---|---|---|
| `Ns-App` | `reisinformatie-api`, `disruptions-api`, `nsapp-stations-api`, `Places-Api`, `virtual-train-api`, `spoorkaart-api` | **false, self-serve, instant** |
| `Public-Travel-Information` | price API only (deprecated) | true, closed |

> **Action for you (2 minutes, not blocking):** subscribe to **`Ns-App`** at <https://apiportal.ns.nl/products>. Auto-approved, limit 1 subscription. Auth is the `Ocp-Apim-Subscription-Key` header.

`Places-Api` `/v2/autosuggest` is NL address/POI geocoding, it covers the onboarding "where do you live / work" step, so **no Google Places dependency**. `disruptions-api` `/v3` is a cheap global disruption feed, which the monitor loop below leans on heavily.

### TomTom Routing supports arrive-by directly

`arriveAt` is a first-class parameter (mutually exclusive with `departAt`, and unusable with `minDeviationDistance`/`minDeviationTime`). `traffic=true` is the default and accounts for closures/roadworks up to 60 days out.

Important nuance: **for a future `departAt`, live traffic is ignored, only historic/predictive traffic shapes road speeds.** So the car estimator must switch strategy as the alarm approaches: predictive when far out, live (`departAt=now`) once inside the departure window. This is the "predicted traffic vs current traffic" distinction from the concept doc, and it is a real behavioural difference, not a detail.

### Alarm platform reality

- **Android, fully solvable.** `react-native-notify-kit` (the maintained Notifee fork, Invertase-endorsed as of April 2026): RN ≥0.73, dev target **0.85.3**, Expo CNG config plugin, full-screen intent, `AlarmManager` with `SET_ALARM_CLOCK` / `SET_EXACT_AND_ALLOW_WHILE_IDLE`, custom sounds, and boot persistence via `RebootBroadcastReceiver`. `USE_EXACT_ALARM` is granted at install and alarm clocks are an explicitly approved Play Store category, so no policy risk.
- **iOS, genuinely limited.** A real alarm needs **AlarmKit, iOS 26+ only**, via community v0.x modules (`expo-alarm-kit`, `react-native-nitro-ios-alarm-kit`). Below iOS 26 there is no real alarm, notifications respect the silent switch and Focus. None of this is testable without an iOS 26 device.
- ~~RN 0.85.3 is Expo SDK 56's React Native, so target Expo SDK 56.~~ **[AMENDED 2026-08-09]** `create-expo-app` actually scaffolds **Expo SDK 57 / RN 0.86.2 / React 19.2.3 / expo-router 57 / TypeScript 6.0.3**, one SDK newer than the changelog research suggested. Taken as-is rather than downgrading.
  **Open risk:** `react-native-notify-kit` documents a dev target of RN **0.85.3**; we are on **0.86.2**. Compatibility is unverified and is the first thing M0 must prove. If it breaks, the fallbacks in order are: pin the app to SDK 56, or write the AlarmManager + full-screen intent directly in the local `modules/alarm-sound` native module (which already needs Android native code, so the incremental cost is bounded).

---

## Architecture

```
dynamic_alarm/
├── package.json              npm workspaces: ["packages/*", "apps/*"]
├── tsconfig.base.json        shared compilerOptions   (espressions lacks this)
├── tsconfig.json             solution file, references packages/*
├── docker-compose.yml        postgres + redis
├── apps/
│   ├── mobile/               @alarm/mobile , Expo SDK 56
│   └── api/                  @alarm/api    , Express 5 + TypeORM + Knex
└── packages/
    ├── types/                @alarm/types  , DTOs, enums, API_ENDPOINTS
    └── core/                 @alarm/core   , wake-time engine + transport adapters
```

`packages/core` is the load-bearing idea: **the app and the backend must compute identical wake-up times**. The engine and the transport adapters live there, imported by both. This is the one real departure from espressions (which has a generic `utils` package) and it is what lets the phone recompute offline and still agree with the server.

**Copy from espressions, with three fixes the Explore pass flagged:**
1. Add `apps/mobile/metro.config.js` with `watchFolders` + `disableHierarchicalLookup` (espressions has none and relies on hoisting luck).
2. Introduce `tsconfig.base.json`; the root `tsconfig.json` stays a solution file.
3. `app/` holds **routes only**; components/hooks/lib go in `apps/mobile/src/*` (espressions nests everything under `app/`, which fights expo-router).

Packages build to `dist` via `tsc -b`. API tsconfig paths → `dist`; mobile tsconfig paths → `src` so Metro hot-reloads shared code. Root `dev` runs `tsc -b --watch packages` alongside the apps.

---

## The wake-time engine (`packages/core/engine`)

Computed backwards from arrival. Answers the concept doc's "where does the buffer belong?", **there is no single buffer; there are four, at different layers.**

```
requiredArrivalTime                     08:30
  − arrivalBuffer                       reach the desk, not the door   (user, default 3m)
= latestArrivalAtDestination
      ↓ provider.plan({ arriveBy, addChangeTime: transferBuffer })
      ↓ returns door-to-door itinerary incl. walk legs
= plannedDeparture (at origin)
  − riskBuffer                          DERIVED, not user-set          (see below)
  − preDepartureBuffer                  coat/keys/door                 (user, default 5m)
= latestDepartureFromHome
  − routineDuration                     Σ enabled RoutineStep.minutes
  − wakeSlack                           grogginess allowance           (user, default 0m)
= wakeUpTime
```

- **`transferBuffer`** is *not* subtracted, it is passed to NS as `addChangeTime` so the planner never proposes a transfer that tight. Structurally better than post-hoc arithmetic.
- **`riskBuffer` is derived per mode**, because the two modes have fundamentally different uncertainty shapes:
  - **Public transport → discrete.** The risk is missing one specific departure. MVP heuristic: `base 4m + 3m per transfer + 5m if any leg carries a DISRUPTION/UNCERTAIN/SHORTENED_TRAIN label`. Later: observed per-leg delay distribution.
  - **Car → continuous.** MVP: `max(5m, 0.15 × travelTime)`, tightened once inside the live-traffic window. Later: p90 from TomTom historic vs live spread.

**Impossible journeys.** If no itinerary satisfies `arriveBy`, the engine returns `{ feasible: false, bestEffortArrival, shortfallMinutes }` rather than throwing. UI surfaces "earliest you can arrive is 08:41, 11 min late", and the alarm is set for that best-effort plan.

### Anchor vs live, the fail-safe

Two wake times, and this is the safety core of the product:

- **`anchorWakeTime`**, computed at bedtime (T−8h) from the pessimistic estimate, and **scheduled as a real local exact alarm on the device**. OS-guaranteed. No network, no push, no backend needed at 05:00.
- **`liveWakeTime`**, recomputed by the backend; pushed to the device.

Rule: **applied only when `liveWakeTime > currentScheduledAlarm`.** The alarm is monotonically non-decreasing. Dropped push, airplane mode, dead backend, battery saver → you wake at the anchor, slightly early, and you make it. The alarm is never late because of an infrastructure failure.

**Emergency-earlier path (explicitly best-effort).** If a cancellation blows through the pessimism budget and `requiredWake < scheduledAlarm`, we send a high-priority push *the moment it is detected*, not on the ladder, and reschedule earlier. This is not guaranteed, and the UI must never imply it is. Failing here leaves the user exactly where they'd be with no app at all.

### Which disruptions may move the alarm is a user setting

Three switches, all on the device, **all off until the user turns them on**. Each
names a class of event and the direction it is allowed to move the alarm.

Opt in rather than opt out, because moving somebody's alarm is the most
consequential thing this app does and doing it because nobody objected is the
wrong way round. Onboarding asks directly, as its last step, so the default only
governs devices that never got that far.

| Setting | Event | Direction |
|---|---|---|
| `allowLaterWakeOnDelay` | A train is running late | Later |
| `allowLaterWakeOnCancellation` | A train is cancelled, and the re-plan is later | Later |
| `allowEarlierWakeOnTraffic` | Live traffic makes a car journey longer | Earlier |

**Why delays and cancellations are separate.** A delay shifts a journey the user
already agreed to by a known number of minutes. A cancellation replaces it: a
different train, possibly a transfer, possibly a replacement bus, and a plan
built from a `ctxRecon` that no longer reconstructs. Those are different amounts
of certainty, and someone can reasonably accept extra sleep from the first while
refusing it from the second.

**Why the traffic one moves the alarm earlier.** Public transport is the
pessimistic case: the anchor already assumes the journey works, so a disruption
usually means more sleep. A car journey grows instead. TomTom plans a future
departure from predictive traffic only, so a jam, an accident or roadworks
discovered inside the departure window means the drive now takes longer than the
anchor assumed, and the alarm has to move earlier or the user is late by exactly
that much.

**The cost of turning that one off is being late, and the copy must say so.** It
exists because traffic predictions fluctuate and being woken twenty-five minutes
early for a jam that clears is a real cost. That is a trade someone may take with
their eyes open; it is not a trade to make for them by default.

**The emergency path is not one of these.** If a cancellation leaves no way to
arrive on time unless the user leaves much earlier, the alarm moves earlier
regardless of every switch here, best-effort, because not moving is a guaranteed
failure rather than a risk. These settings govern the routine cases.

**Only the switches the chosen mode can act on are shown.** A car journey has no
train to be delayed or cancelled, and a train journey has no traffic. Offering
all three regardless puts controls in front of someone that can never do
anything, which reads as the app not knowing how they travel. Onboarding filters
by the mode being set up; settings filters by the modes across the device's
schedules.

Global rather than per schedule to begin with. Per-schedule overrides are the
obvious extension (trusted for the commute, not for a flight), and the values
should be read through the schedule so adding them later is a default rather than
a change of meaning.

The UI must say which mode each is in wherever a wake time is shown. An alarm the
user believes is adaptive but is not is the same class of dishonesty as one they
believe is set and which cannot ring.

### The monitor loop

A per-minute cron is the right heartbeat. What it must **not** do is refetch every occurrence in the next 8 hours on every tick, that is ~480 NS calls per occurrence per night, scaling linearly with users, against an API whose quota we don't know and can't raise (subscription limit: 1).

**Tick every minute, but process only what is due.** Each `ScheduleOccurrence` carries its own `nextCheckAt`. The tick claims due rows and reschedules them:

```sql
SELECT * FROM schedule_occurrence
WHERE state = 'ARMED' AND next_check_at <= now()
ORDER BY next_check_at
FOR UPDATE SKIP LOCKED
LIMIT 200;
```

`FOR UPDATE SKIP LOCKED` means a second API instance can run the same loop safely, and a crash mid-tick releases the claim instead of stranding it.

**Cadence tightens as the alarm approaches**, because a delay 6 hours out is noise and a delay 20 minutes out is the product:

| Time until `wakeAt` | Interval | Checks |
|---|---|---|
| > 8h | not armed, no calls | 0 |
| 8h → 2h | 30 min | ~12 |
| 2h → 45m | 10 min | ~8 |
| 45m → wake | 3 min | ~15 |

≈ **35 calls per occurrence per night instead of 480**, a 14× reduction with strictly better resolution where it matters.

**One global disruption sweep beats per-user polling.** Each tick also calls `disruptions-api /v3` **once, for everyone**, a flat 1440 calls/day regardless of user count. Any disruption touching a station or line referenced by an armed occurrence sets that occurrence's `next_check_at = now()`, promoting it into the next tick. This catches cancellations within ~60s even for a user sitting in the 30-minute band, which no polling cadence could afford to do per-user.

| Trigger | Action |
|---|---|
| T−8h (arming) | Full `/api/v3/trips` plan → store `ctxRecon` → device schedules anchor alarm |
| Due per the ladder | Refresh via `/api/v3/trips/trip?ctxRecon=` (same trip, fresh realtime) |
| Global disruption sweep matches an armed occurrence | Promote to immediate re-check |
| Status degrades to `CANCELLED` / `CHANGE_NOT_POSSIBLE` / `ALTERNATIVE_TRANSPORT` | Full re-plan, new `ctxRecon` |
| Car, inside departure window | Re-query TomTom with `departAt=now` for live traffic |
| Wake time moved ≥ 2 min vs `deviceAckedWakeAt` | High-priority data push → device reschedules under the monotonic rule |

The ≥2-minute threshold matters: without it, a 20-second timetable jitter wakes every device's radio for nothing and burns battery on a change no human perceives.

**The loop is deliberately not on the critical path.** The anchor alarm is already armed locally on the device. If the cron dies, the database is down, or every push is dropped, every user still wakes up, just at the pessimistic time. That is what lets this loop stay simple and best-effort rather than needing delivery guarantees.

---

## Data model (TypeORM entities)

- `Device`, id, pushToken, platform, timezone, appVersion
- `Place`, deviceId, label, lat, lng, nsStationCode?
- `Routine` / `RoutineStep`, label, minutes, order, enabled
- `Schedule`, origin, destination, routine, arrivalTime, daysOfWeek[], mode, buffers (json), active
- `ScheduleOccurrence`, scheduleId, date, state, anchorWakeAt, currentWakeAt, deviceAckedWakeAt, tripSnapshot (json), ctxRecon, watchedStationCodes[], lastCheckedAt, **nextCheckAt** (indexed, drives the monitor loop)
- `AlarmEvent`, occurrenceId, type (`SCHEDULED | MOVED_LATER | MOVED_EARLIER | INFEASIBLE | FIRED | DISMISSED`), fromAt, toAt, reason

`AlarmEvent` is not optional bookkeeping, without a written trail of why the alarm moved, "why did it wake me at 06:12?" is undebuggable.

## API surface (declared in `packages/types/src/constants.ts` as `API_ENDPOINTS`)

```
POST   /api/v1/devices                    → { deviceId, token }   (anonymous, secure-store)
CRUD   /api/v1/places  /routines  /schedules
GET    /api/v1/occurrences/next
POST   /api/v1/occurrences/:id/ack        device confirms the alarm is armed
POST   /api/v1/plan/preview               compute without saving (onboarding)
GET    /api/v1/places/autosuggest?q=     proxies NS Places-Api /v2/autosuggest
```

Transport keys live only in `apps/api`. The monitor is a `node-cron` minute tick in the API process for MVP; the `SKIP LOCKED` claim pattern means moving it to a separate worker process later requires no code change.

---

## Mobile app

`apps/mobile/app/` = routes only. Everything else in `apps/mobile/src/`.

```
src/
├── alarm/
│   ├── AlarmScheduler.ts       interface: schedule / reschedule / cancel / listScheduled
│   ├── android.ts              react-native-notify-kit, full-screen intent + AlarmManager
│   ├── ios.ts                  AlarmKit, WRITTEN, UNVERIFIED
│   └── index.ts                Platform.select
├── features/{onboarding,routine,schedule,alarm-ring}/
├── components/  hooks/  lib/{api,db,queryClient}/  theme/
```

- The ringing screen is a real route launched by the full-screen intent, not a notification banner.

### Settings, and the debug panel behind it

The settings screen is where anything the user can change but rarely does ends
up: `allowLaterWake` (see the fail-safe section above), language, theme, alarm
sound. **The app version sits at the bottom**, the way every phone puts it.

The M0 harness is currently the home screen: permissions, native module status,
alarm scheduling, the missed-alarm list, the copyable report. All of it stays,
none of it belongs in front of someone who just wants an alarm. It moves behind
the pattern every phone already teaches: **tap the version ten times**, then a
password before the panel opens.

The password stops someone stumbling in, which is exactly what it is for. It is
not a security boundary and must never be treated as one: it ships inside the
bundle and anyone who wants it can read it out. That is acceptable here because
the panel shows the user their own device's diagnostics and nothing belonging to
anyone else. **Anything that would matter if it leaked does not go on this
screen**, which is a constraint on what may be added later, not just a
description of today.

Two counts, one gate. Ten taps is discovery, the password is the door. The taps
alone would be found by accident eventually; the password alone would be a
visible "Developer options" row inviting a guess.

The report stays untranslated. It exists to be pasted into a bug report rather
than read in the app, and that fits a screen a normal user never sees.

### Language selector in settings

Dutch and English are both maintained and the app already picks one: a stored
choice wins, otherwise the device language if we speak it, otherwise Dutch. What
is missing is the row that lets someone override it, which matters because the
device language is a guess and an alarm is a bad place to be surprised by copy
you cannot read.

Everything except the UI exists. `i18n.ts` reads and writes `appLanguage` through
`Storage`, and `languages.ts` already declares the list with labels and flags, so
this is a settings row calling `i18n.changeLanguage` and writing the same key,
not a new subsystem.

Three things it must get right:

- **Persist through the same key i18n reads on boot** (`appLanguage`), or the
  choice lasts until the app restarts and then silently reverts.
- **Say so when it cannot persist.** On a binary without AsyncStorage, `Storage`
  degrades to memory for the session. `isPersistent()` already reports that, and
  the row should use it rather than pretending the choice will survive.
- **Never restart the app to apply it.** `changeLanguage` re-renders the tree,
  and an alarm app that relaunches itself to change a label is one that might not
  come back.

Not the same as the theme toggle, which is cosmetic. A language chosen here also
governs the text on notifications and on the ring screen, both rendered outside
the React tree from the same synchronously initialised i18n instance, so nothing
extra is needed for them to follow.

### Alarm sound, the user's own tones on Android, bundled on iOS

**Android: yes, we can use the phone's real alarm sounds.** `RingtoneManager.ACTION_RINGTONE_PICKER` with `EXTRA_RINGTONE_TYPE = TYPE_ALARM` opens the OS's own picker showing exactly the alarm tones the user already has, and returns a `content://` URI. No permission, no enumeration, no bundled audio, and it looks native because it *is* native.

**iOS: no.** Apple's built-in alarm tones are proprietary with no public API, AlarmKit's `AlertSound` reads only from the app bundle or `Library/Sounds`. iOS must ship its own audio files. This asymmetry is permanent, not a gap to close later.

**Do not attach the sound to the notification channel.** Android fixes a channel's sound at creation, changing it means deleting and recreating the channel, and deleted channel names linger in system settings. Notification sounds are also capped at ~30 seconds, which is disqualifying for an alarm. Since the full-screen intent launches our own route anyway, **the ring screen plays the audio itself**: unlimited looping, volume ramp-up, and the sound becomes an ordinary setting instead of part of a channel's identity.

The audio must play with `USAGE_ALARM` audio attributes so it uses the alarm stream, audible through Do Not Disturb and at alarm volume rather than media volume. `expo-audio` does not expose Android audio usage, so this needs a small local Expo module (`modules/alarm-sound`) with two jobs: launch the ringtone picker and return `{ uri, label }`, and play/stop a URI on the alarm stream with looping. Both are thin wrappers over platform APIs, this is the only custom native code in the project.

Fallback chain if no sound is picked: user's chosen URI → `Settings.System.DEFAULT_ALARM_ALERT_URI` → one bundled asset (which iOS uses unconditionally).
- `expo-sqlite` + drizzle mirrors schedules/routines so the phone can recompute the anchor with zero connectivity.
- Push receipt → recompute → `AlarmScheduler.reschedule` under the monotonic rule.

---

## Build order

**M0, De-risk the alarm first.** Scaffold the monorepo, `expo prebuild`, EAS dev build on your Android device, and ring a real full-screen alarm at a hardcoded time, locked, backgrounded, force-quit, and after a reboot. Includes the `modules/alarm-sound` native module (ringtone picker + alarm-stream playback), since "does it actually make noise through Do Not Disturb" is part of what M0 is proving. Nothing else matters if this fails, so it is step one.

**M1, Static smart alarm.** Onboarding, routine editor, destination, arrival time, fixed travel duration. Engine computes the wake time; real alarm fires. Backend stores config against an anonymous device.

**M2, NS live.** Door-to-door planning, `ctxRecon` refresh, the monitor loop, push rescheduling, anchor/live split, the "you can sleep 12 minutes longer" moment. Unblocked, `Ns-App` is self-serve.

**M3, Car.** TomTom `arriveAt`, predictive→live traffic switch, continuous risk buffer.

**M4, iOS.** AlarmKit wiring, EAS build, TestFlight. Needs an iOS 26 device to verify.

---

## Verification

- **M0 (manual, on the physical Android device):** alarm fires with screen locked; after force-quit from recents; after a reboot; with battery saver on; in Do Not Disturb. Each is a separate pass/fail, do not collapse them.
- **Engine:** vitest in `packages/core` (espressions already uses vitest). Table-driven cases covering the doc's edge list, 12-min delay absorbed by buffer, delay breaking a transfer, cancellation forcing a re-plan, replacement bus, DST boundary, arrival before midnight, infeasible journey.
- **Transport adapters:** record real NS/TomTom responses as fixtures, replay in tests. A `FixtureProvider` keeps M1 and the engine tests unblocked while NS approval is pending.
- **Monotonic invariant:** property test asserting a scheduled alarm never moves later-to-earlier except via the explicit emergency path.
- **Monitor loop:** unit-test the cadence function (`wakeAt − now` → `nextCheckAt`) across band boundaries; assert the per-night call count stays ~35, so a future cadence tweak can't silently 10× the API spend. Run two API instances against one database and assert no occurrence is processed twice.
- **End-to-end:** `docker-compose up`, `npm run dev`, dev build on device, create a schedule, force a delay in the fixture provider, confirm the push arrives and the on-device alarm time actually changes.

## Open items

- ~~Subscribe to the NS `Ns-App` product~~, **done.**
- ~~TomTom API key~~, **done.** M3 is unblocked.
- Both keys go in `apps/api/.env` only (`NS_SUBSCRIPTION_KEY`, `TOMTOM_API_KEY`), never in `apps/mobile`, anything prefixed `EXPO_PUBLIC_` ships inside the bundle and is trivially extractable. `.env.example` documents the names with empty values.
- M0 ends with a one-shot smoke script (`apps/api/tools/smoke-transport.ts`) hitting `/api/v3/trips` and TomTom `arriveAt` once each, to prove both keys work before any engine code depends on them.
- NS publishes no rate-limit figures on the portal. Instrument call counts from day 1 of M2 and log 429s loudly, so the cadence can be tuned against a real ceiling rather than a guess.
- One bundled fallback alarm sound (used as last resort on Android, and as the only option on iOS). Needed before M4; a placeholder tone is fine for M0-M3.
- iOS 26 device eventually, for M4.
