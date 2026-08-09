import { snoozeRingingAlarm, stopRingingAlarm } from '@modules/alarm-sound';

/**
 * Stopping and snoozing a ringing alarm.
 *
 * Both are handed straight to the native service, which owns the audio, the
 * wake lock and the notification. Doing any of it from JavaScript would put the
 * bundle back on the critical path, which is exactly the failure this design
 * exists to avoid.
 *
 * The notification's own Dismiss and Snooze buttons never reach this file at
 * all: they broadcast directly to the native receiver, so they work with the app
 * completely dead.
 */
export async function dismissAlarm(alarmId: string | undefined): Promise<void> {
    if (alarmId) {
        await stopRingingAlarm(alarmId);
    }
}

/**
 * Silence now, ring again shortly.
 *
 * Snooze length lives natively alongside the service. When the feature is
 * disabled the button is absent from both the notification and the ring screen,
 * so this is unreachable rather than conditional.
 */
export async function snoozeAlarm(alarmId: string | undefined): Promise<void> {
    if (alarmId) {
        await snoozeRingingAlarm(alarmId);
    }
}
