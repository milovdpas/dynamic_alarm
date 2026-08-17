# Dynamic Alarm

A smart alarm for the Netherlands. The wake-up time is derived from a live journey
rather than set by hand: arrival deadline, morning routine, and real NS/TomTom travel
conditions decide when you get woken.

## Read these first

| Doc | What it holds |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | Architecture and the MVP milestones. The source of truth. |
| [docs/PROGRESS.md](docs/PROGRESS.md) | Live status, device verification checklist, decisions log. Update it as work lands. |
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | Code style, structure, and the rules that were learned the hard way. |

## Writing style

**Never use long dashes.** Not the em dash (U+2014), not the en dash (U+2013). Use a
comma, a colon, a full stop, or parentheses. This covers user-facing strings, code
comments, documentation, commit messages, and chat replies.

Rewrite the sentence rather than swapping in a hyphen. A dash separating a label from
its description usually wants a colon; one joining two clauses usually wants a comma
or a full stop.

```
Bad:   'Volume is muted [dash] you will not hear this.'
Good:  'Volume is muted, so you will not hear this.'

Bad:   'M0 [dash] alarm harness'
Good:  'M0: alarm harness'
```

**All user-facing copy lives in `apps/mobile/src/i18n/translations/`.** No hardcoded
strings, and no fallbacks like `?? 'Dismiss'`. There is a default language; that is
what a missing translation falls back to. Dutch and English are both maintained, with
Dutch first.

## The rules that keep biting

These each cost real debugging time. Full explanations live in CONVENTIONS.md.

1. **Never import a native module at module scope.** They throw at *import* time when
   absent (Expo Go, or a development build older than the dependency), which stops
   every downstream module from evaluating and produces errors pointing at innocent
   files. Use `loadOptionalModule()` or `requireOptionalNativeModule()`. There is an
   ESLint rule enforcing this.
2. **A development build freezes its native code.** Adding any native dependency
   desynchronises every installed build until it is rebuilt. The harness shows a
   "Rebuild required" banner naming what is missing.
3. **Never write a valueless `return@AsyncFunction`** in the Kotlin module. Expo types
   those lambdas as `() -> Any?`. Use `if/else` instead.
4. **Degrade honestly, never silently.** An alarm the user believes is set but which
   cannot ring is the worst possible outcome. Reads may no-op; writes throw.

## Layout

```
apps/mobile     Expo SDK 57 app. Routes in src/app/ only, everything else beside it.
apps/api        Express 5 + TypeORM + Knex. Not built yet.
packages/types  Shared domain types, DTOs, tuning constants.
packages/core   Wake-time engine, risk buffers, monitor cadence, transport adapters.
                Shared so the app and API compute identical answers.
```

## Commands

```bash
npm run build:packages                   # required before type-checking apps/api
npm run dev:mobile                       # Metro, development build
npm run start:go -w @alarm/mobile        # Expo Go, alarms disabled but app runs
npm test -w @alarm/core                  # engine tests
npx tsc --noEmit                         # in apps/mobile
npx expo lint                            # in apps/mobile

npx eas build --profile development --platform android   # day-to-day iteration
npx eas build --profile preview --platform android       # verification
npx eas update --branch preview --environment preview  # JS only, no build needed
```

**Iterate on `development`, verify on `preview`.** A development build loads its
JavaScript from Metro over the network, so after a reboot or with the laptop
asleep the native alarm rings but no screen can load. Anything involving reboot,
force-quit, or "does this actually work" gets a `preview` build, which bundles the
JS into the APK and has no dev launcher.

Nothing on the dev machine compiles Kotlin, so native errors only surface in a cloud
build. Verify TypeScript and lint before asking for one.
