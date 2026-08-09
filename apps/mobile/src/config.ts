/**
 * Runtime config from `EXPO_PUBLIC_*` env vars.
 *
 * Anything here ships inside the app bundle and is trivially extractable, so it
 * holds only non-secrets. The NS and TomTom keys live exclusively in
 * `apps/api/.env` and are never read from this file.
 */
export default {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000',
    debug: process.env.EXPO_PUBLIC_DEBUG === 'true',
};
