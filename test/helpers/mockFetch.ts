import type { FetchLike } from '../../src/modrinth/client.js';

export interface RecordedRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

export type MockHandler = (request: RecordedRequest) => Response | Promise<Response>;

export interface MockFetch {
  fetch: FetchLike;
  calls: RecordedRequest[];
}

// Crée un faux `fetch` qui enregistre chaque requête et délègue la réponse à `handler`.
export function createMockFetch(handler: MockHandler): MockFetch {
  const calls: RecordedRequest[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const request: RecordedRequest = {
      method: init.method ?? 'GET',
      url: new URL(input),
      headers,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(request);
    return handler(request);
  };
  return { fetch, calls };
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

// Faux sommeil : avance une horloge virtuelle au lieu d'attendre réellement.
export function createFakeClock(start = 1_700_000_000_000) {
  const clock = {
    time: start,
    sleeps: [] as number[],
    now: () => clock.time,
    sleep: async (ms: number) => {
      clock.sleeps.push(ms);
      clock.time += ms;
    },
  };
  return clock;
}
