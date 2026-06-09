/**
 * Public re-export of the Kubo-owned `useConstruct` adapter. Lives under
 * `src/hooks/useKubo*` so future Ditto upstream merges can't collide with
 * the name. App code should import from here, not from
 * `@/lib/tepp-adapters/useConstruct`.
 */
export { useKuboTeppConstruct } from '@/lib/tepp-adapters/useConstruct';
export type { UseKuboTeppConstructResult } from '@/lib/tepp-adapters/useConstruct';
