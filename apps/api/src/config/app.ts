import path from 'node:path';
import { config as loadEnvFile } from 'dotenv';

/**
 * Tests read `.env.test`, everything else reads `.env`.
 *
 * Vitest sets `NODE_ENV=test` before any of this is imported, so the choice is
 * made once and cannot be changed later by anything that runs afterwards.
 *
 * The path is resolved against this file rather than the working directory. A
 * relative path would load a different file depending on whether the command
 * was run from the repo root or from `apps/api`, and the failure mode is a test
 * run pointed at the development database.
 *
 * `tests/globalSetup.ts` refuses to run unless the resulting database name ends
 * in `_test`, which is the check that actually stops that happening.
 */
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
loadEnvFile({ path: path.resolve(__dirname, '../..', envFile) });

function required(name: string): string {
    const value = process.env[name];
    if (value === undefined || value.trim() === '') {
        throw new Error(
            `${name} is not set. Copy .env.example to .env and fill it in. See docs/PLAN.md.`,
        );
    }
    return value;
}

function optional(name: string, fallback: string): string {
    const value = process.env[name];
    return value === undefined || value.trim() === '' ? fallback : value;
}

/**
 * A port, or a refusal to start.
 *
 * `Number()` turns anything unparseable into `NaN`, and `app.listen(NaN)` binds
 * a random free port without complaining. The deployment then looks healthy and
 * is unreachable, which is the same failure the production branch of
 * `listenOnFreePort` exists to prevent, arriving through a different door.
 */
function port(name: string, fallback: string): number {
    return integer(name, fallback, 1, 65535);
}

/**
 * A whole number in range, or a refusal to start.
 *
 * Every numeric setting goes through this, because the failure `Number()` gives
 * is silent in a different way each time. A bad `PORT` becomes `NaN` and
 * `app.listen(NaN)` picks a random free port, so the deployment looks healthy
 * and is unreachable. A bad `TRUST_PROXY_HOPS` becomes `NaN` too, and Express
 * compares `i < NaN`, which is false for every hop, so it trusts nothing and
 * every caller behind the proxy shares one rate-limit bucket keyed on nginx.
 *
 * Both are the same mistake, and the second one shipped in a file that already
 * contained the validator written to prevent the first.
 */
function integer(name: string, fallback: string, min: number, max: number): number {
    const raw = optional(name, fallback);
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new Error(
            `${name} is "${raw}", which is not a whole number between ${String(min)} and ${String(max)}.`,
        );
    }
    return value;
}

/** Whether a flag is on. Anything but a literal `true` is off. */
function flag(name: string): boolean {
    return optional(name, 'false').trim().toLowerCase() === 'true';
}

/**
 * Server configuration.
 *
 * The NS and TomTom keys live here and only here. They must never reach
 * `apps/mobile`: anything prefixed `EXPO_PUBLIC_` ships inside the app bundle
 * and is trivially extractable, and NS issues one subscription per account with
 * no published rate limit to absorb abuse.
 */
export const env = {
    nodeEnv: optional('NODE_ENV', 'development'),
    port: port('PORT', '3000'),

    database: {
        host: optional('DB_HOST', 'localhost'),
        port: port('DB_PORT', '3306'),
        user: optional('DB_USER', 'root'),
        password: optional('DB_PASSWORD', ''),
        name: optional('DB_NAME', 'dynamic_alarm_db'),
    },

    /**
     * Shared secret for the monitor tick, which the scheduler calls and the app
     * never does.
     *
     * Not `required()`: reading it at startup would refuse to boot a deployment
     * that has not set it, and an API that serves the app is worth more than one
     * that refuses everything because its cron secret is missing. The route
     * itself answers 503 instead, so the failure shows up in the scheduler's log
     * rather than in the alarm.
     */
    monitorToken: optional('MONITOR_TOKEN', ''),

    /**
     * How many reverse proxies sit between a caller and this process.
     *
     * Read by `app.set('trust proxy', ...)`, which decides what `req.ip` is, and
     * the rate limiters key on that. One hop in production, where nginx owns
     * ingress; none in development, where nothing is in front. Configurable
     * because the deployment shape is not something the code can know, and wrong
     * in either direction has a real cost: too trusting and a caller picks their
     * own rate-limit key with a header, too suspicious and everybody shares the
     * proxy's address and one bucket.
     */
    trustProxyHops: integer(
        'TRUST_PROXY_HOPS',
        process.env.NODE_ENV === 'production' ? '1' : '0',
        0,
        // A chain longer than this is not a topology, it is a header somebody
        // wrote by hand.
        10,
    ),

    /**
     * Whether `GET /api/v1/ip` is served at all.
     *
     * Off unless asked for. The route is a diagnostic: it reflects the proxy
     * chain and every non-credential header back to an unauthenticated caller,
     * which is exactly what makes it useful and exactly why it should not be a
     * permanent feature of a public deployment. A flag means it can be turned
     * off again without a deploy, and means "temporary" is enforced by something
     * other than remembering.
     *
     * Read on each call rather than frozen at import, like the provider keys
     * above. Nothing calls it in a hot path, and it lets a test build one app
     * with the route and one without instead of the suite inheriting whichever
     * value happened to be set when the module first loaded.
     */
    ipDiagnostic(): boolean {
        return flag('IP_DIAGNOSTIC');
    },

    transport: {
        /** `Ns-App` product subscription key from apiportal.ns.nl. */
        nsSubscriptionKey: () => required('NS_SUBSCRIPTION_KEY'),
        nsBaseUrl: optional('NS_BASE_URL', 'https://gateway.apiportal.ns.nl'),
        tomtomApiKey: () => required('TOMTOM_API_KEY'),
        tomtomBaseUrl: optional('TOMTOM_BASE_URL', 'https://api.tomtom.com'),
    },

    isProduction(): boolean {
        return this.nodeEnv === 'production';
    },
};
