import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { CALENDAR_VIEWS, type CalendarView } from '@/calendar/range';
import { Radius, Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import { ThemedText } from '@/components/ui/ThemedText';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

/**
 * Where the calendar is, and the two ways to move it.
 *
 * The range title with previous and next around it, and the view chips under
 * that. Previous and next disappear for the agenda rather than greying out: it
 * always reads from today, so there is nowhere for them to go, and a disabled
 * button is a question the screen cannot answer.
 */
export default function CalendarHeader({
    title,
    paged,
    view,
    onView,
    onPrev,
    onNext,
    onToday,
}: {
    title: string;
    paged: boolean;
    view: CalendarView;
    onView: (view: CalendarView) => void;
    onPrev: () => void;
    onNext: () => void;
    onToday: () => void;
}) {
    const { t } = useTranslation();
    const border = useThemeColor({}, 'border');
    const primary = useThemeColor({}, 'primary');
    const selected = useThemeColor({}, 'backgroundSelected');

    return (
        <View style={styles.header}>
            <View style={styles.titleRow}>
                {paged && (
                    <Pressable
                        onPress={onPrev}
                        accessibilityRole="button"
                        accessibilityLabel={t('calendar.previous')}
                        style={styles.arrow}
                    >
                        <MaterialCommunityIcons name="chevron-left" size={28} color={primary} />
                    </Pressable>
                )}
                <ThemedText type="subtitle" style={styles.title}>
                    {title}
                </ThemedText>
                {paged && (
                    <Pressable
                        onPress={onNext}
                        accessibilityRole="button"
                        accessibilityLabel={t('calendar.next')}
                        style={styles.arrow}
                    >
                        <MaterialCommunityIcons name="chevron-right" size={28} color={primary} />
                    </Pressable>
                )}
            </View>

            <View style={styles.controls}>
                <View style={styles.chips}>
                    {CALENDAR_VIEWS.map((option) => {
                        const chosen = option === view;
                        return (
                            <Pressable
                                key={option}
                                onPress={() => {
                                    onView(option);
                                }}
                                accessibilityRole="radio"
                                accessibilityState={{ selected: chosen }}
                                style={[
                                    styles.chip,
                                    { borderColor: chosen ? primary : border },
                                    chosen && { backgroundColor: selected },
                                ]}
                            >
                                <ThemedText type="small">{t(`calendar.${option}`)}</ThemedText>
                            </Pressable>
                        );
                    })}
                </View>
                {paged && <ActionButton label={t('calendar.today')} onPress={onToday} />}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    header: { gap: Spacing.small },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.small },
    title: { flex: 1, textAlign: 'center' },
    arrow: { padding: Spacing.extraSmall },
    controls: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: Spacing.small,
    },
    chips: { flexDirection: 'row', gap: Spacing.small },
    chip: {
        borderWidth: 1,
        borderRadius: Radius.pill,
        paddingVertical: Spacing.small,
        paddingHorizontal: Spacing.medium,
    },
});
