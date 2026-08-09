import { Platform } from 'react-native';

import AlarmSound from './src/AlarmSoundModule';
import type {
    AlarmDiagnostics,
    AlarmSoundChoice,
    AlarmVolumeInfo,
    MissedAlarm,
    NativeAlarmConfig,
    PlayOptions,
    RingingAlarm,
} from './src/AlarmSound.types';

export type {
    AlarmDiagnostics,
    AlarmSoundChoice,
    AlarmVolumeInfo,
    MissedAlarm,
    NativeAlarmConfig,
    PlayOptions,
    RingingAlarm,
};

/* -------------------------------------------------------------------------- */
/* Native alarm scheduling                                                     */
/*                                                                             */
/* The alarm is registered with the system and rung by a native service, so it */
/* works with the app killed or the phone freshly rebooted. JavaScript only    */
/* schedules and reads state; it is never on the path between the alarm being  */
/* due and the phone making noise.                                             */
/* -------------------------------------------------------------------------- */

export async function scheduleNativeAlarm(config: NativeAlarmConfig): Promise<void> {
    if (AlarmSound === null) {
        throw new Error('The native alarm module is missing from this build.');
    }
    await AlarmSound.scheduleAlarm(config);
}

export async function cancelNativeAlarm(id: string): Promise<void> {
    await AlarmSound?.cancelAlarm(id);
}

export async function cancelAllNativeAlarms(): Promise<void> {
    await AlarmSound?.cancelAllAlarms();
}

export async function getScheduledAlarmIds(): Promise<string[]> {
    return (await AlarmSound?.getScheduledAlarmIds()) ?? [];
}

/**
 * Alarms that were due while the device was off.
 *
 * A phone that reboots overnight and is not unlocked has no alarm that morning,
 * because BOOT_COMPLETED only arrives after the first unlock. Nothing can fix
 * that, but the user is owed an explanation for the silence.
 */
export async function getMissedAlarms(): Promise<MissedAlarm[]> {
    return (await AlarmSound?.getMissedAlarms()) ?? [];
}

/**
 * What the native side actually did, and when.
 *
 * Exists because a broadcast receiver leaves no trace a user can read, and
 * "did BOOT_COMPLETED fire?" cannot be answered by reasoning from symptoms.
 */
export async function getAlarmDiagnostics(): Promise<AlarmDiagnostics | null> {
    return (await AlarmSound?.getAlarmDiagnostics()) ?? null;
}

/**
 * Whether the app is exempt from battery optimisation.
 *
 * A restricted app can be denied broadcasts including BOOT_COMPLETED, which is
 * how an alarm quietly stops surviving reboots.
 */
export async function isIgnoringBatteryOptimizations(): Promise<boolean> {
    return (await AlarmSound?.isIgnoringBatteryOptimizations()) ?? false;
}

export async function requestIgnoreBatteryOptimizations(): Promise<void> {
    await AlarmSound?.requestIgnoreBatteryOptimizations();
}

/** Call once the user has been told. */
export async function clearMissedAlarms(): Promise<void> {
    await AlarmSound?.clearMissedAlarms();
}

/** Non-null while an alarm is actually sounding. */
export async function getRingingAlarm(): Promise<RingingAlarm | null> {
    return (await AlarmSound?.getRingingAlarm()) ?? null;
}

export async function stopRingingAlarm(id: string): Promise<void> {
    await AlarmSound?.stopRingingAlarm(id);
}

export async function snoozeRingingAlarm(id: string): Promise<void> {
    await AlarmSound?.snoozeRingingAlarm(id);
}

/** False when the user has revoked exact alarms on Android 12+. */
export async function canScheduleExactAlarms(): Promise<boolean> {
    return (await AlarmSound?.canScheduleExactAlarms()) ?? false;
}

export async function openExactAlarmSettings(): Promise<void> {
    await AlarmSound?.openExactAlarmSettings();
}

/**
 * False in Expo Go and in any build predating this module.
 *
 * Every function below degrades to a harmless no-op rather than throwing, so
 * the app still runs, renders, and lets you work on the engine and UI without a
 * dev build. What it must never do is *pretend*, {@link isAlarmSoundAvailable}
 * is exported so the UI can say plainly that alarms are unavailable, instead of
 * silently accepting an alarm that will never make a sound.
 */
export const isAlarmSoundAvailable = AlarmSound !== null;

/**
 * True when this platform can offer the user their own system alarm tones.
 * Android can, via the OS ringtone picker; iOS has no public API for it.
 */
export const canPickSystemAlarmSound = Platform.OS === 'android' && isAlarmSoundAvailable;

export async function getDefaultAlarmSound(): Promise<AlarmSoundChoice | null> {
    return AlarmSound?.getDefaultAlarmSound() ?? null;
}

/**
 * The OS's own name for a sound, e.g. "Oxygen".
 *
 * Null when unavailable rather than a placeholder string, this module sits
 * below the app and has no business inventing user-facing copy. Callers fall
 * back through i18n.
 */
export async function getSoundLabel(uri: string): Promise<string | null> {
    return (await AlarmSound?.getSoundLabel(uri)) ?? null;
}

/** Opens the OS picker. Resolves null when unavailable or the user backs out. */
export async function pickAlarmSound(
    currentUri: string | null = null,
): Promise<AlarmSoundChoice | null> {
    return AlarmSound?.pickAlarmSound(currentUri) ?? null;
}

/** Plays on the alarm stream, audible through Do Not Disturb, at alarm volume. */
export async function playAlarmSound(uri: string | null, options: PlayOptions = {}): Promise<void> {
    await AlarmSound?.play(uri, options.loop ?? true, options.volume ?? 1);
}

export async function stopAlarmSound(): Promise<void> {
    await AlarmSound?.stop();
}

export async function isAlarmSoundPlaying(): Promise<boolean> {
    return (await AlarmSound?.isPlaying()) ?? false;
}

/** Null when the native module is absent, the caller must not infer "not muted". */
export async function getAlarmVolume(): Promise<AlarmVolumeInfo | null> {
    return AlarmSound?.getAlarmVolume() ?? null;
}

/**
 * Whether the alarm may take over the lock screen.
 *
 * On Android 14+ this is a separate user-revocable grant, and it commonly starts
 * denied for apps not installed from the Play Store. Without it the alarm can
 * only ever be a notification.
 */
export async function canUseFullScreenIntent(): Promise<boolean> {
    return (await AlarmSound?.canUseFullScreenIntent()) ?? false;
}

export async function openFullScreenIntentSettings(): Promise<void> {
    await AlarmSound?.openFullScreenIntentSettings();
}

/**
 * Sends the app to the background, revealing the lock screen behind it.
 *
 * A no-op where unsupported, so callers can always follow it with their own
 * in-app navigation fallback.
 */
export async function moveAppToBackground(): Promise<void> {
    await AlarmSound?.moveAppToBackground();
}
