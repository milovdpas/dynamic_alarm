/**
 * Dynamic layer over `app.json`, for the one value that cannot be committed.
 *
 * `google-services.json` is not a secret in the usual sense: every value in it
 * ships inside the APK. It is kept out of this public repository anyway, because
 * the Android API key it carries is worth restricting rather than publishing,
 * and a scraper finds a repository faster than it finds an APK.
 *
 * On EAS the file arrives as a **file-type environment variable**: the build
 * machine writes it to a temporary path and puts that path in
 * `GOOGLE_SERVICES_JSON`. Locally the variable is unset and the checked-out file
 * beside this one is used, so prebuild and development builds work with no
 * setup beyond having the file.
 *
 * ```sh
 * eas env:create --name GOOGLE_SERVICES_JSON --type file \
 *   --value ./google-services.json --visibility secret \
 *   --environment development --environment preview --environment production
 * ```
 *
 * Everything else stays in `app.json`, which remains the readable description of
 * this app. This file exists to override exactly one field, and adding more to
 * it would split the configuration across two places for no reason.
 */
/**
 * The update channel, for builds EAS did not make.
 *
 * EAS stamps the channel from the profile in `eas.json`, so a cloud build knows
 * which branch it listens to. A local Gradle build has nobody to do that, and an
 * APK with no channel never sees `eas update` again, which would quietly remove
 * the one delivery mechanism this project has while builds are rationed.
 *
 * Only when EAS is *not* building, so cloud builds keep choosing per profile: a
 * production build must not start taking preview updates because this file
 * hardcoded a channel.
 */
const localChannel =
    process.env.EAS_BUILD === 'true'
        ? undefined
        : { 'expo-channel-name': process.env.EXPO_UPDATE_CHANNEL ?? 'preview' };

module.exports = ({ config }) => ({
    ...config,
    updates: {
        ...config.updates,
        ...(localChannel === undefined ? {} : { requestHeaders: localChannel }),
    },
    android: {
        ...config.android,
        // The build machine's copy when EAS provided one, otherwise the local
        // file. Never a hardcoded path in only one of the two cases: a build
        // that silently loses this file still succeeds, and produces an app that
        // can never register for push.
        googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
    },
});
