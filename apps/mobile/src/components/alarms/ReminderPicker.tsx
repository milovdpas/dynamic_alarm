import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { APP_CONSTANTS } from '@alarm/types';
import type { ReminderConfig } from '@alarm/types';

import { reminderLeadMinutes } from '@/alarm/reminders';
import { Radius, Spacing } from '@/assets/Stylesheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

const COUNTS = range(1, APP_CONSTANTS.ALARM.REMINDERS.MAX_COUNT);
const INTERVALS = [1, 2, 3, 5, 10, 15, 20].filter(
    (minutes) => minutes <= APP_CONSTANTS.ALARM.REMINDERS.MAX_INTERVAL_MINUTES,
);

/**
 * How many times this alarm rings, and how far apart.
 *
 * This app has no snooze, deliberately: on a journey-derived alarm the wake time
 * is already the latest that still gets you there, so every snoozed minute comes
 * out of the safety margin and nine of them can mean missing the train. Reminders
 * are the honest version of the same wish. The rings are chosen in advance, the
 * **last** one is the real wake time, and the earlier ones are pulled back before
 * it.
 *
 * The consequence is stated on screen rather than left to be worked out, because
 * "three rings, five minutes apart" and "your alarm now starts ten minutes
 * earlier" are the same fact and only the second one is about somebody's
 * morning.
 */
export default function ReminderPicker({
    value,
    onChange,
    disabled = false,
}: {
    value: ReminderConfig;
    onChange: (next: ReminderConfig) => void;
    disabled?: boolean;
}) {
    const { t } = useTranslation();
    const border = useThemeColor({}, 'border');
    const primary = useThemeColor({}, 'primary');
    const selected = useThemeColor({}, 'backgroundSelected');

    const lead = reminderLeadMinutes(value);

    return (
        <View style={styles.group}>
            <ThemedText type="smallBold">{t('alarms.reminders')}</ThemedText>

            <View style={styles.chips}>
                {COUNTS.map((count) => (
                    <Chip
                        key={count}
                        label={count === 1 ? t('alarms.reminders_off') : String(count)}
                        chosen={count === value.count}
                        disabled={disabled}
                        border={border}
                        primary={primary}
                        selected={selected}
                        onPress={() => {
                            onChange({ ...value, count });
                        }}
                    />
                ))}
            </View>

            {/* Nothing to space out until there is more than one ring. */}
            {value.count > 1 && (
                <View style={styles.chips}>
                    {INTERVALS.map((minutes) => (
                        <Chip
                            key={minutes}
                            label={t('alarms.reminder_interval', { minutes })}
                            chosen={minutes === value.intervalMinutes}
                            disabled={disabled}
                            border={border}
                            primary={primary}
                            selected={selected}
                            onPress={() => {
                                onChange({ ...value, intervalMinutes: minutes });
                            }}
                        />
                    ))}
                </View>
            )}

            <ThemedText type="small" themeColor="textSecondary">
                {lead === 0
                    ? t('alarms.reminders_off_help')
                    : t('alarms.reminders_help', { minutes: lead, count: value.count })}
            </ThemedText>
        </View>
    );
}

function Chip({
    label,
    chosen,
    disabled,
    border,
    primary,
    selected,
    onPress,
}: {
    label: string;
    chosen: boolean;
    disabled: boolean;
    border: string;
    primary: string;
    selected: string;
    onPress: () => void;
}) {
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected: chosen, disabled }}
            style={[
                styles.chip,
                { borderColor: chosen ? primary : border },
                chosen && { backgroundColor: selected },
                disabled && styles.dimmed,
            ]}
        >
            <ThemedText type="small">{label}</ThemedText>
        </Pressable>
    );
}

function range(from: number, to: number): number[] {
    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

const styles = StyleSheet.create({
    group: { gap: Spacing.small },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.small },
    chip: {
        borderWidth: 1,
        borderRadius: Radius.pill,
        paddingVertical: Spacing.small,
        paddingHorizontal: Spacing.medium,
    },
    dimmed: { opacity: 0.5 },
});
