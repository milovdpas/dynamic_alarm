type FontType = {
    fontFamily: string;
    fontWeight: '400' | '500' | '600' | '700' | 'bold' | 'normal' | undefined;
};

export const Fonts = {
    regular: { fontFamily: 'System', fontWeight: '400' } as FontType,
    medium: { fontFamily: 'System', fontWeight: '500' } as FontType,
    bold: { fontFamily: 'System', fontWeight: '700' } as FontType,
};

export const FontSize = {
    extraSmall: 12,
    small: 16,
    medium: 20,
    large: 24,
    extraLarge: 32,
    /** The wake-up time on the home screen and the ring screen clock. */
    display: 64,
};

export const Spacing = {
    none: 0,
    extraSmall: 5,
    small: 10,
    medium: 15,
    large: 30,
    extraLarge: 50,
};

export const Radius = {
    small: 8,
    medium: 12,
    large: 20,
    pill: 999,
};

export const Color = {
    black: '#111112',
    white: '#FFFFFF',
    night: '#0B1020',
    primary: '#3A6FF7',
    green: '#21C452',
    amber: '#D98324',
    red: '#D14343',
    grey: '#7B7B7B',
};

/**
 * Theme colours, resolved through `useThemeColor`.
 *
 * Dark is not an afterthought here, this app is looked at in bed and again at
 * 06:00, so both schemes get equal care.
 */
export const Colors = {
    light: {
        text: '#111112',
        textSecondary: '#60646C',
        background: '#FFFFFF',
        backgroundElement: '#F0F0F3',
        backgroundSelected: '#E0E1E6',
        border: '#D8D9DE',
        primary: Color.primary,
        danger: Color.red,
        warning: Color.amber,
        success: Color.green,
    },
    dark: {
        text: '#FFFFFF',
        textSecondary: '#B0B4BA',
        background: '#000000',
        backgroundElement: '#212225',
        backgroundSelected: '#2E3135',
        border: '#3A3D42',
        primary: '#7DA1FF',
        danger: '#FF8A8A',
        warning: '#F0A85C',
        success: '#5BD97F',
    },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
