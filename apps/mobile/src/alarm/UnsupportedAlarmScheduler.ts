import i18n from '@/i18n/i18n';
import type { AlarmPermissionStatus, AlarmRequest, AlarmScheduler } from './AlarmScheduler';
import { getAlarmSupport } from './alarmSupport';

/** Thrown when something tries to arm an alarm this build cannot deliver. */
export class AlarmUnsupportedError extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = 'AlarmUnsupportedError';
    }
}

/**
 * Stand-in used when the native alarm modules are absent (Expo Go, or a stale
 * development build).
 *
 * Reads are honest no-ops so screens render and the rest of the app stays
 * usable. Writes throw loudly, because the one unacceptable outcome is an
 * alarm the user believes is set and which cannot possibly ring.
 */
export class UnsupportedAlarmScheduler implements AlarmScheduler {
    readonly platform = 'android' as const;

    private get reason(): string {
        // Thrown message, so it must be a resolved string rather than a key,
        // i18n is initialised synchronously, so `t()` is safe even here.
        return i18n.t(getAlarmSupport().reasonKey ?? 'alarm.missing_modules');
    }

    async requestPermissions(): Promise<AlarmPermissionStatus> {
        return { notifications: false, exactAlarm: false };
    }

    async getPermissions(): Promise<AlarmPermissionStatus> {
        return { notifications: false, exactAlarm: false };
    }

    async schedule(_request: AlarmRequest): Promise<void> {
        throw new AlarmUnsupportedError(this.reason);
    }

    async cancel(): Promise<void> {
        // Nothing was ever scheduled, so cancelling is trivially successful.
    }

    async cancelAll(): Promise<void> {
        // As above.
    }

    async listScheduled(): Promise<string[]> {
        return [];
    }
}
