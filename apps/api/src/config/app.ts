import 'dotenv/config';

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
