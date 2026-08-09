// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole workspace so edits in packages/* trigger a reload.
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from the app first, then the hoisted workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Only look in the paths above. Without this, Metro walks up the filesystem
//    and can silently bind to a package from an unrelated parent directory —
//    which produces "works on my machine" bugs that are miserable to trace.
config.resolver.disableHierarchicalLookup = true;

// 4. Point the shared packages at their TypeScript source rather than dist/.
//    Metro compiles TS directly, so this gives real hot reload on engine edits
//    instead of requiring a `tsc -b` between every change. The matching
//    `paths` entries in tsconfig.json keep the type-checker in agreement.
config.resolver.extraNodeModules = {
  '@alarm/types': path.resolve(workspaceRoot, 'packages/types/src'),
  '@alarm/core': path.resolve(workspaceRoot, 'packages/core/src'),
};

module.exports = config;
