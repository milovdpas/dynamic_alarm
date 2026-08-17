import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { Radius, Spacing } from '@/assets/Stylesheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import languages, { LANGUAGE_STORAGE_KEY, supportedLanguages } from '@/i18n/languages';
import Storage, { isPersistent } from '@/utils/modules/Storage';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

/**
 * Which language the app speaks.
 *
 * The app already chose one on first launch: a stored choice, then the device
 * language if we speak it, then Dutch. This is the override, and it matters more
 * than a preference usually would, because an alarm is a bad place to meet copy
 * you cannot read.
 *
 * Applied immediately rather than on a Save button, and without a restart.
 * `changeLanguage` re-renders the tree, and an alarm app that relaunches itself
 * to change a label is one that might not come back.
 */
export default function LanguageScreen() {
    const { t, i18n } = useTranslation();
    const border = useThemeColor({}, 'border');
    const primary = useThemeColor({}, 'primary');
    const selected = useThemeColor({}, 'backgroundSelected');

    const [current, setCurrent] = useState(i18n.language);

    const choose = (code: string): void => {
        setCurrent(code);
        void i18n.changeLanguage(code);
        // The same key i18n reads on boot. A different one would apply now and
        // silently revert on the next launch, which is the worst of both.
        void Storage.setItem(LANGUAGE_STORAGE_KEY, code).catch(() => undefined);
    };

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['bottom']}>
                <ScrollView contentContainerStyle={styles.content}>
                    {languages
                        .filter((language) => supportedLanguages.includes(language.code))
                        .map((language) => {
                            const chosen = language.code === current;
                            return (
                                <Pressable
                                    key={language.code}
                                    onPress={() => {
                                        choose(language.code);
                                    }}
                                    accessibilityRole="radio"
                                    accessibilityState={{ selected: chosen }}
                                    style={[
                                        styles.row,
                                        { borderColor: chosen ? primary : border },
                                        chosen && { backgroundColor: selected },
                                    ]}
                                >
                                    <ThemedText style={styles.flag}>{language.icon}</ThemedText>
                                    <ThemedText style={styles.grow}>{language.label}</ThemedText>
                                    {chosen && (
                                        <MaterialCommunityIcons
                                            name="check"
                                            size={20}
                                            color={primary}
                                        />
                                    )}
                                </Pressable>
                            );
                        })}

                    {/*
                     * Said rather than hidden. On a build without AsyncStorage
                     * the choice lasts the session, and a setting that forgets
                     * itself without warning is worse than one that cannot be
                     * changed.
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
    flag: { fontSize: 20 },
    grow: { flex: 1 },
});
