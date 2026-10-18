/**
 * Lets local ops scripts import the workspace TypeScript sources (e.g. @website/domain) with
 * Node's built-in type stripping: relative imports in those sources have no file extension, so
 * this resolve hook tries ".ts" and "/index.ts". Loaded by ts-register.mjs; never deployed.
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (!specifier.startsWith(".")) throw error;
    for (const suffix of [".ts", "/index.ts"]) {
      try {
        return await next(specifier + suffix, context);
      } catch {
        // try the next suffix
      }
    }
    throw error;
  }
}
