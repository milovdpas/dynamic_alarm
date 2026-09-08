import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { OccurrenceState } from '@alarm/types';
import type { IsoDateString, OccurrenceResponse, Routine, Schedule } from '@alarm/types';
import { sortedSteps } from '@alarm/core';

import type { CalendarItem } from '@/calendar/items';
import { Radius, Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import { ThemedText } from '@/components/ui/ThemedText';
import { useThemeColor } from '@/utils/hooks/useThemeColor';
import { clock, relativeDay } from '@/utils/time';

/**
 * Everything about one day, and the two things that can be changed on it.
 *
 * For a schedule's morning: skip it, or leave routine steps out of it. Both are
 * about this one date and expire with it; the schedule and the routine are not
 * touched, which is the whole reason they live here rather than in the editor.
 * A hand-set alarm is shown, not edited: its editor is on the Alarms tab, and
 * two places to edit one thing is how they disagree.
 *
 * Leaving a step out moves the wake time later by its minutes, said plainly
 * under the list, because "untick shower" and "your alarm is now ten minutes
 * later" are the same fact and only the second one is about the morning.
 */
export default function DayDetail({
    date,
    items,
    schedules,
    routines,
    busy,
    onToggleSkip,
    onSteps,
}: {
    date: IsoDateString;
    items: CalendarItem[];
    schedules: Schedule[];
    routines: Routine[];
    busy: boolean;
    onToggleSkip: (occurrence: OccurrenceResponse) => void;
    onSteps: (occurrence: OccurrenceResponse, disabledStepIds: string[]) => void;
}) {
    const { t } = useTranslation();
    const border = useThemeColor({}, 'border');
    const primary = useThemeColor({}, 'primary');
    const secondary = useThemeColor({}, 'textSecondary');

    const mornings = items.filter((item) => item.kind === 'SCHEDULE' && item.occurrence !== null);
    const alarms = items.filter((item) => item.kind === 'STANDALONE');

    return (
        <View style={styles.detail}>
            <ThemedText type="subtitle">{relativeDay(t, date)}</ThemedText>

            {items.length === 0 && (
                <ThemedText themeColor="textSecondary">{t('calendar.empty_day')}</ThemedText>
            )}

            {mornings.map((item) => {
                const occurrence = item.occurrence;
                if (occurrence === null) {
                    return null;
                }
                const skipped = occurrence.state === OccurrenceState.SKIPPED;
                const schedule = schedules.find((each) => each.id === occurrence.scheduleId);
                const routine = routines.find((each) => each.id === schedule?.routineId);
                // Steps the routine has switched off for good are not offered:
                // they already count zero, and a tick box that changes nothing is
                // a lie about what the tap does.
                const steps = routine === undefined ? [] : sortedSteps(routine.steps).filter((s) => s.enabled);
                const disabled = new Set(occurrence.disabledStepIds);

                return (
                    <View key={item.id} style={[styles.card, { borderColor: border }]}>
                        <View style={styles.row}>
                            <ThemedText type="smallBold" style={styles.grow}>
                                {occurrence.scheduleName}
                            </ThemedText>
                            <ThemedText
                                type="smallBold"
                                themeColor={skipped ? 'textSecondary' : 'text'}
                                style={skipped ? styles.struck : undefined}
                            >
                                {t('calendar.wake_at', { time: clock(occurrence.currentWakeAt) })}
                            </ThemedText>
                        </View>

                        {occurrence.state === OccurrenceState.PENDING && (
                            <ThemedText type="small" themeColor="textSecondary">
                                {t('calendar.pending')}
                            </ThemedText>
                        )}

                        <ActionButton
                            label={skipped ? t('calendar.unskip') : t('calendar.skip')}
                            disabled={busy}
                            onPress={() => {
                                onToggleSkip(occurrence);
                            }}
                        />

                        {!skipped && (
                            <View style={styles.steps}>
                                <ThemedText type="smallBold">{t('calendar.steps_title')}</ThemedText>
                                {steps.length === 0 && (
                                    <ThemedText type="small" themeColor="textSecondary">
                                        {t('calendar.steps_none')}
                                    </ThemedText>
                                )}
                                {steps.map((step) => {
                                    const on = !disabled.has(step.id);
                                    return (
                                        <Pressable
                                            key={step.id}
                                            disabled={busy}
                                            onPress={() => {
                                                const next = new Set(disabled);
                                                if (on) {
                                                    next.add(step.id);
                                                } else {
                                                    next.delete(step.id);
                                                }
                                                onSteps(occurrence, [...next]);
                                            }}
                                            accessibilityRole="checkbox"
                                            accessibilityState={{ checked: on, disabled: busy }}
                                            style={styles.step}
                                        >
                                            <MaterialCommunityIcons
                                                name={
                                                    on
                                                        ? 'checkbox-marked-outline'
                                                        : 'checkbox-blank-outline'
                                                }
                                                size={22}
                                                color={on ? primary : secondary}
                                            />
                                            <ThemedText
                                                type="small"
                                                themeColor={on ? 'text' : 'textSecondary'}
                                                style={[styles.grow, on ? undefined : styles.struck]}
                                            >
                                                {step.label}
                                            </ThemedText>
                                            <ThemedText type="small" themeColor="textSecondary">
                                                {t('common.minutes_short', { count: step.minutes })}
                                            </ThemedText>
                                        </Pressable>
                                    );
                                })}
                                {steps.length > 0 && (
                                    <ThemedText type="small" themeColor="textSecondary">
                                        {t('calendar.steps_help')}
                                    </ThemedText>
                                )}
                            </View>
                        )}
                    </View>
                );
            })}

            {alarms.map((item) => (
                <View key={item.id} style={[styles.card, { borderColor: border }]}>
                    <View style={styles.row}>
                        <ThemedText type="smallBold" style={styles.grow}>
                            {item.title.trim() === '' ? t('alarms.standalone_default') : item.title}
                        </ThemedText>
                        <ThemedText type="smallBold">{clock(item.at)}</ThemedText>
                    </View>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    detail: { gap: Spacing.medium },
    card: {
        borderWidth: 1,
        borderRadius: Radius.medium,
        padding: Spacing.medium,
        gap: Spacing.small,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.small },
    grow: { flex: 1 },
    struck: { textDecorationLine: 'line-through' },
    steps: { gap: Spacing.small, marginTop: Spacing.extraSmall },
    step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.small, paddingVertical: 4 },
});
