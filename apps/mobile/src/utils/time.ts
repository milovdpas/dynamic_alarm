import { DateTime } from 'luxon';
import { APP_CONSTANTS } from '@alarm/types';

import i18n from '@/i18n/i18n';

/**
 * An instant as a wall clock, in the zone the user lives in.
 *
 * The `setZone` matters and its absence is invisible, which is why this exists
 * once rather than in every screen that shows a time. The API serialises
 * occurrence times with `toISOString()`, so they arrive as UTC:
 * `2026-08-18T05:34:00.000Z` is an alarm at **07:34** in Amsterdam. Formatting
 * that without converting shows 05:34, which is not a crash, not a wrong
 * calculation, and exactly two hours of someone's morning.
 *
 * Plan times from the engine arrive with an offset instead (`+02:00`), so they
 * were right by accident on screens that forgot the conversion. That is worse
 * than being wrong everywhere: it made one screen disagree with another and
 * neither looked broken.
 */
export function clock(iso: string): string {
    return DateTime.fromISO(iso, { setZone: true })
        .setZone(APP_CONSTANTS.TIMEZONE)
        .toFormat('HH:mm');
}

/**
 * "Today", "Tomorrow", or the weekday, for a date the user is deciding about.
 *
 * The locale comes from i18n rather than from a translation key: a missing key
 * returns the key itself, and Luxon handed that to Hermes as a language tag once
 * already.
 */
export function relativeDay(t: (key: string) => string, date: string): string {
    const day = DateTime.fromISO(date, { zone: APP_CONSTANTS.TIMEZONE });
    const days = Math.round(day.diff(DateTime.now().startOf('day'), 'days').days);

    if (days === 0) {
        return t('home.today');
    }
    if (days === 1) {
        return t('home.tomorrow');
    }
    // The full date once it is further out than tomorrow. A weekday alone is
    // ambiguous the moment a schedule runs on more than one day.
    return day.setLocale(i18n.language).toFormat('cccc d LLLL');
}
