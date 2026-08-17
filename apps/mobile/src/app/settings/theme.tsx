import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { Radius, Spacing } from '@/assets/Stylesheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import { type ThemePreference, useTheme } from '@/utils/contexts/ThemeContext';
import { isPersistent } from '@/utils/modules/Storage';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

/** In the order a settings list is normally read: the default first. */
const OPTIONS: {
    value: ThemePreference;
    icon: 'theme-light-dark' | 'white-balance-sunny' | 'weather-night' | 'train';
}[] = [
    { value: 'system', icon: 'theme-light-dark' },
    { value: 'light', icon: 'white-balance-sunny' },
    { value: 'dark', icon: 'weather-night' },
    { value: 'ns', icon: 'train' },
];

/**
 * Light or dark, or whatever the phone is doing.
 *
 * System is the default and stays a choice of its own rather than being resolved
 * to a colour when it is picked. Someone whose phone turns dark in the evening
 * expects this app to follow, and storing `light` because that is what the phone
 * happened to be at the time would quietly break that forever.
 *
 * Applied immediately, with no Save button and no restart, like the language
 * screen. The stored value is read before the first paint, so the choice is
 * already in effect when the app next opens rather than arriving a frame later.
 */
export default function ThemeScreen() {
    const { t } = useTranslation();
    const { preference, setPreference } = useTheme();
    const border = useThemeColor({}, 'border');
    const primary = useThemeColor({}, 'primary');
    const selected = useThemeColor({}, 'backgroundSelected');
    const secondary = useThemeColor({}, 'textSecondary');

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['bottom']}>
                <ScrollView contentContainerStyle={styles.content}>
                    {OPTIONS.map((option) => {
                        const chosen = option.value === preference;
                        return (
                            <Pressable
                                key={option.value}
                                onPress={() => {
                                    setPreference(option.value);
                                }}
                                accessibilityRole="radio"
                                accessibilityState={{ selected: chosen }}
                                style={[
                                    styles.row,
                                    { borderColor: chosen ? primary : border },
                                    chosen && { backgroundColor: selected },
                                ]}
                            >
                                <MaterialCommunityIcons
                                    name={option.icon}
                                    size={20}
                                    color={chosen ? primary : secondary}
                                />
                                <ThemedText style={styles.grow}>
                                    {t(`theme.${option.value}`)}
                                </ThemedText>
                                {chosen && (
                                    <MaterialCommunityIcons name="check" size={20} color={primary} />
                                )}
                            </Pressable>
                        );
                    })}

                    <ThemedText type="small" themeColor="textSecondary">
                        {t('theme.system_hint')}
                    </ThemedText>

                    {/*
                     * Said rather than hidden, exactly as on the language screen.
                     * On a build without AsyncStorage the choice lasts the
                     * session, and a setting that forgets itself without warning
                     * is worse than one that cannot be changed.
                     */}
                    {!isPersistent() && (
                        <ThemedText type="small" themeColor="textSecondary">
                            {t('language.not_persistent')}
                        </ThemedText>
                    )}
                </ScrollView>
            </SafeAreaView>
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    content: { padding: Spacing.large, gap: Spacing.small },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.small,
        borderWidth: 1,
        borderRadius: Radius.small,
        padding: Spacing.medium,
    },
    grow: { flex: 1 },
});
