import Storage from '@/utils/modules/Storage';

const STORAGE_KEY = 'alarmSound';

/** A tone the user picked, as the OS describes it. */
export interface ChosenSound {
    /** `content://` on Android. Meaningless to anything but the platform. */
    uri: string;
    /** The OS's own name for it, e.g. "Oxygen", stored so settings can show it. */
    label: string;
}

/**
 * Which tone the alarm plays, chosen by the user and carried with each alarm.
 *
 * Every piece of this existed and nothing joined them up: the ringtone picker
 * worked, `AlarmRequest.soundUri` was already in the interface, the Android
 * scheduler already forwarded it, and `AlarmService` already played it. The
 * picker was reachable only from the debug panel, where it previewed a sound and
 * forgot it, so every alarm rang on the system default.
 *
 * **The label is stored alongside the URI on purpose.** Reading it back from the
 * OS costs a native call and fails for a tone that has since gone away, and the
 * settings row still has to say something. A remembered name is the honest thing
 * to show for a choice somebody made.
 *
 * **The URI is carried with the alarm rather than looked up when it fires.**
 * After a reboot the alarm is re-armed by the boot receiver from native storage,
 * with no JavaScript running and no way to read a preference, so a sound that
 * lived only in app storage would silently revert to the default exactly when
 * the phone was least likely to be watched.
 */
export async function readChosenSound(): Promise<ChosenSound | null> {
    const raw = await Storage.getItem(STORAGE_KEY);
    if (raw === null) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw) as Partial<ChosenSound>;
        // Both fields or neither. A URI with no label would render as an empty
        // row, and a label with no URI would arm an alarm that plays nothing.
        return typeof parsed.uri === 'string' && typeof parsed.label === 'string'
            ? { uri: parsed.uri, label: parsed.label }
            : null;
    } catch {
        return null;
    }
}

export async function writeChosenSound(sound: ChosenSound | null): Promise<void> {
    if (sound === null) {
        await Storage.removeItem(STORAGE_KEY);
        return;
    }
    await Storage.setItem(STORAGE_KEY, JSON.stringify(sound));
}

/**
 * The URI to arm an alarm with, or null for the system default.
 *
 * Null is a real answer rather than a missing one: the native service falls back
 * to `Settings.System.DEFAULT_ALARM_ALERT_URI` when it is given nothing, which
 * is what somebody who has never opened this setting expects to hear.
 *
 * Never throws. An alarm that failed to arm because a *preference* could not be
 * read would be the worst possible trade, so a broken store means the default
 * tone rather than no alarm.
 */
export async function resolveAlarmSoundUri(): Promise<string | null> {
    try {
        return (await readChosenSound())?.uri ?? null;
    } catch {
        return null;
    }
}
