export interface AlarmSoundChoice {
    /** Platform URI. On Android a `content://` URI from the system picker. */
    uri: string;
    /** Human name as the OS calls it, e.g. "Oxygen". */
    label: string;
}

export interface AlarmVolumeInfo {
    current: number;
    max: number;
    /**
     * True when the alarm stream is at zero. Worth surfacing before the user goes
     * to bed, a muted alarm stream wakes nobody, and the app cannot raise it.
     */
    isMuted: boolean;
}

/**
 * Everything the native side needs to ring, with no help from JavaScript.
 *
 * This is written to disk at schedule time precisely because at fire time the
 * app may be dead. Labels are resolved here, while i18n is still reachable.
 */
export interface NativeAlarmConfig {
    id: string;
    triggerAtMillis: number;
    title: string;
    body: string;
    soundUri?: string | null;
    occurrenceId?: string | null;
    dismissLabel: string;
    /** Omitted when snooze is disabled, which removes the button entirely. */
    snoozeLabel?: string | null;
    /** Wording for the "this did not ring" notice, posted natively at boot. */
    missedTitle: string;
    /** May contain a {time} placeholder, substituted natively. */
    missedBody: string;
}

/**
 * An alarm that was due while the device was off, so it never rang.
 *
 * Recorded rather than silently dropped: firing it hours late would be worse
 * than not firing, but so is leaving the user to guess why nothing happened.
 */
export interface MissedAlarm {
    id: string;
    /** When it should have rung. */
    triggerAtMillis: number;
    title: string;
    occurrenceId?: string | null;
}

/** Evidence of what the native side actually did, and when. */
export interface AlarmDiagnostics {
    lastRearmAt: number;
    lastRearmSource: string | null;
    lastRearmMissedCount: number;
    lastBootRearmAt: number;
    /** How many times the boot receiver has ever run, across all restarts. */
    bootRearmCount: number;
    /** Wall-clock moment this device last started. */
    deviceBootedAt: number;
    /** Whether the boot receiver ran for the boot currently in progress. */
    bootRearmRanThisBoot: boolean;
    /** Milliseconds between device boot and the receiver running, or -1. */
    bootRearmDelayMs: number;
    lastError: string | null;
}

export interface RingingAlarm {
    alarmId: string;
    isRinging: boolean;
}

export interface PlayOptions {
    /** Defaults to true; alarms ring until dismissed. */
    loop?: boolean;
    /** 0..1, applied on top of the system alarm volume. Defaults to 1. */
    volume?: number;
}
