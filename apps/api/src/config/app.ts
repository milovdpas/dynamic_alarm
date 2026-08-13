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
 * Server configuration.
 *
 * The NS and TomTom keys live here and only here. They must never reach
 * `apps/mobile`: anything prefixed `EXPO_PUBLIC_` ships inside the app bundle
 * and is trivially extractable, and NS issues one subscription per account with
 * no published rate limit to absorb abuse.
 */
export const env = {
    nodeEnv: optional('NODE_ENV', 'development'),
    port: Number(optional('PORT', '3000')),

    database: {
        host: optional('DB_HOST', 'localhost'),
        port: Number(optional('DB_PORT', '3306')),
        user: optional('DB_USER', 'root'),
        password: optional('DB_PASSWORD', ''),
        name: optional('DB_NAME', 'dynamic_alarm_db'),
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
