# Dynamic Alarm

A smart alarm for the Netherlands. The wake-up time is derived from a live
journey rather than set by hand: arrival deadline, morning routine, and real NS
and TomTom travel conditions decide when you get woken.

The alarm is never late because of an infrastructure failure. The phone holds an
OS-level alarm at a pessimistic time before anything else runs, and the server
only ever moves it later, so a dropped push, a dead backend or a phone in
flight mode means waking slightly early rather than missing a train.

## Documentation

| Doc | What it holds |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | Architecture and the MVP milestones. The source of truth. |
| [docs/PROGRESS.md](docs/PROGRESS.md) | Live status, device verification checklist, decisions log. |
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | Code style, structure, and the rules learned the hard way. |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | The API on the VPS: secrets, proxy, migrations, **reading the logs**. |
| [docs/postman/](docs/postman/) | Two collections: the endpoints the app calls, and everything it does not. |

## Layout

```
apps/mobile     Expo SDK 57 app. Routes in src/app/ only, everything else beside it.
apps/api        Express 5 + TypeORM + Knex, MySQL.
packages/types  Shared domain types, DTOs, tuning constants.
packages/core   Wake-time engine, risk buffers, monitor cadence, transport adapters.
                Shared so the app and the API compute identical answers.
```

## One file this repository does not contain

`apps/mobile/google-services.json` is gitignored. It is not secret, since every
value in it ships inside the APK, but this repository is public and the Android
API key it carries is better restricted than published. Builds get it from the
EAS file variable `GOOGLE_SERVICES_JSON`, read by `app.config.js`.

A fresh clone needs it locally before `expo prebuild` or a development build:

```sh
cd apps/mobile
eas env:pull --environment development    # writes the file back out
```

Without it, prebuild fails naming the missing file, and any build that somehow
gets past that produces an app that cannot register for push.

## Commands

```bash
npm run build:packages                   # required before type-checking apps/api
npm run dev:mobile                       # Metro, development build
npm run dev -w @alarm/api                # the API against the local database
npm test -w @alarm/core                  # engine tests
npm test -w @alarm/api                   # API tests, against .env.test
npm run tick -w @alarm/api               # force one monitor pass locally

npx eas build --profile development --platform android   # day-to-day iteration
npx eas build --profile preview --platform android       # verification
npx eas update --branch preview --environment preview  # JS only, no build needed
```

Iterate on `development`, verify on `preview`. A development build loads its
JavaScript from Metro over the network, so anything involving a reboot, a
force-quit or "does this actually work" needs a `preview` build, which bundles
the JS into the APK.

## Production

The API runs at **https://dynamic-alarm-api.milovanderpas.nl**, deployed by
GitHub Actions on every push to `main` that touches `apps/api/**` or
`packages/**`.

The monitor loop is a per-minute Ofelia job declared in
[docker-compose.prod.yml](docker-compose.prod.yml), so its schedule deploys with
the code rather than being configured by hand on the server. Its output and the
API's own logs live in two different containers, which is the first thing to know
when alarms stop moving:

```bash
cd /opt/apps/dynamic-alarm-api
docker compose logs -f --tail=100   # the API process: monitor errors, push outcomes
docker logs scheduler --tail=50     # the tick itself, one line per minute
```

[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) explains what each of those lines means
and what to do when the tick stops appearing.
