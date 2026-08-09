import { loadOptionalModule } from './optionalModule';

type AsyncStorageModule = typeof import('@react-native-async-storage/async-storage').default;

/**
 * Key-value storage for preferences, with an in-memory fallback.
 *
 * AsyncStorage is a *native* module, so it only exists if the installed binary
 * was built after it was added to package.json. During development that is
 * routinely false: JS hot-reloads instantly, but a dev client keeps whatever
 * native code it was compiled with, so adding any native dependency silently
 * desynchronises the running app until it is rebuilt.
 *
 * Left unguarded that turns a missing convenience into a blank screen, the app
 * failed to mount entirely because the theme could not remember a colour scheme.
 * Preferences are simply not important enough to take the app down with them, so
 * a missing native module degrades to memory-only storage that lasts the session.
 *
 * {@link isPersistent} reports the truth so the UI can say the setting will not
 * survive a restart, rather than quietly forgetting it.
 */

let native: AsyncStorageModule | null | undefined;

function getNative(): AsyncStorageModule | null {
    if (native === undefined) {
        native = loadOptionalModule(
            () =>
                require('@react-native-async-storage/async-storage').default as AsyncStorageModule,
        );
    }
    return native;
}

/** Survives only until the app is killed. */
const memory = new Map<string, string>();

/** False when running on a binary that predates the AsyncStorage dependency. */
export function isPersistent(): boolean {
    return getNative() !== null;
}

export default class Storage {
    static async getItem(key: string): Promise<string | null> {
        const store = getNative();
        if (store === null) {
            return memory.get(key) ?? null;
        }
        try {
            return await store.getItem(key);
        } catch {
            // The module resolved but the native side is absent, same outcome.
            return memory.get(key) ?? null;
        }
    }

    static async setItem(key: string, value: string): Promise<void> {
        memory.set(key, value);
        const store = getNative();
        if (store === null) {
            return;
        }
        try {
            await store.setItem(key, value);
        } catch {
            // Kept in memory above, so the value still applies this session.
        }
    }

    static async removeItem(key: string): Promise<void> {
        memory.delete(key);
        const store = getNative();
        if (store === null) {
            return;
        }
        try {
            await store.removeItem(key);
        } catch {
            // Nothing further to do; the in-memory copy is already gone.
        }
    }
}
