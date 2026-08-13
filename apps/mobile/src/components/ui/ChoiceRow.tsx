import { Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/assets/Stylesheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

export interface Choice<T extends string> {
    value: T;
    /** Already translated. */
    label: string;
}

interface ChoiceRowProps<T extends string> {
    label: string;
    choices: Choice<T>[];
    value: T;
    onChange: (value: T) => void;
}

/**
 * One answer from a short list, shown in full.
 *
 * A dropdown would hide the alternatives behind a tap, and these are questions
 * where seeing the options is most of the explanation: someone who has not
 * thought about whether they cycle to the station will not go looking for the
 * setting, but will answer it when it is in front of them.
 */
export default function ChoiceRow<T extends string>({
    label,
    choices,
    value,
    onChange,
}: ChoiceRowProps<T>) {
    const border = useThemeColor({}, 'border');
    const primary = useThemeColor({}, 'primary');
    const selected = useThemeColor({}, 'backgroundSelected');

    return (
        <View style={styles.container}>
            <ThemedText type="smallBold" themeColor="textSecondary">
                {label}
            </ThemedText>
            <View style={styles.row}>
                {choices.map((choice) => {
                    const active = choice.value === value;
                    return (
                        <Pressable
                            key={choice.value}
                            onPress={() => {
                                onChange(choice.value);
                            }}
                            style={[
                                styles.choice,
                                { borderColor: active ? primary : border },
                                active && { backgroundColor: selected },
                            ]}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: active }}
                        >
                            <ThemedText
                                type="smallBold"
                                themeColor={active ? 'primary' : 'textSecondary'}
                            >
                                {choice.label}
                            </ThemedText>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        gap: Spacing.extraSmall,
    },
    row: {
        flexDirection: 'row',
        gap: Spacing.extraSmall,
    },
    choice: {
        flex: 1,
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: Radius.small,
        paddingVertical: Spacing.small,
    },
});
