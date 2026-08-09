import { Platform } from 'react-native';

import type { AlarmScheduler } from './AlarmScheduler';
import { AndroidAlarmScheduler } from './AndroidAlarmScheduler';
import { IOS_IS_REAL_ALARM, IosAlarmScheduler } from './IosAlarmScheduler';
import { getAlarmSupport } from './alarmSupport';
import { UnsupportedAlarmScheduler } from './UnsupportedAlarmScheduler';

export * from './AlarmScheduler';
export * from './alarmSupport';
export { AlarmUnsupportedError } from './UnsupportedAlarmScheduler';
export { IOS_IS_REAL_ALARM };

let instance: AlarmScheduler | null = null;

export function getAlarmScheduler(): AlarmScheduler {
    if (instance !== null) {
        return instance;
    }
    if (Platform.OS === 'ios') {
        instance = new IosAlarmScheduler();
    } else if (getAlarmSupport().canScheduleAlarms) {
        instance = new AndroidAlarmScheduler();
    } else {
        // Expo Go, or a development build made before the alarm modules landed.
        instance = new UnsupportedAlarmScheduler();
    }
    return instance;
}

/** Call after a rebuild in dev; the cached scheduler is otherwise sticky. */
export function resetAlarmScheduler(): void {
    instance = null;
}

/**
 * Whether this platform can make a promise we are willing to stand behind.
 *
 * Android with the native modules present can. Expo Go cannot. iOS cannot until
 * AlarmKit lands in M4, and the UI should say so rather than let someone trust
 * their commute to a notification that Focus mode will silently swallow.
 */
export function canGuaranteeAlarm(): boolean {
    if (Platform.OS === 'ios') {
        return IOS_IS_REAL_ALARM;
    }
    return getAlarmSupport().canScheduleAlarms;
}
