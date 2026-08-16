import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Weekday } from '@alarm/types';

import { Radius, Spacing } from '@/assets/Stylesheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

/** Monday first, the way a Dutch week is written. */
const ALL_DAYS = [
    Weekday.MONDAY,
    Weekday.TUESDAY,
    Weekday.WEDNESDAY,
    Weekday.THURSDAY,
    Weekday.FRIDAY,
    Weekday.SATURDAY,
    Weekday.SUNDAY,
];

/**
 * Which days a schedule runs.
 *
 * Extracted rather than copied when the editor needed the same row of chips.
 * Two versions of this would drift in the way that matters least visibly and
 * most annoyingly: one would start the week on Sunday.
 */
export default function WeekdayPicker({
    value,
    onChange,
    disabled = false,
}: {
    value: Weekday[];
    onChange: (days: Weekday[]) => void;
    disabled?: boolean;
}) {
    const { t } = useTranslation();
    const border = useThemeColor({}, 'border');
    const selected = useThemeColor({}, 'backgroundSelected');

    const toggle = (day: Weekday): void => {
        onChange(
            value.includes(day)
                ? value.filter((each) => each !== day)
                : [...value, day].sort((a, b) => a - b),
        );
    };

    return (
        <View style={styles.days}>
            {ALL_DAYS.map((day) => {
                const on = value.includes(day);
                return (
                    <Pressable
                        key={day}
                        disabled={disabled}
                        onPress={() => {
                            toggle(day);
                        }}
                        style={[
                            styles.day,
                            { borderColor: border },
                            on && { backgroundColor: selected },
                        ]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on, disabled }}
                    >
                        <ThemedText type="smallBold" themeColor={on ? 'text' : 'textSecondary'}>
                            {t(`schedule.day_short.${String(day)}`)}
                        </ThemedText>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    days: { flexDirection: 'row', gap: Spacing.extraSmall, flexWrap: 'wrap' },
    day: {
        borderWidth: 1,
        borderRadius: Radius.small,
        paddingVertical: Spacing.small,
        paddingHorizontal: Spacing.medium,
    },
});
