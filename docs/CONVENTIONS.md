# Code conventions

Adopted from `espressions_app` and `drinking_games_app` so this repo reads like the
rest of the portfolio. Deviations are listed at the bottom with reasons.

## Formatting

Enforced by [`.prettierrc`](../.prettierrc), run `npx prettier --write` rather than
arguing about it.

- **4-space** indentation
- Single quotes, semicolons, trailing commas
- 100-character lines

## Naming

| Kind | Convention | Example |
|---|---|---|
| Components | `PascalCase.tsx` | `ActionButton.tsx`, `ThemedText.tsx` |
| Classes / interfaces-as-modules | `PascalCase.ts` | `AndroidAlarmScheduler.ts`, `Axios.ts` |
| Hooks | `useCamelCase.ts` | `useThemeColor.ts`, `useAlarmRouting.ts` |
| Plain function modules | `camelCase.ts` | `alarmSupport.ts`, `optionalModule.ts` |
| Shared types | `camelCase.ts` in `packages/types` | `domain.ts`, `enums.ts` |

## Mobile app layout

```
apps/mobile/
├── src/
│   ├── app/               expo-router ROUTES ONLY
│   ├── alarm/             alarm domain, scheduler impls + support detection
│   ├── assets/Stylesheet.ts   design tokens
│   ├── components/{buttons,ui}/
│   ├── i18n/{i18n.ts,languages.ts,translations/}
│   ├── utils/{contexts,hooks,modules}/
│   └── config.ts          EXPO_PUBLIC_* env access
├── modules/alarm-sound/   local Expo native module
└── assets/                images, referenced from app.json
```

## Design tokens

All spacing, type and colour come from `src/assets/Stylesheet.ts`. Named scales, not
numbers: `Spacing.small`, `FontSize.medium`, `Radius.pill`.

Colours go through `useThemeColor({}, 'background')`, never hardcoded, **except** the
ring screen, which is deliberately fixed dark. It is looked at in a dark bedroom by
someone half awake and must never flash white.

## Theming

`ThemeContext` holds a light/dark choice persisted in AsyncStorage, seeded from the
system scheme but overridable by the user. Same shape as `drinking_games_app`.

## i18n

**Every user-facing string lives in `i18n/translations/`. No exceptions, and no
hardcoded fallbacks**, not `?? 'Dismiss'`, not `'Alarm'` as a default parameter.
There is a default language; that is what a missing translation falls back to.

Keys are nested by area (`alarm.*`, `plan.*`, `diagnostics.*`, `harness.*`).

**Dutch is a first-class language, not a translation.** The MVP targets Dutch
commuters on NS trains; `nl` and `en` are both maintained from day one, `nl` is
listed first in `languages.ts`, and `nl` is the initial language.

### Non-React code returns keys, not sentences

Modules outside the React tree, `alarmSupport.ts`, `nativeDiagnostics.ts`, return
**i18n keys** (`reasonKey`, `impactKey`). They have no business deciding what
language the user reads; the component calls `t()`.

### i18n is initialised synchronously

`i18n.ts` calls `init()` at module scope with the default language, then applies the
stored/device preference via `changeLanguage()` a moment later.

This is not a style choice. Notification action titles and the snooze rebuild both
run inside a notifee **background handler**, where there is no React tree and so no
`useTranslation`. With async init those paths could run before it resolved and would
need hardcoded English fallbacks. Synchronous init means `i18n.t()` is safe from
anywhere, including a headless task after the app was killed.

Native module wrappers under `modules/` sit below the app and return `null` rather
than placeholder copy, see `getSoundLabel`.

## HTTP

`Axios` static class in `utils/modules/Axios.ts`, mirroring the other apps. The device
bearer token is read from secure storage per request rather than cached, so onboarding
can register and immediately make an authenticated call.

## The API: where each concern lives

```
routes/groups/*   deviceAuth + validate({ params, body, query }), then the handler
controllers/*     read req.device and req.body, call a service, render the outcome
services/*        the domain. Return outcomes; never write a response
models/*.entity   columns, relations, and toDto()
middleware/*      hold the response, so they answer directly
```

**Refusals are returned, exceptions mean the code is wrong.** A missing place, a
bad payload, a delete something still depends on: all ordinary results of
ordinary requests. Services return them (`Place | null`, the names blocking a
delete, a `ScheduleProblem` union) and controllers turn them into responses.
Throwing is reserved for a route pattern that disagrees with its handler, and
for `NsRateLimitError`, which comes from an HTTP module three layers down where
a result type would cost more than it explains.

**No wrapper around handlers.** Express 5 forwards a rejected promise to the
error middleware by itself. `deviceAuth` guarantees `req.device`, `validate`
guarantees the body, so a handler is the handler. Type it with `Handler<Body,
Params>` from `interfaces/IHttp.ts`; a route with an `:id` also needs
`router.get<IdParams>(...)`, because Express infers params from a literal path
and ours come from `API_ENDPOINTS`.

**A success is the resource, unwrapped; a failure is flat.** There is no
`{ success, data }` envelope, because the status code already carries that. A
refusal is `{ code, message, details }` with a 4xx or 5xx. Lists are bare arrays,
which is a deliberate trade: nowhere to add pagination later, and every list here
is one device's own handful of rows. A collection that could grow unbounded
should be given an object with its own `items` field instead.

**Every response type is named.** `sendSuccess` cannot infer its type argument,
so `sendSuccess<PlaceResponse>(res, place.toDto())` is the only way to call it.
The names live in `@alarm/types`, which the app imports to parse, so a renamed
field breaks both sides at build time instead of rendering `undefined`.

**Answer with a 404, never a 403,** for another device's resource. The device id
goes into the lookup rather than being compared afterwards, so a real id and an
invented one are indistinguishable. Anything else confirms which ids exist.

## Testing the API

`npm test -w @alarm/api` runs 53 integration tests through the real app, router,
middleware, TypeORM and MySQL, via supertest. Unit-testing a service in
isolation would have missed every bug this API has actually produced: decimals
returned as strings, a MySQL TIME arriving as `08:30:00`, Express matching `:id`
before a literal path.

- Credentials come from `.env.test`, chosen by `NODE_ENV`, which vitest sets.
- The schema is migrated once per run, and every table is truncated **before**
  each test, so a failure leaves its rows behind to be looked at.
- The suite refuses to start unless `.env.test` exists and `DB_NAME` ends in
  `_test`. It truncates everything it can see, so the cost of the wrong database
  is total and silent.
- Files run one at a time. They share a database, and parallel workers would
  wipe each other's rows mid-request.
- No test calls NS or TomTom. `TransportProviderFactory.forMode` is spied and
  answers with `FixtureTransportProvider`.

## Linting

`npm run lint` at the root runs every workspace.

Rules are split rather than shared wholesale. `eslint.config.base.mjs` holds what
is as true on the server as in the app: no floating promises, no async function
where a synchronous one is expected, no `any`. Platform rules stay in
`apps/mobile/eslint.config.js`, where `eslint-config-expo` and the native-module
`no-restricted-imports` rule belong; neither means anything to the API.

Type-aware rules are on. They need a TypeScript program and are slower than a
syntax-only pass, and they are the only ones that catch the mistakes that
actually happen here. Turning them on found 11 real problems in the API,
including a `default:` branch the compiler had narrowed to `never` while it
remained reachable from the command line.

`alarm/no-dashes` (in `tools/eslint-plugin-alarm/`) enforces the writing rule
from CLAUDE.md. It scans raw source rather than the AST, because the dashes kept
turning up in comments. It is deliberately not auto-fixable: a dash separating a
label from its description wants a colon, one joining two clauses wants a comma,
and only the sentence says which.

## Native modules, the rule that bit us three times

**Never import a native module at module scope. Ever. No exceptions.**

`AlarmSound`, `expo-notifications` and `@react-native-async-storage/async-storage` each
took the whole app down during M0, in three separate incidents with identical shape.

Two independent reasons a native module can be absent at runtime:

1. **Expo Go** cannot load custom native code at all.
2. **A stale development build.** This is the sneaky one. A dev client freezes its
   native code at build time while JS keeps hot-reloading, so *adding any native
   dependency silently desynchronises the installed app until it is rebuilt.* Nothing
   warns you; it just explodes at runtime.

Why it hurts far more than it should: these modules throw at **import** time, and a
throwing import means every module downstream never finishes evaluating. expo-router
then reports *"Route is missing the required default export"* for screens that are
completely fine, followed by `Cannot read property 'ErrorBoundary' of undefined`. The
error you see names a file that has nothing to do with the actual problem.

### The pattern

- `requireOptionalNativeModule('X')` for Expo modules, returns null rather than throwing
- `loadOptionalModule(() => require('x'))` for everything else, resolved lazily on first use

Then decide deliberately how to degrade:

| Concern | Degrades to | Why |
|---|---|---|
| Theme, language (`Storage.ts`) | In-memory, session-only | A preference is never worth a blank screen |
| Alarm scheduling (`UnsupportedAlarmScheduler`) | Reads no-op, writes **throw** | An alarm believed to be set but incapable of ringing is the worst possible outcome |
| Device token (`Axios.ts`) | **No fallback**, throws | A token that silently evaporates re-registers the device and orphans its schedules |

Never degrade *silently*. `nativeDiagnostics.ts` lists what is missing and the harness
shows a "Rebuild required" banner naming the modules and the exact command, so the
next occurrence is diagnosed by reading one line instead of a stack trace.

### Enforced, not just documented

`eslint.config.js` carries a `no-restricted-imports` rule listing every import-time
unsafe native module. Importing one at module scope is a lint **error** with a message
pointing here. Writing this down was not enough, the same bug recurred four times
across M0, so it is now mechanical.

`react-native-notify-kit` is deliberately *not* on the list: its
`NotifeeNativeModule` constructor explicitly defers native access, so importing it is
safe. Its calls are still guarded, via `alarmSupport.ts`.

Run `npm run lint --workspace=@alarm/mobile` before pushing.

## Writing Kotlin in `modules/alarm-sound`

Nothing on the dev machine compiles Kotlin, so a mistake here is only discovered by
a ~5-minute EAS build. Two rules earned the hard way:

**Never use a valueless `return@AsyncFunction`.** Expo types those lambdas as
`() -> Any?`, so a bare `return@AsyncFunction` fails with
`Return type mismatch: expected 'Any?', actual 'Unit'`. Either return an explicit
value (`return@AsyncFunction null` is fine) or, better, restructure as `if/else` with
no early return at all.

```kotlin
// Fails to compile
AsyncFunction("doThing") {
    if (tooOld) { return@AsyncFunction }   // ← Unit where Any? is expected
    doIt()
}

// Correct
AsyncFunction("doThing") {
    if (!tooOld) { doIt() }
}
```

A lambda whose body *evaluates* to `Unit` is fine, `AsyncFunction("stop") { stopInternal() }`
compiles. The error is specific to a valueless labelled `return`.

**Guard every API-level-gated call** with `Build.VERSION.SDK_INT >= Build.VERSION_CODES.X`,
and give the `else` branch an honest value rather than a convenient one.

## Deviations from the other apps

### 1. Routes live in `src/app/`; everything else sits beside it

`espressions_app` and `drinking_games_app` nest components, utils and assets under
`app/`. We deliberately do not. **Decided 2026-08-09 after checking what expo-router
actually does**, not on taste:

```js
// node_modules/expo-router/_ctx.android.js
require.context(EXPO_ROUTER_APP_ROOT, true, /.../)  // excludes only +api, +html, +middleware
```

Every `.ts`/`.tsx` under the app root becomes a route node. Worse, in development
`validateRouteTreeExports` calls `loadRoute()` on **every** node at startup to check
for a default export. That gives two concrete costs:

- Each non-component file (`Stylesheet.ts`, `useThemeColor.ts`, `alarmSupport.ts`,
  translations, `Axios.ts`) logs *"Route X is missing the required default export."*
  That warning was a genuine signal twice during M0, it is what a throwing native
  import looks like. Burying it under ~20 permanent false positives costs us a
  diagnostic we have already needed.
- Every file gets eagerly required at boot in dev, which is exactly the failure mode
  that broke the app twice (see the native-module rule above). Putting `src/alarm/`
  under the router would hand it straight back into that path.

The escape hatch (`["expo-router", { root: "./src/app/screens" }]`) is documented by
Expo as *"Avoid using this property."*

The practical difference is **one path segment**, folder names and nesting are
otherwise identical to the other apps:

| Other apps | Here |
|---|---|
| `@/app/components/buttons/X` | `@/components/buttons/X` |
| `@/app/utils/hooks/useThemeColor` | `@/utils/hooks/useThemeColor` |
| `@/app/assets/Stylesheet` | `@/assets/Stylesheet` |

**Route organisation still applies.** What the other apps get from `app/screens/{auth,
tabs,settings}/`, we get from expo-router route groups, `src/app/(onboarding)/`,
`src/app/(tabs)/`, added as M1 introduces real screens.
### 2. `packages/types` + `packages/core` replace a per-app `models/` folder

The app and the API must compute the same wake-up time from the same inputs, so the
domain types and the engine live in shared workspace packages rather than being
duplicated on each side.

### 3. No `reset-project` script, and web is not a target

`platforms` is `["android", "ios"]`.

## expo-router: the generated types are not a route map

`.expo/types/router.d.ts` is written by Metro, not by `tsc`, so it describes the
app as it was the last time a dev server ran. Move a route file and TypeScript
will keep enforcing the old shape, which is worse than no types at all: it
rejects the href that works and suggests one that does not.

The failure it caused surfaced as "Unmatched Route" on the device rather than as
an error anywhere a build would catch:

**`resolveHref` does not strip a trailing `/index`.** An index file inside a
dynamic folder is reachable by the router at `/schedules/[id]`, but pushing
`{ pathname: '/schedules/[id]/index' }` builds `/schedules/<id>/index`, which
matches nothing, while pushing `/schedules/[id]` is what the stale types reject.
Naming the segment (`overview.tsx`) makes the route and the link agree, with no
cast and nothing to remember.

A file and a directory **can** share a segment, contrary to what this document
said for a day: `(tabs)/settings.tsx` serves `/settings` while
`settings/disruptions.tsx` serves `/settings/disruptions`, and the same holds for
`/schedules`. The editor sits at `/schedules/[id]/...` rather than
`/schedule/[id]/...` for readability, not because the shorter path was refused.

**After moving or renaming any route, regenerate the types before trusting a
compile error.** Starting the dev server on a spare port for a few seconds is
enough:

```bash
npx expo start --port 8099    # then stop it
```

## Registration is the request layer's job, not the launch order's

Every screen fetches on mount. Registration used to be a separate thing the
launch happened to start first, and on a fresh install those raced: the first
screens sent their requests with no token, each got a 401, and the app said "this
device is no longer recognised" about a device that had simply not finished
introducing itself. Clearing the app's data reproduced it every time, which is
also how anyone testing onboarding will meet it.

`Axios.ensureToken()` now registers on demand, and `config()` awaits it, so no
authenticated request can leave before there is something to authenticate with,
whichever screen asks first. Concurrent callers share one in-flight attempt:
without that, six requests on launch create six devices and the user keeps
whichever wrote its token last.

The rule that follows: **a hook that reports connectivity must never also be the
thing that establishes it.** `useApiConnection` is a reporter now. Anything that
gates UI on it should gate on a known failure (`unreachable`, `not_configured`)
rather than on not-yet-confirmed success, or the one button on an empty screen is
greyed out while a check nobody can see finishes.
