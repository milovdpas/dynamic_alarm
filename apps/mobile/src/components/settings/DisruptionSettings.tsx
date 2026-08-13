import { StyleSheet, Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { TransportMode } from '@alarm/types';

import { Radius, Spacing } from '@/assets/Stylesheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

export type DisruptionSetting =
    | 'allowLaterWakeOnDelay'
    | 'allowLaterWakeOnCancellation'
    | 'allowEarlierWakeOnTraffic';

/**
 * Which settings a mode can act on.
 *
 * A car journey has no train to be delayed or cancelled, and a train journey has
 * no traffic. Showing all three regardless would put two switches in front of a
 * driver that can never do anything, which reads as the app not knowing how they
 * travel.
 */
const BY_MODE: Record<TransportMode, DisruptionSetting[]> = {
    [TransportMode.PUBLIC_TRANSPORT]: [
        'allowLaterWakeOnDelay',
        'allowLaterWakeOnCancellation',
    ],
    [TransportMode.CAR]: ['allowEarlierWakeOnTraffic'],
    // Nothing is being watched, so nothing can move the alarm.
    [TransportMode.FIXED]: [],
};

/** The settings that apply to any of these modes, in a stable order. */
export function settingsForModes(modes: TransportMode[]): DisruptionSetting[] {
    const wanted = new Set(modes.flatMap((mode) => BY_MODE[mode]));
    return (
        [
            'allowLaterWakeOnDelay',
            'allowLaterWakeOnCancellation',
            'allowEarlierWakeOnTraffic',
        ] as DisruptionSetting[]
    ).filter((setting) => wanted.has(setting));
}

interface DisruptionSettingsProps {
    settings: DisruptionSetting[];
    values: Record<DisruptionSetting, boolean>;
    onChange: (setting: DisruptionSetting, value: boolean) => void;
    disabled?: boolean;
}

/**
 * The switches that decide whether the alarm is allowed to move.
 *
 * Each says what it is doing whichever way it is set. An alarm someone believes
 * is adaptive but is not is the same kind of dishonesty as one they believe is
 * set and which cannot ring, and the off state of the traffic switch is the one
 * that can actually make somebody late, so it says so.
 */
export default function DisruptionSettings({
    settings,
    values,
    onChange,
    disabled = false,
}: DisruptionSettingsProps) {
    const { t } = useTranslation();
    const border = useThemeColor({}, 'border');
    const primary = useThemeColor({}, 'primary');

    return (
        <View style={styles.list}>
            {settings.map((setting) => {
                const on = values[setting];
                return (
                    <View key={setting} style={[styles.card, { borderColor: border }]}>
                        <View style={styles.row}>
                            <View style={styles.grow}>
                                <ThemedText type="smallBold">
                                    {t(`settings.${setting}.label`)}
                                </ThemedText>
                                <ThemedText type="small" themeColor="textSecondary">
                                    {t(`settings.${setting}.help`)}
                                </ThemedText>
                            </View>
                            <Switch
                                value={on}
                                onValueChange={(value) => {
                                    onChange(setting, value);
                                }}
                                disabled={disabled}
                                trackColor={{ true: primary, false: border }}
                                accessibilityLabel={t(`settings.${setting}.label`)}
                            />
                        </View>

                        <ThemedText type="small" themeColor="textSecondary">
                            {t(`settings.${setting}.${on ? 'on' : 'off'}`)}
                        </ThemedText>
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    list: {
        gap: Spacing.small,
    },
    card: {
        borderWidth: 1,
        borderRadius: Radius.medium,
        padding: Spacing.medium,
        gap: Spacing.small,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.medium,
    },
    grow: {
        flex: 1,
    },
});
