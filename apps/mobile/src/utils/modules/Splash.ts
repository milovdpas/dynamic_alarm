import { loadOptionalModule } from './optionalModule';

type SplashModule = typeof import('expo-splash-screen');

/**
 * The native splash screen, held up while the app decides what colour it is.
 *
 * Without this the app paints in the system scheme and then repaints in the
 * stored one a frame later, so someone whose phone is light and who chose dark
 * gets a white flash on every single launch. That is a small thing at noon and a
 * genuinely unpleasant one at 06:00, which is the hour this app exists for.
 *
 * Wrapped like every other native module, see CONVENTIONS.md. A build that
 * predates the dependency simply never holds the splash and never hides it: the
 * app starts the way it did before, with the flash, rather than not at all.
 */
function getSplash(): SplashModule | null {
    return loadOptionalModule(() => require('expo-splash-screen') as SplashModule);
}

/**
 * Must be called at module scope, not from an effect.
 *
 * Expo's own guidance: by the time a component has mounted the splash may
 * already be gone, and asking it to stay then does nothing.
 */
export function preventSplashAutoHide(): void {
    try {
        void getSplash()?.preventAutoHideAsync();
    } catch {
        // Already hidden, or no splash at all. Either way there is nothing to
        // hold up, and a decorative call is not worth a crash on launch.
    }
}

export function hideSplash(): void {
    try {
        void getSplash()?.hideAsync();
    } catch {
        // Same: if it cannot be hidden it was never shown.
    }
}
