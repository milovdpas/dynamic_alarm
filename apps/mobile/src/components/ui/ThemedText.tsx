import { StyleSheet, Text, type TextProps } from 'react-native';

import { FontSize, Fonts, type ThemeColor } from '@/assets/Stylesheet';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

export type ThemedTextProps = TextProps & {
    type?: 'default' | 'title' | 'subtitle' | 'small' | 'smallBold' | 'display';
    themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
    const color = useThemeColor({}, themeColor ?? 'text');

    return <Text style={[{ color }, styles[type], style]} {...rest} />;
}

const styles = StyleSheet.create({
    default: {
        ...Fonts.regular,
        fontSize: FontSize.small,
        lineHeight: 24,
    },
    title: {
        ...Fonts.bold,
        fontSize: FontSize.extraLarge,
        lineHeight: 38,
    },
    subtitle: {
        ...Fonts.bold,
        fontSize: FontSize.medium,
        lineHeight: 26,
    },
    small: {
        ...Fonts.regular,
        fontSize: FontSize.extraSmall,
        lineHeight: 18,
    },
    smallBold: {
        ...Fonts.medium,
        fontSize: FontSize.extraSmall,
        lineHeight: 18,
    },
    display: {
        ...Fonts.bold,
        fontSize: FontSize.display,
        lineHeight: 72,
        // Stops the clock jittering as the digits tick over.
        fontVariant: ['tabular-nums'],
    },
});
