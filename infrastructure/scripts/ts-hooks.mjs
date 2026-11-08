export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (!specifier.startsWith(".")) throw error;
    for (const suffix of [".ts", "/index.ts"]) {
      try {
        return await next(specifier + suffix, context);
      } catch {}
    }
    throw error;
  }
}
