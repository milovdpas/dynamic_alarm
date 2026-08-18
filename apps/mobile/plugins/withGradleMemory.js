const { withGradleProperties } = require('expo/config-plugins');

/**
 * Gives Gradle enough memory to compile this project.
 *
 * The Expo template ships `-Xmx2048m -XX:MaxMetaspaceSize=512m`, and on this
 * project that is not enough: KSP and Android lint both die with
 * `OutOfMemoryError: Metaspace` partway through a release build, taking four
 * tasks with them. The message names the cause, but only after several minutes
 * of compiling, and the failure looks like a code error rather than a budget.
 *
 * A config plugin because `android/gradle.properties` is generated: it is in
 * `.gitignore` and every `expo prebuild` restores the template's value, so an
 * edit made by hand fixes exactly one build.
 *
 * 4 GB heap and 2 GB metaspace, rather than as much as this machine happens to
 * have. These same properties are read by EAS builders, whose workers are
 * smaller than a development laptop, and a number that only fits locally would
 * turn a cloud build into a memory error nobody could reproduce.
 */
const MEMORY = '-Xmx4096m -XX:MaxMetaspaceSize=2048m';
/** Identifies the comment as ours, so a re-run replaces it rather than stacking. */
const MARKER = 'Raised by plugins/withGradleMemory.js.';
/**
 * Anything this plugin has ever written, marker or not.
 *
 * An earlier version wrote a two-line comment, and matching only the marker left
 * the second line on disk to survive every prebuild, which is the accumulation
 * this is meant to stop. That particular orphan has been removed, so the second
 * alternative matches nothing today and exists for the next time the wording
 * changes: a comment this plugin can no longer recognise is one it will
 * duplicate rather than replace.
 */
const OURS = /withGradleMemory|[Mm]etaspace partway through a release build/;

const withGradleMemory = (config) => {
    return withGradleProperties(config, (gradleConfig) => {
        // Both the property and the comment this plugin wrote last time.
        // Prebuild runs against whatever is already there, so filtering only the
        // property leaves the comment behind and adds another beside it, and the
        // file grows a line every single time.
        const properties = gradleConfig.modResults.filter(
            (item) =>
                !(item.type === 'property' && item.key === 'org.gradle.jvmargs') &&
                !(item.type === 'comment' && OURS.test(item.value)),
        );

        properties.push({
            type: 'comment',
            value: `${MARKER} The template default runs out of metaspace.`,
        });
        properties.push({ type: 'property', key: 'org.gradle.jvmargs', value: MEMORY });

        gradleConfig.modResults = properties;
        return gradleConfig;
    });
};

module.exports = withGradleMemory;
