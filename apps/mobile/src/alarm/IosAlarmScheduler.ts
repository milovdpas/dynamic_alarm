import type { AlarmPermissionStatus, AlarmRequest, AlarmScheduler } from './AlarmScheduler';
import { loadOptionalModule } from '@/utils/modules/optionalModule';

type NotificationsModule = typeof import('expo-notifications');

let cached: NotificationsModule | null | undefined;

/**
 * Loaded lazily, never at module scope.
 *
 * `expo-notifications` throws on import in Expo Go on Android (remote
 * notifications were removed from Expo Go in SDK 53). Since this file is
 * imported on every platform via the scheduler registry, a top-level import
 * would take the entire app down on Android, including screens that have
 * nothing to do with iOS.
 */
function notifications(): NotificationsModule | null {
    if (cached === undefined) {
        cached = loadOptionalModule(() => require('expo-notifications') as NotificationsModule);
    }
    return cached;
}

/**
 * iOS fallback, a notification, **not** a real alarm.
 *
 * A genuine iOS alarm needs AlarmKit, which is iOS 26+ only and reachable from
 * React Native solely through community v0.x modules. None of that can be
 * verified without an iOS 26 device, so shipping it unverified would be
 * pretending to a guarantee we cannot make.
 *
 * What this implementation actually does, honestly stated:
 *  - fires on the lock screen
 *  - is silenced by the ring/silent switch
 *  - is suppressed by Focus and Do Not Disturb
 *  - caps its sound at 30 seconds
 *
 * That is a reminder, not an alarm. {@link IOS_IS_REAL_ALARM} is exported so the
 * UI can say so plainly instead of letting a user trust their commute to it.
 *
 * M4 replaces the body of this class with AlarmKit. Nothing outside this file
 * changes when it does, that is why the interface exists.
 */
export const IOS_IS_REAL_ALARM = false;

export class IosAlarmScheduler implements AlarmScheduler {
    readonly platform = 'ios' as const;

    async requestPermissions(): Promise<AlarmPermissionStatus> {
        const Notifications = notifications();
        if (Notifications === null) {
            return { notifications: false, exactAlarm: false };
        }
        const { status } = await Notifications.requestPermissionsAsync({
            ios: {
                allowAlert: true,
                allowSound: true,
                allowBadge: false,
                // Critical alerts would break through silent/Focus, but the entitlement
                // requires a case-by-case grant from Apple that we do not have.
                allowCriticalAlerts: false,
            },
        });
        return {
            notifications: status === 'granted',
            // No exact-alarm concept on iOS; notification delivery is best-effort.
            exactAlarm: false,
        };
    }

    async getPermissions(): Promise<AlarmPermissionStatus> {
        const Notifications = notifications();
        if (Notifications === null) {
            return { notifications: false, exactAlarm: false };
        }
        const { status } = await Notifications.getPermissionsAsync();
        return { notifications: status === 'granted', exactAlarm: false };
    }

    async schedule(request: AlarmRequest): Promise<void> {
        const Notifications = notifications();
        if (Notifications === null) {
            throw new Error(
                'expo-notifications is unavailable in this runtime. Use a development build.',
            );
        }
        const timestamp = new Date(request.at).getTime();
        if (Number.isNaN(timestamp)) {
            throw new Error(`Alarm has an invalid time: ${request.at}`);
        }
        if (timestamp <= Date.now()) {
            throw new Error(`Refusing to schedule an alarm in the past: ${request.at}`);
        }

        // Same id replaces rather than stacks, matching the Android behaviour.
        await Notifications.cancelScheduledNotificationAsync(request.id).catch(() => undefined);

        await Notifications.scheduleNotificationAsync({
            identifier: request.id,
            content: {
                title: request.title,
                body: request.body,
                sound: 'default',
                interruptionLevel: 'timeSensitive',
                data: { occurrenceId: request.occurrenceId ?? '', alarmId: request.id },
            },
            trigger: {
                type: Notifications.SchedulableTriggerInputTypes.DATE,
                date: new Date(timestamp),
            },
        });
    }

    async cancel(id: string): Promise<void> {
        await notifications()
            ?.cancelScheduledNotificationAsync(id)
            .catch(() => undefined);
    }

    async cancelAll(): Promise<void> {
        await notifications()?.cancelAllScheduledNotificationsAsync();
    }

    async listScheduled(): Promise<string[]> {
        const scheduled = await notifications()?.getAllScheduledNotificationsAsync();
        return (scheduled ?? []).map((notification) => notification.identifier);
    }
}
