import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import {
    DEFAULT_LOCK,
    generateChallenge,
    readLockSetting,
    writeLockSetting,
    type LockKind,
    type LockSetting,
    type MathsDifficulty,
} from '@/alarm/alarmLock';
import { Radius, Spacing } from '@/assets/Stylesheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

const KINDS: { value: LockKind; icon: 'lock-open-variant-outline' | 'calculator' | 'keyboard' }[] = [
    { value: 'NONE', icon: 'lock-open-variant-outline' },
    { value: 'MATHS', icon: 'calculator' },
    { value: 'CODE', icon: 'keyboard' },
];

const DIFFICULTIES: MathsDifficulty[] = ['EASY', 'MEDIUM', 'HARD'];

/** Every ring of a reminder chain, or only the one on the real wake time. */
const APPLIES_TO: LockSetting['appliesTo'][] = ['ALL', 'LAST'];

/**
 * What has to be done before the alarm can be switched off.
 *
 * Off by default, and stated plainly rather than sold. Somebody who dismisses
 * alarms in their sleep and does not remember it knows who they are; everybody
 * else should not have a puzzle imposed on them at 06:00.
 *
 * The example updates as the level changes, because "hard" means nothing until
 * you see the sum you would have to do before you are allowed to get up.
 */
export default function LockScreen() {
    const { t } = useTranslation();
    const border = useThemeColor({}, 'border');
    const primary = useThemeColor({}, 'primary');
    const selected = useThemeColor({}, 'backgroundSelected');
    const secondary = useThemeColor({}, 'textSecondary');

    const [setting, setSetting] = useState<LockSetting>(DEFAULT_LOCK);

    useEffect(() => {
        void readLockSetting().then(setSetting);
    }, []);

    const save = useCallback((next: LockSetting) => {
        setSetting(next);
        void writeLockSetting(next);
    }, []);

    const example = generateChallenge(setting);

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['bottom']}>
                <ScrollView contentContainerStyle={styles.content}>
                    {KINDS.map((kind) => {
                        const chosen = kind.value === setting.kind;
                        return (
                            <Pressable
                                key={kind.value}
                                onPress={() => {
                                    save({ ...setting, kind: kind.value });
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
                                    name={kind.icon}
                                    size={20}
                                    color={chosen ? primary : secondary}
                                />
                                <View style={styles.grow}>
                                    <ThemedText type="smallBold">
                                        {t(`lock.kind_${kind.value}`)}
                                    </ThemedText>
                                    <ThemedText type="small" themeColor="textSecondary">
                                        {t(`lock.kind_${kind.value}_body`)}
                                    </ThemedText>
                                </View>
                            </Pressable>
                        );
                    })}

                    {setting.kind === 'MATHS' && (
                        <View style={styles.difficulties}>
                            {DIFFICULTIES.map((difficulty) => {
                                const chosen = difficulty === setting.difficulty;
                                return (
                                    <Pressable
                                        key={difficulty}
                                        onPress={() => {
                                            save({ ...setting, difficulty });
                                        }}
                                        accessibilityRole="radio"
                                        accessibilityState={{ selected: chosen }}
                                        style={[
                                            styles.difficulty,
                                            { borderColor: chosen ? primary : border },
                                            chosen && { backgroundColor: selected },
                                        ]}
                                    >
                                        <ThemedText type="small">
                                            {t(`lock.difficulty_${difficulty}`)}
                                        </ThemedText>
                                    </Pressable>
                                );
                            })}
                        </View>
                    )}

                    {/*
                     * Only worth asking once a lock exists, and it changes
                     * nothing until reminders do too. Shown all the same when
                     * the lock is on, because somebody turning reminders on
                     * later should find the answer already set rather than
                     * discover the question at 07:35.
                     */}
                    {setting.kind !== 'NONE' && (
                        <View style={styles.difficulties}>
                            {APPLIES_TO.map((appliesTo) => {
                                const chosen = appliesTo === setting.appliesTo;
                                return (
                                    <Pressable
                                        key={appliesTo}
                                        onPress={() => {
                                            save({ ...setting, appliesTo });
                                        }}
                                        accessibilityRole="radio"
                                        accessibilityState={{ selected: chosen }}
                                        style={[
                                            styles.difficulty,
                                            { borderColor: chosen ? primary : border },
                                            chosen && { backgroundColor: selected },
                                        ]}
                                    >
                                        <ThemedText type="small">
                                            {t(`lock.applies_to_${appliesTo}`)}
                                        </ThemedText>
                                    </Pressable>
                                );
                            })}
                        </View>
                    )}

                    {example !== null && (
                        <View style={[styles.card, { borderColor: border }]}>
                            <ThemedText type="small" themeColor="textSecondary">
                                {t('lock.example')}
                            </ThemedText>
                            <ThemedText type="title">{example.prompt}</ThemedText>
                        </View>
                    )}

                    {/*
                     * Said outright rather than discovered. This guards the alarm
                     * screen; the notification's Dismiss button is native and
                     * stays unlocked, deliberately, because it is the only way
                     * out if this screen ever fails to appear. A lock that
                     * claimed to be inescapable would be lying about the one
                     * thing somebody is trusting it with.
                     */}
                    {setting.kind !== 'NONE' && (
                        <ThemedText type="small" themeColor="textSecondary">
                            {t('lock.not_a_cage')}
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
        alignItems: 'flex-start',
        gap: Spacing.small,
        borderWidth: 1,
        borderRadius: Radius.small,
        padding: Spacing.medium,
    },
    grow: { flex: 1, gap: Spacing.extraSmall },
    difficulties: { flexDirection: 'row', gap: Spacing.small },
    difficulty: {
        flex: 1,
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: Radius.small,
        paddingVertical: Spacing.small,
    },
    card: {
        borderWidth: 1,
        borderRadius: Radius.small,
        padding: Spacing.medium,
        gap: Spacing.extraSmall,
        alignItems: 'center',
    },
});
