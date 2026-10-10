// Preload entry point for `npm test` (see package.json): registers
// ts-extension-resolve-hook.mjs via the non-deprecated node:module API.
import { register } from 'node:module';

register('./ts-extension-resolve-hook.mjs', import.meta.url);
