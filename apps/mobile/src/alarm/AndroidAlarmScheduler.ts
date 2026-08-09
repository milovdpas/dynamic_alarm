import { APP_CONSTANTS } from '@alarm/types';

import {
    cancelAllNativeAlarms,
    cancelNativeAlarm,
    canScheduleExactAlarms,
    getScheduledAlarmIds,
    openExactAlarmSettings,
    scheduleNativeAlarm,
} from '@modules/alarm-sound';
import i18n from '@/i18n/i18n';
import type { AlarmPermissionStatus, AlarmRequest, AlarmScheduler } from './AlarmScheduler';
import { hasNotificationPermission, requestNotificationPermission } from './notificationPermission';

/**
 * Android alarms, registered with the system and rung by native code.
 *
 * This replaced a notifee implementation that started the sound from a
 * JavaScript event handler. Verified on device: with the app killed or the phone
 * freshly rebooted, the notification appeared exactly on time and the phone
 * stayed silent, because no JS was running to start the audio. Android will not
 * boot a JS context merely to deliver a scheduled notification.
 *
 * Nothing on the path from "the alarm is due" to "the phone makes noise" runs
 * here any more. `AlarmManager` fires a broadcast, a native receiver starts a
 * foreground service, and that service plays the tone on the alarm stream and
 * posts the full-screen-intent notification. All of it works with the bundle
 * unloaded.
 *
 * What remains in this class is scheduling and reading state, which only ever
 * happen while the app is open.
 */
export class AndroidAlarmScheduler implements AlarmScheduler {
    readonly platform = 'android' as const;

    async requestPermissions(): Promise<AlarmPermissionStatus> {
        await requestNotificationPermission();
        if (!(await canScheduleExactAlarms())) {
            // Exact alarms cannot be granted from inside the app on Android 12+,
            // so send the user to the system screen rather than silently
            // scheduling an alarm the OS is free to defer.
            await openExactAlarmSettings();
        }
        return this.getPermissions();
    }

    async getPermissions(): Promise<AlarmPermissionStatus> {
        return {
            notifications: await hasNotificationPermission(),
            exactAlarm: await canScheduleExactAlarms(),
        };
    }

    async schedule(request: AlarmRequest): Promise<void> {
        const triggerAtMillis = new Date(request.at).getTime();

        if (Number.isNaN(triggerAtMillis)) {
            throw new Error(`Alarm has an invalid time: ${request.at}`);
        }
        if (triggerAtMillis <= Date.now()) {
            throw new Error(`Refusing to schedule an alarm in the past: ${request.at}`);
        }

        await scheduleNativeAlarm({
            id: request.id,
            triggerAtMillis,
            title: request.title,
            body: request.body,
            soundUri: request.soundUri ?? null,
            occurrenceId: request.occurrenceId ?? null,
            // Resolved now, while i18n is reachable. The service that renders
            // these buttons runs with no JS context at all, so it cannot
            // translate anything itself.
            dismissLabel: i18n.t('common.dismiss'),
            snoozeLabel: APP_CONSTANTS.ALARM.SNOOZE_ENABLED
                ? i18n.t('common.snooze_minutes', { count: APP_CONSTANTS.ALARM.SNOOZE_MINUTES })
                : null,
            // The missed notice is posted by the boot receiver, which has no JS
            // context, so its wording is resolved here and carried on the alarm.
            missedTitle: i18n.t('alarm.missed_title'),
            missedBody: i18n.t('alarm.missed_body'),
        });
    }

    async cancel(id: string): Promise<void> {
        await cancelNativeAlarm(id);
    }

    async cancelAll(): Promise<void> {
        await cancelAllNativeAlarms();
    }

    async listScheduled(): Promise<string[]> {
        // Read back from the native store rather than any JS-side copy: that
        // store is what the boot receiver re-arms from, so it is the only thing
        // that still reflects reality after a restart.
        return getScheduledAlarmIds();
    }
}
