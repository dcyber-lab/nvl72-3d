// Lets the browser modules run under Node for tests: maps the "three" import-map entries to vendor/.
export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: new URL('../vendor/three.module.min.js', import.meta.url).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: new URL(`../vendor/addons/${specifier.slice(13)}`, import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
