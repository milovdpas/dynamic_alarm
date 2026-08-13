import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { FontSize, Fonts, Radius, Spacing } from '@/assets/Stylesheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

interface TextFieldProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
    label: string;
    /** Shown under the field in the danger colour. Already translated. */
    error?: string;
}

/**
 * A themed text input.
 *
 * The label is a real label rather than a placeholder. A placeholder disappears
 * the moment someone types, which leaves a filled form with no way to tell what
 * each box was for, and screen readers get nothing to announce.
 */
export default function TextField({ label, error, ...rest }: TextFieldProps) {
    const text = useThemeColor({}, 'text');
    const secondary = useThemeColor({}, 'textSecondary');
    const background = useThemeColor({}, 'backgroundElement');
    const border = useThemeColor({}, error === undefined ? 'border' : 'danger');

    return (
        <View style={styles.field}>
            <ThemedText type="smallBold" themeColor="textSecondary">
                {label}
            </ThemedText>
            <TextInput
                style={[styles.input, { color: text, backgroundColor: background, borderColor: border }]}
                placeholderTextColor={secondary}
                accessibilityLabel={label}
                {...rest}
            />
            {error !== undefined && (
                <ThemedText type="small" themeColor="danger">
                    {error}
                </ThemedText>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    field: {
        gap: Spacing.extraSmall,
    },
    input: {
        ...Fonts.regular,
        fontSize: FontSize.small,
        borderRadius: Radius.medium,
        borderWidth: 1,
        paddingHorizontal: Spacing.medium,
        // Vertical padding rather than a fixed height: the field has to grow
        // with the system font size, which someone reading an alarm app at
        // 06:00 may well have turned up.
        paddingVertical: Spacing.small,
    },
});
