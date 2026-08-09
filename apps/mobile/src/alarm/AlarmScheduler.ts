import type { IsoDateTimeString } from '@alarm/types';

export interface AlarmRequest {
    /** Stable id, reusing it replaces the existing alarm rather than stacking one. */
    id: string;
    at: IsoDateTimeString;
    title: string;
    body: string;
    /**
     * Sound to play, as a platform URI. On Android this is typically a
     * `content://` URI from the system ringtone picker. Null falls back to the
     * device's default alarm tone.
     */
    soundUri?: string | null;
    /** Round-tripped to the ring screen so it can show why it woke you. */
    occurrenceId?: string;
}

export interface AlarmPermissionStatus {
    /** Can post notifications at all (Android 13+ runtime permission). */
    notifications: boolean;
    /**
     * Can schedule exact alarms. Without this the OS may defer the alarm by
     * minutes, which for an alarm clock is the same as it not working.
     */
    exactAlarm: boolean;
}

/**
 * Note on full-screen intents: Android 14+ gates them separately, but neither
 * the platform nor any library exposes a way to query whether ours is still
 * granted. It is deliberately absent from this type rather than reported as a
 * guess, the only honest check is watching a real alarm fire on a real locked
 * device, which is what M0's verification list is for.
 */

/**
 * Platform-independent alarm scheduling.
 *
 * Android is implemented and verified; iOS needs AlarmKit (iOS 26+) and is
 * written but untested. Keeping both behind this interface means adding iOS is
 * a build-and-verify task rather than a rewrite of everything that touches alarms.
 */
export interface AlarmScheduler {
    readonly platform: 'android' | 'ios';

    /** True only if every capability needed for a real alarm was granted. */
    requestPermissions(): Promise<AlarmPermissionStatus>;
    getPermissions(): Promise<AlarmPermissionStatus>;

    schedule(request: AlarmRequest): Promise<void>;
    cancel(id: string): Promise<void>;
    cancelAll(): Promise<void>;
    /** Ids of alarms the OS currently holds, the source of truth, not our state. */
    listScheduled(): Promise<string[]>;
}

export function isFullyPermitted(status: AlarmPermissionStatus): boolean {
    return status.notifications && status.exactAlarm;
}
