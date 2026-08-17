import { loadOptionalModule } from './optionalModule';

type UpdatesModule = typeof import('expo-updates');

/** Which JavaScript this app is running, and where it came from. */
export interface RunningBundle {
    /** False when the bundle is the one compiled into the APK. */
    fromUpdate: boolean;
    /** The update's id, or null when running the embedded bundle. */
    updateId: string | null;
    /** When that update was published. */
    publishedAt: string | null;
    /** The release channel this build listens to, e.g. `preview`. */
    channel: string | null;
    /** Which builds an update must match to be offered at all. */
    runtimeVersion: string | null;
}

/**
 * What the phone is actually running, for the debug panel.
 *
 * Over-the-air updates make this a real question for the first time. A build no
 * longer implies its JavaScript: the APK is from one day, the bundle inside it
 * may be from another, and the only visible difference is behaviour somebody has
 * to notice. "Did the update land" was unanswerable from the phone, and
 * answering it by looking for a feature is guesswork.
 *
 * `expo-updates` reports nothing useful in development, where Metro serves the
 * bundle, so this is honest about running embedded rather than inventing an id.
 */
export function readRunningBundle(): RunningBundle | null {
    const updates = loadOptionalModule(() => require('expo-updates') as UpdatesModule);
    if (updates === null) {
        return null;
    }

    try {
        return {
            fromUpdate: !updates.isEmbeddedLaunch,
            updateId: updates.updateId,
            publishedAt: updates.createdAt?.toISOString() ?? null,
            channel: updates.channel,
            runtimeVersion: updates.runtimeVersion,
        };
    } catch {
        // Reading these throws when the module is present but disabled, which is
        // every development build. Not knowing is a fine answer; crashing the
        // diagnostics screen over it is not.
        return null;
    }
}
