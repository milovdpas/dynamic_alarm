import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { DateTime } from 'luxon';
import type { IsoDateString } from '@alarm/types';

import type { CalendarItem } from '@/calendar/items';
import { Radius, Spacing } from '@/assets/Stylesheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { useThemeColor } from '@/utils/hooks/useThemeColor';
import { clock, relativeDay } from '@/utils/time';

/**
 * Days in a row, each with what rings on it.
 *
 * Shared by the agenda and the week view, which differ in one thing: the agenda
 * skips days with nothing in them, because thumbing through empty days is the
 * failure mode of every calendar on a phone, while the week view shows all seven
 * because a week with a gap in it is information.
 *
 * Tapping a day opens its detail underneath rather than navigating away. The
 * list is the context for the detail; losing it to a screen change would mean
 * coming back to find where you were.
 */
export default function DayList({
    days,
    itemsByDate,
    showEmpty,
    selected,
    onSelect,
}: {
    days: DateTime[];
    itemsByDate: Map<IsoDateString, CalendarItem[]>;
    showEmpty: boolean;
    selected: IsoDateString | null;
    onSelect: (date: IsoDateString) => void;
}) {
    const { t } = useTranslation();
    const border = useThemeColor({}, 'border');
    const primary = useThemeColor({}, 'primary');
    const surface = useThemeColor({}, 'backgroundElement');

    return (
        <View style={styles.list}>
            {days.map((day) => {
                const date = day.toISODate() ?? '';
                const items = itemsByDate.get(date) ?? [];
                if (!showEmpty && items.length === 0) {
                    return null;
                }
                const chosen = date === selected;

                return (
                    <Pressable
                        key={date}
                        onPress={() => {
                            onSelect(date);
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: chosen }}
                        style={[
                            styles.day,
                            { backgroundColor: surface, borderColor: chosen ? primary : border },
                        ]}
                    >
                        <ThemedText type="smallBold">{relativeDay(t, date)}</ThemedText>

                        {items.length === 0 && (
                            <ThemedText type="small" themeColor="textSecondary">
                                {t('calendar.empty_day')}
                            </ThemedText>
                        )}

                        {items.map((item) => (
                            <View key={item.id} style={styles.row}>
                                <ThemedText
                                    type={item.kind === 'REMINDER' ? 'small' : 'smallBold'}
                                    themeColor={item.kind === 'REMINDER' ? 'textSecondary' : 'text'}
                                    style={item.skipped ? styles.struck : undefined}
                                >
                                    {clock(item.at)}
                                </ThemedText>
                                <ThemedText
                                    type="small"
                                    themeColor={
                                        item.kind === 'REMINDER' || item.skipped
                                            ? 'textSecondary'
                                            : 'text'
                                    }
                                    style={[styles.grow, item.skipped ? styles.struck : undefined]}
                                >
                                    {item.kind === 'REMINDER'
                                        ? t('calendar.reminder')
                                        : item.title.trim() === ''
                                          ? t('alarms.standalone_default')
                                          : item.title}
                                </ThemedText>
                                {item.skipped && (
                                    <ThemedText type="small" themeColor="textSecondary">
                                        {t('calendar.skipped')}
                                    </ThemedText>
                                )}
                            </View>
                        ))}
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    list: { gap: Spacing.small },
    day: {
        borderWidth: 1,
        borderRadius: Radius.medium,
        padding: Spacing.medium,
        gap: Spacing.extraSmall,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.small },
    grow: { flex: 1 },
    struck: { textDecorationLine: 'line-through' },
});
