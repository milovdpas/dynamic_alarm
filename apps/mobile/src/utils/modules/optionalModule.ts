/**
 * Loads a module that may throw at *import* time.
 *
 * Several Expo packages abort on import rather than on use when they are not
 * supported by the current runtime, `expo-notifications` does exactly this in
 * Expo Go on Android since SDK 53. A throwing import is unusually nasty because
 * the failure surfaces far from its cause: every module downstream fails to
 * evaluate too, so expo-router reports "Route is missing the required default
 * export" for screens that are perfectly fine, and the whole app fails to mount.
 *
 * Pass a thunk containing a literal `require` so Metro can still see the
 * dependency at build time:
 *
 * ```ts
 * const notifications = loadOptionalModule(() => require('expo-notifications'));
 * ```
 */
export function loadOptionalModule<T>(load: () => T): T | null {
    try {
        return load();
    } catch {
        return null;
    }
}
