import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { WakePlan } from '@alarm/types';

import { Radius, Spacing } from '@/assets/Stylesheet';
import DetailRow from '@/components/ui/DetailRow';
import { ThemedText } from '@/components/ui/ThemedText';
import WarningBanner from '@/components/ui/WarningBanner';
import { useThemeColor } from '@/utils/hooks/useThemeColor';
import { clock } from '@/utils/time';

/**
 * Which departure to build the morning around.
 *
 * The number being chosen is the wake-up time, which is why each option leads
 * with it rather than with a train. Someone deciding between these is not
 * choosing a service, they are choosing how much sleep to trade for how much
 * margin, and the departure is the detail that explains the trade.
 *
 * The first option is the engine's own answer, the latest departure that still
 * arrives on time, so a user with no preference already has the right one.
 *
 * Shared by onboarding and the schedule editor. This was inline in onboarding
 * until the editor needed the same choice, and the copy would have drifted in
 * the way that matters: the two screens disagreeing about what "chosen" looks
 * like, on a control whose only job is to show what is chosen.
 */
export default function JourneyOptions({
    options,
    selected,
    onSelect,
    disabled = false,
}: {
    options: WakePlan[];
    selected: number;
    onSelect: (index: number) => void;
    disabled?: boolean;
}) {
    const { t } = useTranslation();
    const border = useThemeColor({}, 'border');
    const primary = useThemeColor({}, 'primary');
    const selectedBackground = useThemeColor({}, 'backgroundSelected');

    return (
        <View style={styles.options}>
            <ThemedText type="subtitle">{t('schedule.options_title')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
                {t('schedule.options_help')}
            </ThemedText>

            {options.map((option, index) => {
                const chosen = index === selected;
                return (
                    <Pressable
                        key={option.journey?.id ?? String(index)}
                        disabled={disabled}
                        onPress={() => {
                            onSelect(index);
                        }}
                        style={[
                            styles.option,
                            { borderColor: chosen ? primary : border },
                            chosen && { backgroundColor: selectedBackground },
                        ]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: chosen, disabled }}
                    >
                        <View style={styles.optionHeader}>
                            <ThemedText type="small" themeColor="textSecondary">
                                {t('common.wake_up')}
                            </ThemedText>
                            <ThemedText type="subtitle" themeColor={chosen ? 'primary' : 'text'}>
                                {clock(option.wakeUpAt)}
                            </ThemedText>
                        </View>

                        <DetailRow
                            label={t('common.leave_home')}
                            value={clock(option.departHomeAt)}
                        />
                        {option.journey !== null && (
                            <DetailRow
                                label={t('schedule.departs')}
                                value={clock(option.journey.departureAt)}
                            />
                        )}
                        {option.journey !== null && (
                            <DetailRow
                                label={t('schedule.arrives')}
                                value={clock(option.journey.arrivalAt)}
                            />
                        )}
                        <DetailRow
                            label={t('plan.travel')}
                            value={t('common.minutes_short', {
                                count: option.breakdown.travelMinutes,
                            })}
                        />
                        {option.journey !== null && (
                            <DetailRow
                                label={t('schedule.changes')}
                                value={
                                    option.journey.transferCount === 0
                                        ? t('schedule.direct')
                                        : String(option.journey.transferCount)
                                }
                            />
                        )}

                        {!option.feasible && (
                            <WarningBanner
                                title={t('plan.infeasible', {
                                    minutes: option.shortfallMinutes ?? 0,
                                })}
                                message={t('schedule.infeasible_help')}
                            />
                        )}
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    options: { gap: Spacing.small },
    option: {
        borderWidth: 1,
        borderRadius: Radius.small,
        padding: Spacing.medium,
        gap: Spacing.extraSmall,
    },
    optionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
