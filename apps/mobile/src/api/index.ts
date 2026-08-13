/**
 * The API, one function per endpoint.
 *
 * Request and response types come from `@alarm/types`, the same declarations
 * the server compiles against, so a renamed field breaks the app at build time
 * rather than rendering `undefined` on a screen.
 *
 * Everything throws `ApiRequestError` on failure. Branch on its `code` and
 * translate that; never show its `message`, which is English and meant for a
 * log or a bug report.
 */
export * from './devices';
export * from './places';
export * from './routines';
export * from './schedules';
export * from './plan';
