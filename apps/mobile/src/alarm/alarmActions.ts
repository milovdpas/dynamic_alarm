import { snoozeRingingAlarm, stopRingingAlarm } from '@modules/alarm-sound';
import { dismissOccurrence } from '@/api';
import { isReminderId } from '@/alarm/reminders';

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

    /*
     * Then tell the server, for the trail rather than for correctness.
     *
     * Only the final ring counts as getting up: dismissing a reminder is not
     * dismissing the morning. And only a schedule's morning has a server row;
     * a hand-set alarm lives on this phone alone.
     *
     * Fire and forget. The phone is as likely offline at 06:00 as not, and the
     * server retires a passed morning by itself, so a failure here costs one
     * line in the trail and nothing else. Awaiting it would put a network
     * round trip between somebody and their lock screen.
     */
    if (alarmId !== undefined && alarmId.startsWith('occurrence-') && !isReminderId(alarmId)) {
        void dismissOccurrence(alarmId.slice('occurrence-'.length)).catch(() => undefined);
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
