import { APP_CONSTANTS } from '@alarm/types';
import type { IsoDateTimeString, ReminderConfig } from '@alarm/types';

/**
 * Reminder alarms, which are what this app has instead of a snooze button.
 *
 * Snooze was left out on purpose: on a journey-derived alarm the wake time is
 * already the latest that still gets you there, so every snoozed minute comes
 * straight out of the safety margin and nine of them can mean missing the train.
 * Reminders invert that. The rings are decided in advance, the **last** one is
 * the real wake time, and the earlier ones are pulled back before it. Three
 * rings five minutes apart on an 07:45 alarm means 07:35, 07:40, 07:45.
 *
 * So the margin is untouched, and the difference from snooze is who pays. A
 * snoozer borrows from their journey; somebody with reminders gets up earlier
 * and spends their own time.
 */
export const NO_REMINDERS: ReminderConfig = {
    count: 1,
    intervalMinutes: APP_CONSTANTS.ALARM.REMINDERS.DEFAULT_INTERVAL_MINUTES,
};

/**
 * Every moment this alarm should ring, earliest first, ending on the wake time.
 *
 * The wake time is always the last entry, even for a configuration that makes no
 * sense, because that is the ring the whole calculation exists to produce.
 * Anything else is a bonus and may be dropped; that one may not.
 */
export function reminderTimes(
    wakeAt: IsoDateTimeString,
    reminders: ReminderConfig | null | undefined,
): IsoDateTimeString[] {
    const wake = new Date(wakeAt);
    if (Number.isNaN(wake.getTime())) {
        return [];
    }

    const count = clamp(reminders?.count ?? 1, 1, APP_CONSTANTS.ALARM.REMINDERS.MAX_COUNT);
    const interval = clamp(
        reminders?.intervalMinutes ?? 0,
        1,
        APP_CONSTANTS.ALARM.REMINDERS.MAX_INTERVAL_MINUTES,
    );

    const times: IsoDateTimeString[] = [];
    // Counted down from the earliest so the list comes out in ringing order,
    // with the wake time landing last at offset zero.
    for (let before = count - 1; before >= 0; before -= 1) {
        times.push(new Date(wake.getTime() - before * interval * 60_000).toISOString());
    }
    return times;
}

/**
 * How much earlier the first ring is than the wake time, in minutes.
 *
 * What a screen needs to be honest. Today says "your alarm is at 07:45", and
 * with reminders on the phone will actually make a noise at 07:35, so the screen
 * has to say which one it means.
 */
export function reminderLeadMinutes(reminders: ReminderConfig | null | undefined): number {
    const count = clamp(reminders?.count ?? 1, 1, APP_CONSTANTS.ALARM.REMINDERS.MAX_COUNT);
    if (count <= 1) {
        return 0;
    }
    const interval = clamp(
        reminders?.intervalMinutes ?? 0,
        1,
        APP_CONSTANTS.ALARM.REMINDERS.MAX_INTERVAL_MINUTES,
    );
    return (count - 1) * interval;
}

/**
 * The OS alarm id for one ring of a chain.
 *
 * The final ring keeps the plain id, unchanged from before reminders existed.
 * That matters for more than tidiness: `heldByOs`, `cancelOrphans` and the ring
 * screen's own parsing all key off `occurrence-<id>`, and a scheme that renamed
 * the real alarm would have broken every one of them at once.
 *
 * Earlier rings get a `#r<n>` suffix, counted from the wake time backwards, so
 * `#r1` is one interval early and `#r2` is two.
 */
export function ringId(baseId: string, ringsBeforeWake: number): string {
    return ringsBeforeWake === 0 ? baseId : `${baseId}#r${String(ringsBeforeWake)}`;
}

/** Whether an OS alarm id belongs to a reminder rather than to the real alarm. */
export function isReminderId(osAlarmId: string): boolean {
    return /#r\d+$/.test(osAlarmId);
}

/**
 * The id with any reminder suffix removed.
 *
 * The ring screen reads the occurrence out of the id it was launched with, so a
 * reminder has to resolve to the same morning as the alarm it precedes, or the
 * first two rings would come up with no idea why they woke you.
 */
export function baseAlarmId(osAlarmId: string): string {
    return osAlarmId.replace(/#r\d+$/, '');
}

function clamp(value: number, low: number, high: number): number {
    if (!Number.isFinite(value)) {
        return low;
    }
    return Math.min(high, Math.max(low, Math.floor(value)));
}
