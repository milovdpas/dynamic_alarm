import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { APP_CONSTANTS } from '@alarm/types';

import { CALENDAR_VIEWS, isPaged, stepAnchor, visibleDays, type CalendarView } from '@/calendar/range';
import Storage from '@/utils/modules/Storage';

const VIEW_KEY = 'calendarView';

/**
 * The chosen view, kept so leaving the tab and coming back keeps it.
 *
 * Agenda until somebody picks otherwise: on a phone, thumbing down a list of
 * the days that have something in them reads better than paging a grid of
 * mostly empty ones.
 */
export function useCalendarView(): [CalendarView, (view: CalendarView) => void] {
    const [view, setView] = useState<CalendarView>('agenda');

    useEffect(() => {
        let cancelled = false;
        void Storage.getItem(VIEW_KEY).then((raw) => {
            if (!cancelled && raw !== null && CALENDAR_VIEWS.includes(raw as CalendarView)) {
                setView(raw as CalendarView);
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const choose = useCallback((next: CalendarView) => {
        setView(next);
        void Storage.setItem(VIEW_KEY, next);
    }, []);

    return [view, choose];
}

export interface CalendarRange {
    anchor: DateTime;
    /** The days on screen, in order. */
    days: DateTime[];
    /** Heading for the range: a date, a span of dates, or the word Agenda. */
    title: string;
    /** False for the agenda, which always reads from today and has nothing to step. */
    paged: boolean;
    goToday: () => void;
    goPrev: () => void;
    goNext: () => void;
}

/** Where the calendar is pointing, and how to move it. */
export function useCalendarRange(view: CalendarView): CalendarRange {
    const { t, i18n } = useTranslation();
    const [anchor, setAnchor] = useState(() => DateTime.now().setZone(APP_CONSTANTS.TIMEZONE));

    const days = useMemo(() => visibleDays(view, anchor), [view, anchor]);

    const title = useMemo(() => {
        const locale = i18n.language;
        if (view === 'day') {
            return anchor.setLocale(locale).toFormat('cccc d LLLL');
        }
        if (view === 'week') {
            return t('calendar.week_range', {
                from: days[0]?.setLocale(locale).toFormat('d LLL') ?? '',
                to: days[6]?.setLocale(locale).toFormat('d LLL') ?? '',
            });
        }
        return t('calendar.agenda');
    }, [view, anchor, days, i18n.language, t]);

    return {
        anchor,
        days,
        title,
        paged: isPaged(view),
        goToday: useCallback(() => {
            setAnchor(DateTime.now().setZone(APP_CONSTANTS.TIMEZONE));
        }, []),
        goPrev: useCallback(() => {
            setAnchor((current) => stepAnchor(view, current, -1));
        }, [view]),
        goNext: useCallback(() => {
            setAnchor((current) => stepAnchor(view, current, 1));
        }, [view]),
    };
}
