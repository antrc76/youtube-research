// Node ESM loader hook used only by `npm test` (see package.json).
//
// This repo's tsconfig uses moduleResolution "bundler", so production code
// (correctly) imports sibling modules without a file extension, e.g.
// `import { DB_PATH } from './db'`. Next.js's own bundler resolves that
// fine, but plain Node's ESM loader requires an exact, extension-ful
// specifier. Rather than add explicit .ts extensions to production imports
// (which would require enabling allowImportingTsExtensions in tsconfig.json
// just to satisfy a test runner, and could affect the Next.js build), this
// hook retries a failed relative import with '.ts' appended, purely so
// `node --test` can resolve these modules directly.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts')) {
      try {
        return await nextResolve(`${specifier}.ts`, context);
      } catch {
        // fall through to the original error
      }
    }
    throw err;
  }
}
