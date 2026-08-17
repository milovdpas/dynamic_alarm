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

### Information architecture: three tabs

Decided after the first week of real use, which exposed the gap: the app could
compute a wake time and ring, and could show you nothing else. No list of what
was armed, no way to see which train it had chosen, and no way to add, edit or
remove a schedule after onboarding.

```
Today          the soonest armed morning, and what it depends on
Schedules      every schedule, each with its own next armed alarm
Settings       disruptions, language, theme, sound, version (debug behind it)
```

Bottom tabs rather than a home screen with links. Managing schedules is not a
rare configuration task, it is the second thing anyone does after the alarm
works, and burying it behind a row on the home screen said otherwise.

**Every active schedule arms its own next morning.** A schedule is a standing
commitment, not a mode: weekdays to Tilburg and Saturday climbing are both true
at once, and making the user switch between them is a way to miss a Saturday.
Today shows the soonest; the Schedules tab shows each with the time it is armed
for. The device holds one OS alarm per occurrence, which the existing id scheme
(`occurrence-<id>`) already supports, and alarms for occurrences that no longer
exist are cancelled rather than left to ring.

This is a change from the current behaviour, which arms only the first active
schedule and silently ignores the rest.

**Today shows a summary, with the whole journey one tap away.**

```
Tomorrow
06:53
Leave home at 07:34

Train 07:52 Oss to Tilburg
Arrive 08:27, 3 minutes before you must

[ See the whole journey ]
```

The wake time is the answer, and it should not be buried in a timetable. The
timeline behind the tap is the justification: every leg with its time, the
buffers named, and the event trail saying why the alarm moved if it did. That
trail already exists in `alarm_events` and has never been shown to anyone.

What each screen needs that does not exist yet:

| Screen | Missing |
|---|---|
| Today | Journey summary line, leave-home time in the primary position, simulation controls while testing |
| Journey detail | New route. Leg-by-leg timeline, buffer breakdown, `GET /occurrences/:id/events` rendered |
| Schedules | New route. List with next armed time, add, edit, delete, pause |
| Schedule editor | A hub, not a form. See below |

One new endpoint: `GET /api/v1/occurrences` for the armed occurrences of this
device, since `occurrences/next` answers a different question and the Schedules
tab needs all of them. Everything else the screens need already exists.

**Editing is a hub with focused sub-screens**, not one form and not accordions.

```
Schedule
  Your alarm is set for 07:34, Tuesday 18 August
  When you need to be there   09:00 · Tue Thu Fri   >
  How you travel              Train · Oss → Tilburg >
  Your morning                25 min                >
  [ Work out my options ]
```

Everything onboarding asks has to be changeable afterwards, notification
settings aside, which live in Settings because they belong to the device rather
than to a schedule. Putting all of it on one screen meant an address search, a
keyboard, a routine list and a set of departures competing for the same space.
Accordions were the alternative and hide the answer: you would open four of them
to see what your schedule says.

Each sub-screen commits its own change, and the hub owns the last decision:
recalculate, choose a departure, and arm from it. That ordering is not cosmetic.
The wake time is computed backwards from the deadline through the morning, so
the options are only meaningful once everything above them is settled.

Each form **mounts with its values** rather than being seeded by an effect. The
seeded version needed a flag to stop a background reload overwriting what was
being typed, and a flag like that is a bug waiting for the day it is wrong.

**Ordering, and why.** The tab shell and the Schedules tab come first, because
being unable to edit a schedule is the thing that currently makes the app feel
unfinished. Arming every active schedule follows, since a list of schedules that
are not all armed would be a lie. The journey detail comes last of the three: it
is the most satisfying screen and the least load-bearing.

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

### Simulating a delay or a cancellation, on purpose

The one thing this product does that cannot be observed on demand: real trains
are mostly on time, so the interesting path runs perhaps twice a month and never
when you are watching. Waiting for NS to cancel something is not a test plan.

**A scenario attached to one occurrence, applied on the next refresh.** The
device asks for it from the debug panel, the monitor applies it the next time it
checks that occurrence, and everything downstream is real: the wake time is
recomputed by the same engine, the push goes through Expo, and the phone
reschedules under the same monotonic rule. Only the timetable is invented.

```
POST /api/v1/occurrences/:id/simulate   { kind: 'DELAY', minutes: 20 }
                                        { kind: 'CANCELLATION' }
                                        { kind: 'CLEAR' }
```

Design constraints, each of which is the difference between a test tool and a
liability:

- **Device authenticated, and it may only touch that device's own occurrence.**
  Not the monitor token, and not a global switch. A scenario that could be
  applied to somebody else's alarm is a way to make a stranger late.
- **It expires.** One application, or an hour, whichever comes first. A
  simulation left on overnight would silently mean the alarm stops tracking
  reality, which is the exact failure the product exists to prevent.
- **It is visible.** The occurrence says it is simulated, the home screen says
  so, and the alarm event written for the change says so too. Someone who wakes
  early must be able to see it was a test rather than a delay.
- **It cannot fabricate an earlier time.** A simulated delay may move the alarm
  later, and a simulated cancellation may force a re-plan. Neither may pull the
  alarm earlier than the anchor, because that path is the emergency one and it
  should be exercised by a real cancellation only.

`DELAY` shifts the stored journey's departure and arrival by the given minutes
and marks the leg disrupted, so the risk buffer responds the way it would to a
real delay. `CANCELLATION` makes the refresh return null, which is what NS
effectively says when a trip can no longer be reconstructed, and forces the
re-plan path.

### Which replacement is acceptable when a train is cancelled

Re-planning a cancellation answers "is there another way", and the app currently
takes whatever comes back. That is not good enough: a 06:50 departure is a
technically valid replacement for a 07:52 and a terrible answer for someone who
is not willing to get up an hour earlier. The choice belongs to the user, and it
has two parts.

**A direction, and a window.**

| Setting | Meaning | Default |
|---|---|---|
| `replacementPreference` | `EARLIER` or `LATER`, which way to look first when the usual train is gone | `EARLIER`, because arriving on time is the point of the app |
| `travelWindowStart` / `travelWindowEnd` | The hours within which a replacement is acceptable at all, e.g. 07:00 to 09:00 | Unset, meaning any replacement, which is today's behaviour |

The window bounds the **departure of the first service leg**, the train itself,
because that is what the user is actually reasoning about. It is a different
constraint from the arrival deadline: the deadline says when they must be
somewhere, the window says when they are willing to travel, and a cancellation is
exactly the moment those two stop agreeing.

**The order of resolution, and it must be this order:**

1. The preferred direction, inside the window.
2. The other direction, inside the window. Someone who prefers an earlier train
   would still rather take a later one than none, and the reverse holds too.
3. Nothing. The alarm stays exactly where it is, and the user is told.

Step three is the one worth building carefully, because it is the case where the
app has no good answer and must say so rather than invent one. It becomes a
disruption notice like any other, so it is on the device before the alarm rings:

```
Your 07:52 is cancelled, and there is no train between 07:00 and 09:00
that gets you there. Your alarm has not moved.
```

That is more useful than an alarm silently moved to 06:20 for a train the user
was never going to catch, and far more useful than silence.

**A later replacement will often be infeasible, and that is fine.** The engine
already models it: `feasible: false` with `shortfallMinutes`, which the UI shows
as "the earliest you can arrive is 08:41, 11 minutes late". Someone who chose
`LATER` has implicitly said they would rather be late than early, and the app's
job is to be honest about the cost rather than to refuse.

**Per schedule, not per device.** A weekday commute and a Saturday climbing trip
have different tolerances, and the window is a property of the journey rather
than of the person. This differs deliberately from the disruption switches, which
are per device because they are about how somebody likes to be woken.

**It bounds the emergency path too.** The emergency-earlier rule moves an alarm
earlier regardless of the opt-in switches, because not moving is a guaranteed
failure. The window does not weaken that: it says which replacements exist at
all, and if none do, then there is nothing to move the alarm *to*, and the honest
outcome is the notice above.

Implementation notes worth having before starting:

- The re-plan already exists (`SchedulePlanService.forDate`). What it lacks is
  the ability to return **several** candidate journeys so a choice can be made
  among them; `PlanService.options` already does exactly that, so this is a
  matter of planning options for the date and filtering, not new provider work.
- Filtering happens in `packages/core`, beside the rest of the engine, so the app
  and the server agree about which replacements are acceptable.
- The window is a pair of local times like the arrival deadline, so the same
  `LocalTimeString` handling and the same DST care applies.

### Showing that something has gone wrong

The gap found by running the first simulation: the alarm moved, the event trail
recorded why, and **no screen said anything**. Today showed a new time with no
explanation, which is the one thing this product cannot afford. An alarm that
moves without saying why is an alarm nobody trusts, and the whole reason it is
allowed to move is that it can explain itself.

This is also the M2 payoff the build order names and never specified: *"the you
can sleep 12 minutes longer moment"*. That moment is a sentence on a screen, and
nobody had written it.

**Four states, and each needs different words.**

| State | What the user needs to know |
|---|---|
| Normal | Nothing. Silence is the right answer for the ordinary morning |
| Delayed, alarm moved | The delay, the new time, and that they gained sleep |
| Cancelled, re-planned | That their train is gone, which one replaced it, and the new time |
| Disrupted, alarm **not** moved | That something is wrong and the alarm deliberately did not move |

The fourth is the one that is easy to leave out and the most important. With the
opt-in settings off, a delay changes nothing, and a screen that stays silent is
indistinguishable from an app that did not notice. It has to say that it noticed
and did not act, and name the setting that would have let it:

```
Your 07:52 is 12 minutes late.
Your alarm has not moved, because sleeping longer on delays is switched off.
```

**Where it goes.** Today, above the wake time, because it is the reason the wake
time is what it is. The Schedules list gets a marker on the affected row so the
state is visible without opening anything. The journey screen already marks a
late or cancelled leg and gains the journey's own status at the top.

**Say the size of the change, not just that there was one.** "Your alarm moved"
is a notification; "you can sleep 12 minutes longer" is the product. The number
comes from the event trail, which already records `fromAt` and `toAt` for exactly
this.

**A simulated disruption says so, everywhere it appears.** Not only in the debug
panel where it was staged. Someone woken early by a test must be able to tell
that from the product being wrong, and by the morning after they will not
remember which. The `simulated` field is already on the wire for this.

**It clears itself.** The banner belongs to the current plan, not to a
notification history: once a re-check finds the journey normal again the message
goes, and the trail keeps the record. A stale "your train is cancelled" on a
morning that is running fine is worse than no banner at all.

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

### The app stays readable when the API does not answer

The alarm already survives an outage: it is an OS-level exact alarm, armed on the
device, and no request is made between arming it and it ringing. What does not
survive is the **app**. Every screen reads from the API, so a dead backend, a
train tunnel or a hotel wifi captive portal turns the whole thing into an error
banner, including the screen whose only job is to tell you what time you are
being woken.

**Every read is cached; no write is queued.** Those are opposite decisions and
both are deliberate.

Reads are cached because they describe something that has already been decided.
Schedules, routines, places and armed occurrences are all stored server-side and
change only when someone changes them, so the last known copy is nearly always
the right answer, and when it is not, it is still a better answer than nothing.
The occurrence carries its whole `WakePlan`, so a cached copy can render the
journey, the breakdown and the wake time without a single request.

Writes are not queued because a queued write to an alarm is a trap. Someone edits
their deadline on a train with no signal, the app says "saved", and the request
lands at 03:00 when connectivity returns, silently moving an alarm they are
already asleep under. A refused write with the draft still on screen is worse for
five seconds and better forever.

Rules that make cached data honest rather than merely present:

- **Cached data is labelled and dated.** "Worked out 3 hours ago" under the wake
  time, not silence. The difference between live and remembered is exactly what
  someone needs to know before trusting it.
- **A cached plan never masquerades as a fresh one.** The refresh button says it
  failed rather than showing an older answer as if it had just arrived.
- **The cache is a mirror, not a source.** A successful read replaces its slice
  wholesale. Merging would invent states the server never had.
- **Nothing is cached that the device should not hold**: no device token beyond
  the secure store it already lives in, and no other device's anything.

This is the same store as the offline mirror already planned for M1
(`expo-sqlite` + drizzle), and the two are worth doing together, because they are
one idea seen from two ends. The mirror exists so the device can recompute an
anchor with no connectivity; the cache exists so it can show what it already
knows. Both need the same tables, the same write path and the same staleness
rule.

The one thing neither of them changes: **an alarm that is armed rings whether any
of this works or not.** Caching improves what the app can say, never what it can
promise.

### An optional lock on stopping the alarm

Opt in, off by default, and configured per device. The point is not security: it
is the two seconds between a hand reaching out and a brain arriving, in which a
dismiss can happen without anyone remembering it. A small deliberate act closes
that gap.

Planned forms, in the order they are worth building:

| Form | Why |
|---|---|
| Arithmetic | The classic. Difficulty is a setting, because "what wakes you up" varies more than any default could |
| A typed word or PIN | For people who find maths under duress unpleasant rather than rousing. Also the accessible option |
| Scan something | An NFC tag or QR code on the bathroom door, so stopping the alarm requires standing up. Later, and only if the first two prove the idea |

The constraints matter more than the forms, and each of them is a way this
feature could turn a good alarm into a bad one:

- **Stopping must always be possible.** A puzzle nobody can solve at 06:00 is a
  phone screaming in a bedroom with no way to stop it. There is an escape: hold
  the dismiss button for ten seconds. Deliberate enough that a sleeping hand
  cannot do it, and always available. It is not a loophole to be closed later,
  it is a required part of the design.
- **The lock is on dismiss, never on silence.** If the sound cannot be stopped
  the feature is a hazard to everyone else in the house. The volume ramp and the
  ability to mute are untouched; what the lock guards is marking the alarm as
  handled.
- **It must survive its own bugs.** The ring screen runs JavaScript; the alarm is
  native. If the screen fails to render, the notification action must still stop
  the alarm, lock or no lock. A feature that can strand a ringing phone by
  crashing is not shippable.
- **The answer is stored, not hashed.** It is a convenience against your own
  half-asleep self, not a secret, and pretending otherwise would mean a recovery
  flow for a forgotten PIN at exactly the wrong moment. It goes in secure storage
  because that is where the app keeps things, not because it is a credential.
- **It never delays the alarm.** The lock is drawn after the sound starts, so a
  slow render cannot make an alarm late.

Snooze interacts with this and is currently disabled (see `APP_CONSTANTS.ALARM`).
When snooze is designed, the same question applies: whether a snooze should be
locked as well, or whether an unlocked snooze plus a locked dismiss is the honest
combination. Deciding that is part of the snooze work, not this.

### Choosing the theme, and leaving room for more of them

Dark and light both exist and are equally cared for, because this app is looked
at in bed and again at 06:00. What is missing is the choice: `ThemeContext`
follows the system and has a `toggleTheme` nobody can reach, so a phone set to
light shows a white screen to someone half asleep in a dark room, and the app has
no answer.

**Three options, not two: system, light, dark.** Following the system has to stay
available and stay the default, because a phone that dims itself at night is
already doing the right thing for most people. A two-way toggle would quietly
throw that away, and there is no way back to it once it is gone.

What the row needs to get right, which is more than it looks:

- **Persisted through the same storage the language uses**, and applied before
  the first paint. A theme that arrives a frame late is a white flash in a dark
  bedroom, which is the exact moment this setting exists for.
- **The ring screen follows it too.** That screen is the one guaranteed to be
  read in the dark, and it currently inherits whatever the rest of the app
  resolved to. Worth checking rather than assuming, since it is launched by a
  full-screen intent rather than by ordinary navigation.
- **Say what "system" means** rather than showing three unexplained words. "Match
  my phone" is a description; "System" is a category name.

**Themes beyond the two are a later idea, and the groundwork is already right.**
Colours live in one `Colors` map keyed by theme name, and every screen reads them
through `useThemeColor`, so a third palette is an entry in that map rather than a
sweep through the app. What it would need before shipping:

- Contrast checked per palette rather than inherited. A pretty theme that makes
  the wake time hard to read at 06:00 is a worse alarm.
- A stable name per theme, since it is persisted. Renaming one silently resets
  everybody who chose it.
- The semantic names kept honest: `danger` has to stay the colour that means
  something is wrong in every palette, or the warnings stop reading as warnings.

Not scheduled. The system, light and dark choice is worth having on its own, and
it is the part that makes a phone in a dark room bearable.

### Choosing the alarm sound, from settings rather than from diagnostics

The machinery exists and is reachable only from the debug panel. `modules/alarm-sound`
already opens the system ringtone picker and returns a `content://` URI with a
label, and the ring service already plays a URI on the alarm stream. What is
missing is a settings screen, somewhere to keep the choice, and a second source
of sounds.

**Two sources, and they behave differently.**

| Source | How | What it costs |
|---|---|---|
| The phone's own alarm tones | `RingtoneManager.ACTION_RINGTONE_PICKER`, already built | Nothing. It is the OS's own picker, so it looks native because it is |
| A file the user owns | `expo-document-picker`, then **copy it into the app's storage** | One copy per chosen sound, and a real reason to do it, below |

**A picked file must be copied, not referenced.** A `content://` URI handed over
by a document picker is a temporary grant: it does not survive a reboot, and on
some devices not even a process restart. The alarm is played hours later by a
native service after the phone may well have rebooted, so a stored URI that has
quietly expired means an alarm that rings silently, which is the worst failure
this app has. Copy the bytes into the app's own files directory on selection and
store that path.

Same reasoning applies more weakly to the ringtone picker, whose URIs are stable
system ones. Those can be stored as-is, and the fallback chain below covers the
case where one stops resolving.

What the screen needs to get right:

- **Preview, on the alarm stream.** A sound chosen at volume 3 in the afternoon
  and heard at alarm volume at 06:00 is not the same experience. The preview must
  use the same path the alarm does, and say so when the alarm volume is muted,
  which the debug panel already detects.
- **The fallback chain stays honest**, and is already specified above: the chosen
  URI, then `Settings.System.DEFAULT_ALARM_ALERT_URI`, then the bundled asset. A
  chosen sound that no longer resolves must fall back **and say so on the
  settings screen**, rather than silently ringing something else.
- **The choice is per device, not per schedule.** Sound is a property of how
  somebody likes to be woken, not of one commute. Per-schedule sounds are a
  plausible later idea and would slot in the same way the disruption settings
  would, read through the schedule.
- **iOS gets the bundled asset and nothing else**, which is permanent rather than
  a gap: AlarmKit reads only from the app bundle or `Library/Sounds`, and Apple's
  own alarm tones have no public API. The screen must not offer a picker there
  that cannot work.

Storage is the same `Storage` wrapper as language and theme, and the same caveat
applies: on a binary without AsyncStorage it degrades to memory for the session,
so the row should say so rather than pretend the choice will survive.

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
- ~~NS publishes no rate-limit figures on the portal~~. It does: **300 requests
  per 5 minutes**, shared across the deployment. Call counts are now instrumented
  (`ProviderUsage`), reported on every tick, and a 429 is logged loudly with the
  count that preceded it. Measured against live providers:

  | Operation | NS | TomTom |
  |---|---|---|
  | A tick with nothing due (the global sweep) | 1 | 0 |
  | Re-checking one occurrence | 1 | 0 |
  | A cancellation, re-planned with 8 candidates | 4 | 2 |

  What that means for the ceiling: the sweep costs 5 of the 300 in any window,
  leaving 295. In the tightest cadence band an occurrence is checked every three
  minutes, so it spends about 1.7 calls per window, and the deployment runs out
  somewhere around **170 alarms being monitored inside their final 45 minutes**.
  Comfortable now, and a real number to tune against rather than a guess.

  The counter is in memory and per process, so it is diagnostic rather than
  enforcement: a second instance counts separately. NS's own 429 remains the
  authority, which is why it is logged separately and loudly.

  **The audit that followed found one real saving.** The sweep looked free
  because it is one call however many users there are, and it was therefore
  being spent every minute of the day, including the sixteen hours when no alarm
  is armed at all: about a thousand NS requests a day answering a question
  nobody had asked. It now counts armed occurrences first, which is a query the
  database was already going to serve, and calls nothing when the answer is
  zero. A deployment of drivers never calls it at all, since a car journey has
  no station a rail disruption could touch.

  Everything else was already minimal, and worth writing down so it is not
  re-examined every month:

  - **Refreshing an occurrence is one call**, by `ctxRecon`, which is the whole
    reason that endpoint is used rather than re-planning.
  - **A re-plan is one NS call regardless of how many candidates it considers**,
    because `/trips` returns them together. Asking for eight rather than three
    costs nothing extra.
  - **Access legs are cached per coordinate and mode** on a provider held
    statically, so the walk or ride to the station is asked once per address for
    the life of the process rather than once per plan. That is why a re-plan
    that touches eight itineraries spends two TomTom calls and not sixteen.
  - **Autosuggest is debounced in the app** and rejected under three characters
    by the server, which are the only two defences a keystroke-driven endpoint
    can have.
- One bundled fallback alarm sound (used as last resort on Android, and as the only option on iOS). Needed before M4; a placeholder tone is fine for M0-M3.
- iOS 26 device eventually, for M4.
