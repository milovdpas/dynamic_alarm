import Constants from 'expo-constants';

/**
 * Runtime config from `EXPO_PUBLIC_*` env vars.
 *
 * Anything here ships inside the app bundle and is trivially extractable, so it
 * holds only non-secrets. The NS and TomTom keys live exclusively in
 * `apps/api/.env` and are never read from this file.
 */

/** Where `npm run dev:api` listens unless it had to move. */
const DEFAULT_API_PORT = 3000;

/**
 * The API's address as the phone sees it, or null when it cannot be known.
 *
 * An explicit `EXPO_PUBLIC_API_URL` always wins. Without one, the host serving
 * Metro is used, which during development is the same machine running the API,
 * so a development build works on a real phone with nothing configured. That is
 * worth having: the alternative is a hardcoded address that is wrong on every
 * machine but the one it was written on.
 *
 * It returns null rather than guessing when there is no Metro host, which is
 * every preview and production build. A default of `localhost` would be worse
 * than nothing, because on a phone it resolves to the phone, so every request
 * would fail with a connection error that points at the network rather than at
 * the missing configuration.
 *
 * The inferred port can still be wrong. The API moves to the next free port
 * when 3000 is taken and says so on startup, and nothing about that is visible
 * from here. Set the variable when it happens.
 */
function resolveApiUrl(): string | null {
    const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
    if (configured !== undefined && configured !== '') {
        return configured.replace(/\/+$/, '');
    }

    // e.g. "192.168.1.10:8081", the machine running Metro. Absent in any build
    // that does not load its JavaScript from a dev server.
    const host = Constants.expoConfig?.hostUri?.split(':')[0];
    if (host === undefined || host === '') {
        return null;
    }
    return `http://${host}:${String(DEFAULT_API_PORT)}`;
}

const apiUrl = resolveApiUrl();

export default {
    apiUrl,
    /**
     * From app.json, and the value the debug panel will hide behind. Falls back
     * to a marker rather than an invented number: the API records this against
     * the device, and a wrong version there is worse than an obvious gap.
     */
    appVersion: Constants.expoConfig?.version ?? 'unknown',
    /** True when the address was inferred rather than configured. */
    apiUrlInferred: apiUrl !== null && (process.env.EXPO_PUBLIC_API_URL ?? '') === '',
    debug: process.env.EXPO_PUBLIC_DEBUG === 'true',
    /**
     * Opens the diagnostics panel, after ten taps on the version.
     *
     * **Not a secret and never treated as one.** It is inlined into the bundle
     * at build time and anyone who wants it can read it out of the APK. Its job
     * is to stop someone stumbling in, which is the whole requirement: the panel
     * shows the user their own device's diagnostics and nothing belonging to
     * anyone else. Nothing that would matter if it leaked may be put there.
     */
    debugPassword: process.env.EXPO_PUBLIC_DEBUG_PASSWORD ?? 'wakeup',
};
