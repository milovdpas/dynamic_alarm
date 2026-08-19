# Deploying the API

Target: **https://dynamic-alarm-api.milovanderpas.nl**

Follows the house pattern documented in `~/Documents/2026/vps/`: Dockerfile in the
repo, image on Docker Hub, `docker-compose.prod.yml` rsynced to the VPS, GitHub
Actions builds and deploys, nginx exposes it on a domain.

```
push to main (apps/api/** or packages/**)
  -> Actions builds apps/api/Dockerfile with the repo root as context
  -> pushes milovdpas8/dynamic-alarm-api:latest and :<sha>
  -> renders apps/api/.env.dist through envsubst with the repo secrets
  -> rsyncs docker-compose.prod.yml + .env to /opt/apps/dynamic-alarm-api/
  -> docker compose pull && up -d, waits for healthy
  -> runs Knex migrations inside the container
```

## The database is not on the VPS

Nothing on that server runs a database. Both existing APIs use an external MySQL
reached through `DB_*` secrets, and this API does the same.

Two consequences worth knowing before the first deploy:

- **The MySQL host must accept connections from `159.195.28.227`.** Shared
  hosting usually refuses remote connections until the IP is whitelisted, and the
  symptom is a container that builds, starts, and then fails its health check
  with a connection timeout.
- **Create the database first.** The migrations create tables, not the schema
  itself.

## Repository secrets

Settings → Secrets and variables → Actions. The first five are the same names
used by every other project here, so a future VPS move is one update.

| Name | Value |
|---|---|
| `DOCKERHUB_USERNAME` | `milovdpas8` |
| `DOCKERHUB_TOKEN` | Docker Hub access token |
| `VPS_HOST` | `159.195.28.227` |
| `VPS_USER` | `deploy` |
| `VPS_SSH_PRIVATE_KEY` | the CI deploy private key |
| `DB_HOST` | external MySQL host |
| `DB_PORT` | `3306` |
| `DB_USER` | database user |
| `DB_PASSWORD` | database password |
| `DB_NAME` | database name |
| `NS_SUBSCRIPTION_KEY` | apiportal.ns.nl, `Ns-App` product |
| `TOMTOM_API_KEY` | developer.tomtom.com |
| `MONITOR_TOKEN` | any long random string, generated once |

`MONITOR_TOKEN` guards `POST /api/v1/monitor/tick`, which the scheduler calls
every minute. It is not a device token: the tick belongs to no device, and giving
the scheduler a phone's credential would let a stolen token drive the loop for
everyone. Generate it with `openssl rand -hex 32` and never put it anywhere else.

The workflow fails loudly when `DB_HOST`, `DB_USER`, `DB_NAME`,
`NS_SUBSCRIPTION_KEY`, `TOMTOM_API_KEY` or `MONITOR_TOKEN` render empty. `envsubst` turns an unset
variable into an empty string rather than an error, and without a transport key
the API starts happily and only fails when the first journey is planned, which is
the middle of the night for whoever is relying on it.

## DNS

One A record:

```
dynamic-alarm-api.milovanderpas.nl  ->  159.195.28.227
```

Check it before issuing the certificate, since HTTP-01 needs it resolving:

```bash
dig +short dynamic-alarm-api.milovanderpas.nl
```

## Proxy and certificate, on the VPS

nginx refuses to start if a conf references a certificate that does not exist,
so the conf is written disabled, the certificate is issued, then it is enabled.

```bash
cd /opt/apps/proxy

# 1. Conf, disabled for now.
cat > conf.d/dynamic-alarm-api.conf.disabled <<'EOF'
server {
    listen 443 ssl;
    http2 on;
    server_name dynamic-alarm-api.milovanderpas.nl;

    ssl_certificate     /etc/letsencrypt/live/dynamic-alarm-api.milovanderpas.nl/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dynamic-alarm-api.milovanderpas.nl/privkey.pem;

    location / {
        proxy_pass http://dynamic-alarm-api:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# 2. Certificate.
docker compose up -d
docker compose run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
  -d dynamic-alarm-api.milovanderpas.nl \
  --email vanderpasmilo@gmail.com --agree-tos --no-eff-email

# 3. Enable and reload.
mv conf.d/dynamic-alarm-api.conf.disabled conf.d/dynamic-alarm-api.conf
docker exec proxy nginx -t && docker exec proxy nginx -s reload
```

No `client_max_body_size` override. The largest request this API takes is a plan
preview carrying two coordinate pairs, which is nowhere near the 1 MB default.

## First deploy

The app container has to exist before nginx can proxy to it, so run the workflow
first: **Actions → Deploy API to VPS → Run workflow**, or push a change under
`apps/api/**`.

Then:

```bash
docker ps | grep dynamic-alarm-api          # Up (healthy)
curl -s https://dynamic-alarm-api.milovanderpas.nl/api/v1/health
```

Health reports the database as its own field rather than folding it into one
boolean, because a process that is up but cannot reach MySQL is exactly the state
where the monitor loop stops moving alarms:

```json
{ "status": "ok", "database": true, "uptime": 12.4, "timestamp": "..." }
```

## Pointing the app at it

Once the domain answers, set the EAS environment variable for the profile you are
building. Gitignored `.env` files are not uploaded to EAS Build, so this cannot
come from `apps/mobile/.env`:

```sh
eas env:set --name EXPO_PUBLIC_API_URL \
  --value https://dynamic-alarm-api.milovanderpas.nl \
  --environment preview --visibility plaintext
```

An HTTPS value also switches off the cleartext permission by itself:
`withCleartextDevApi` only touches the manifest while the URL starts with
`http://`.

## Not every dependency hoists

The runtime image copies `node_modules` from the root **and from each
workspace**. npm nests a package under the workspace that needs it whenever the
root already holds a different version, and `npm prune --omit=dev` then deletes
the hoisted copy and keeps the nested one. `zod` does exactly that: after the
prune it exists only at `apps/api/node_modules/zod`.

Copying only the root left the first deploy crash-looping on
`Cannot find module 'zod'`. Worth knowing because the failure is invisible until
runtime: the image builds, the container starts, and it dies inside the require
chain that wires the routes.

## Migrations

Run by the workflow after the container is healthy, from inside the image, which
is the only place the schema history exists:

```bash
docker compose exec -T api npx knex migrate:latest --knexfile dist/database/knexfile.js
```

The knexfile detects whether it is running as source or as build and looks for
`.ts` or `.js` migrations accordingly. Hardcoding `.ts` made a production
`migrate:latest` find nothing and report success, which is the worst way to fail:
the deploy goes green and the schema is simply absent.

To roll one back by hand, `05-operations.md` on the VPS has the general pattern;
the command is the same with `migrate:rollback`.

## The monitor loop runs on the scheduler, not inside the process

The tick is a route (`POST /api/v1/monitor/tick`) driven from outside, and
`docker-compose.prod.yml` declares the schedule as Ofelia labels on the service:

```yaml
labels:
    ofelia.enabled: 'true'
    ofelia.job-exec.monitor-tick.schedule: '@every 1m'
    ofelia.job-exec.monitor-tick.command: 'node dist/tools/monitorTick.js'
```

That is the VPS convention (`vps_hosting/03-architecture.md`): app jobs are
labels in the app's own compose file, picked up by the `scheduler` container over
the Docker socket, so the schedule deploys through CI rather than being
configured by hand on the server.

`job-exec` rather than `job-run`, because the tick has to reach the process that
is already up. The database pool and the provider caches live there, and a fresh
container each minute would reconnect to an external MySQL across the internet to
discover, most minutes, that there is nothing due. The command carries no secret;
the script reads `MONITOR_TOKEN` from the container's own environment.

## Reading the logs

Everything written with `console.log` or `console.error` goes to stdout and Docker
keeps it. There are **two** places to look, and which one holds a given line
depends on which process wrote it.

```bash
cd /opt/apps/dynamic-alarm-api

docker compose logs -f --tail=100    # the API process
docker compose logs --since 1h       # a window instead of a follow
docker compose logs --since 10m api  # one service, recent

docker logs scheduler --tail=50      # the Ofelia scheduler, one line per tick
docker logs -f scheduler             # follow it
```

**The split matters.** The tick's summary line is printed by the small script
Ofelia runs, so it lands in the **scheduler** log:

```
NOTICE [Job "monitor-tick" (…)] Started - node dist/tools/monitorTick.js
NOTICE [Job "monitor-tick" (…)] StdOut: Tick: 14 disruptions, 0 promoted, claimed 0, moved 0, unchanged 0, failed 0 in 412ms.
NOTICE [Job "monitor-tick" (…)] Finished in "812ms", failed: false, skipped: false, error: none
```

Anything the loop itself writes is printed inside the API process, so it lands in
the **api** log instead:

```
Monitor failed on occurrence <id>: …
Push for occurrence <id>: NO_TOKEN
```

That is the pair to remember: if alarms are not moving, the scheduler log says
whether the tick ran at all, and the api log says what it found when it did.

### The first question is whether the job exists at all

Ofelia reads container labels **when the scheduler itself starts**, not when a
labelled container appears. The precise rule, both halves of it observed on this
host:

- A job it has **already registered survives its container being recreated**.
  The neighbouring app's hourly job was registered on 2026-07-19, its container
  was recreated on 2026-07-22, and it has run every hour since.
- A job that **did not exist when the scheduler last started is never picked
  up**, however correct its labels are.

This is not hypothetical. The tick never ran once in production until the evening
of 2026-08-19: the labels on `dynamic-alarm-api` were correct the whole time, and
the scheduler had last read them on **2026-07-19**, a month before this API first
deployed. Its log had one job in it, belonging to a different app.

From a phone the symptom is indistinguishable from push being broken. The alarm
simply never moves, and every device-side explanation looks plausible, which is
how it cost an evening of looking at the app instead of the server.

```bash
docker logs scheduler 2>&1 | grep 'job registered'
```

Two lines, one of them `monitor-tick`, means the job exists. One line, or none,
means the tick has not been running however healthy everything else looks.

The deploy now restarts the scheduler after the container is up and fails if
`monitor-tick` does not come back, so this cannot recur silently. To fix it by
hand, on a host where an old scheduler is still running:

```bash
docker restart scheduler
docker logs scheduler --tail=20 | grep 'job registered'
```

The restart re-scans every labelled container on the host, so it restores other
apps' jobs at the same time rather than only this one.

A quiet night is `claimed 0` every minute, with a non-zero disruption count: NS
almost always has something active somewhere, and `promoted 0` means none of it
touches a station anybody's alarm travels through. That is correct rather than broken:
only occurrences whose `nextCheckAt` has arrived are claimed.

To force one tick by hand, exactly as the scheduler would:

```bash
docker compose exec -T api node dist/tools/monitorTick.js
```

**If `monitor-tick` never appears in the scheduler log**, the labels have not been
picked up. Ofelia reads them over the Docker socket and usually notices a
redeployed container on its own; the guaranteed fix is:

```bash
cd /opt/apps/scheduler && docker compose restart
```

Logs are not rotated. The json-file driver grows without a size limit on this
host, and a per-minute line is small but never stops, so `docker system df` is
worth a look occasionally. `docker image prune -af` reclaims far more.

## Afterwards

Add the app to the table in `vps/03-architecture.md` and the domain list in
`vps/README.md`, the way every other project there is recorded.
