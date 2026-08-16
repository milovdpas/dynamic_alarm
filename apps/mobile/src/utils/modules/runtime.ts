import Constants, { ExecutionEnvironment } from 'expo-constants';

/**
 * Whether this is running inside Expo Go.
 *
 * Worth asking explicitly, because Expo Go is not simply "a build without some
 * native modules". Several packages are present and importable there and throw
 * only when used, so `loadOptionalModule` returns something perfectly real and
 * the failure arrives later, from inside a call that looks fine.
 *
 * Remote notifications are exactly that case: `expo-notifications` imports
 * cleanly in Expo Go and then refuses at the point of registering, which SDK 53
 * made deliberate. Asking first turns a red screen into a feature that is
 * quietly unavailable, which is what it actually is.
 */
export function isExpoGo(): boolean {
    return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}
