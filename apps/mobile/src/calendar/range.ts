import type { DateTime } from 'luxon';

/**
 * The three ways to look at the coming days.
 *
 * Agenda is the phone's view: every day with something in it, one after the
 * other, no paging. Day and week are the calendar's: a fixed window you step
 * through. Month is deliberately absent for now; the data only reaches a week
 * ahead, and a grid of mostly empty cells would be a picture of that gap.
 */
export type CalendarView = 'agenda' | 'day' | 'week';

export const CALENDAR_VIEWS: readonly CalendarView[] = ['agenda', 'day', 'week'];

/**
 * How far the agenda reads ahead.
 *
 * Two weeks: one of planned mornings, since the server plans seven days, and one
 * of hand-set alarms, which the phone schedules seven days ahead too. Beyond that
 * there is nothing to show, and an agenda that scrolls into empty weeks is an
 * agenda that looks broken.
 */
export const AGENDA_DAYS = 14;

/**
 * The days a view shows around an anchor, in order.
 *
 * Pure, so the grid and the tests read the same list. A week is Monday to
 * Sunday, which is how the Netherlands prints one and how `Weekday` numbers
 * them; the anchor can be any day of it.
 */
export function visibleDays(view: CalendarView, anchor: DateTime): DateTime[] {
    const day = anchor.startOf('day');
    if (view === 'day') {
        return [day];
    }
    if (view === 'week') {
        const monday = day.minus({ days: day.weekday - 1 });
        return Array.from({ length: 7 }, (_, index) => monday.plus({ days: index }));
    }
    return Array.from({ length: AGENDA_DAYS }, (_, index) => day.plus({ days: index }));
}

/**
 * Where the anchor lands after stepping.
 *
 * The agenda does not step: it always starts today and reads forward, so a
 * previous or next button on it would move to nothing.
 */
export function stepAnchor(view: CalendarView, anchor: DateTime, direction: 1 | -1): DateTime {
    if (view === 'day') {
        return anchor.plus({ days: direction });
    }
    if (view === 'week') {
        return anchor.plus({ days: 7 * direction });
    }
    return anchor;
}

/** Whether a view has a previous and a next. */
export function isPaged(view: CalendarView): boolean {
    return view !== 'agenda';
}
