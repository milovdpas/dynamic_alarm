/**
 * Project-specific lint rules.
 *
 * CommonJS on purpose. The workspace configs are ESM and the Expo one is CJS,
 * and a `.cjs` module can be loaded by both.
 */

/** U+2014 em dash and U+2013 en dash. */
const DASHES = /[—–]/g;

const NAMES = {
    '—': 'em dash (U+2014)',
    '–': 'en dash (U+2013)',
};

/**
 * Bans em and en dashes anywhere in a source file.
 *
 * A documented project rule that until now was checked by hand, which means it
 * was checked when someone remembered. It covers strings, comments, JSX text
 * and documentation, so the check runs over the raw source rather than over the
 * AST: a dash inside a block comment is exactly the case a node visitor would
 * miss, and comments are where they kept appearing.
 *
 * Fixable, but not to a hyphen. A dash separating a label from its description
 * wants a colon, and one joining two clauses wants a comma or a full stop, so
 * the substitution depends on the sentence. The fixer offers nothing and the
 * message says what to consider instead.
 */
const noDashes = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallow em and en dashes. Use a comma, a colon, a full stop, or parentheses.',
        },
        schema: [],
        messages: {
            found:
                'Found an {{name}}. Rewrite the sentence rather than swapping in a hyphen: ' +
                'a dash separating a label from its description usually wants a colon, and ' +
                'one joining two clauses usually wants a comma or a full stop. See CLAUDE.md.',
        },
    },

    create(context) {
        return {
            Program() {
                const source = context.sourceCode.getText();
                let match;

                DASHES.lastIndex = 0;
                while ((match = DASHES.exec(source)) !== null) {
                    const index = match.index;
                    context.report({
                        loc: {
                            start: context.sourceCode.getLocFromIndex(index),
                            end: context.sourceCode.getLocFromIndex(index + 1),
                        },
                        messageId: 'found',
                        data: { name: NAMES[match[0]] },
                    });
                }
            },
        };
    },
};

module.exports = {
    rules: {
        'no-dashes': noDashes,
    },
};
