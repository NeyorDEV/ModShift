export type Sleep = (ms: number) => Promise<void>;

export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RateLimiterOptions {
  // Nombre maximal de requêtes par fenêtre (Modrinth : 300 requêtes / minute / IP).
  maxRequests?: number;
  windowMs?: number;
  now?: () => number;
  sleep?: Sleep;
}

// Limiteur de débit côté client :
// 1. fenêtre glissante locale (on n'envoie jamais plus de `maxRequests` par `windowMs`) ;
// 2. respect des en-têtes X-Ratelimit-Remaining / X-Ratelimit-Reset renvoyés par Modrinth :
//    quand le quota restant tombe à zéro, on attend la réinitialisation annoncée.
export class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly sleep: Sleep;
  private readonly timestamps: number[] = [];
  private blockedUntil = 0;
  // Chaîne de promesses : sérialise les appels à acquire() pour éviter les courses.
  private queue: Promise<void> = Promise.resolve();

  constructor(options: RateLimiterOptions = {}) {
    this.maxRequests = options.maxRequests ?? 300;
    this.windowMs = options.windowMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  // Attend qu'une requête puisse être envoyée, puis la comptabilise.
  acquire(): Promise<void> {
    const next = this.queue.then(() => this.waitForSlot());
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async waitForSlot(): Promise<void> {
    for (;;) {
      const now = this.now();
      while (this.timestamps.length > 0 && (this.timestamps[0] ?? 0) <= now - this.windowMs) {
        this.timestamps.shift();
      }
      let waitMs = Math.max(0, this.blockedUntil - now);
      if (this.timestamps.length >= this.maxRequests) {
        waitMs = Math.max(waitMs, (this.timestamps[0] ?? now) + this.windowMs - now);
      }
      if (waitMs <= 0) {
        this.timestamps.push(now);
        return;
      }
      await this.sleep(waitMs);
    }
  }

  // Met à jour l'état à partir des en-têtes d'une réponse.
  update(headers: Headers): void {
    const remaining = Number(headers.get('x-ratelimit-remaining'));
    const resetSeconds = Number(headers.get('x-ratelimit-reset'));
    if (headers.has('x-ratelimit-remaining') && Number.isFinite(remaining) && remaining <= 0) {
      this.blockUntilReset(Number.isFinite(resetSeconds) ? resetSeconds : this.windowMs / 1000);
    }
  }

  // Bloque les prochaines requêtes pendant `seconds` (ex. après un 429).
  blockUntilReset(seconds: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + Math.max(0, seconds) * 1000);
  }
}
