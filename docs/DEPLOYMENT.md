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

The workflow fails loudly when `DB_HOST`, `DB_USER`, `DB_NAME`,
`NS_SUBSCRIPTION_KEY` or `TOMTOM_API_KEY` render empty. `envsubst` turns an unset
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

## Afterwards

Add the app to the table in `vps/03-architecture.md` and the domain list in
`vps/README.md`, the way every other project there is recorded.
