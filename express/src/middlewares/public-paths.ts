const PUBLIC_PREFIXES = [
  '/docs',
  '/documentation',
  '/openapi.json',
  '/swagger',
];
const PUBLIC_EXACT = new Set([
  '/api/',
  '/api/health',
  '/api/health/live',
  '/api/health/ready',
]);
const AUTHN_ONLY_PREFIXES: string[] = [];

export function isPublicPath(path: string): boolean {
  return (
    PUBLIC_EXACT.has(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p))
  );
}

export function isAuthnOnlyPath(path: string): boolean {
  return AUTHN_ONLY_PREFIXES.some((p) => path.startsWith(p));
}
