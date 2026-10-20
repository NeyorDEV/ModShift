// Exécute `fn` sur chaque élément avec au plus `limit` appels simultanés.
// Les résultats gardent l'ordre des éléments (pas l'ordre de fin), pour des rapports déterministes.
// À la première erreur, plus aucun nouvel appel n'est lancé et l'erreur est propagée.
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index] as T, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

export const DEFAULT_CONCURRENCY = 4;
export const MAX_CONCURRENCY = 16;
