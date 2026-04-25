// Lightweight mock for next/cache used in test environments.
// 'use cache' and cacheLife() are Next.js build-time features that have
// no effect at runtime in Node.js test environments.
export function cacheLife(_profile: string): void {
  // no-op in tests
}

export function cacheTag(..._tags: string[]): void {
  // no-op in tests
}

export function revalidateTag(_tag: string): Promise<void> {
  return Promise.resolve();
}

export function revalidatePath(_path: string): Promise<void> {
  return Promise.resolve();
}
