import type { ClientEvent } from '../modrinth/client.js';

export type LogLevel = 'quiet' | 'normal' | 'verbose';

export interface Logger {
  info(message: string): void;
  debug(message: string): void;
  // Met à jour la barre de progression (affichée seulement sur un terminal).
  progress(done: number, total: number, label: string): void;
  // Efface la barre de progression.
  endProgress(): void;
  clientEvent(event: ClientEvent): void;
}

export interface LoggerOptions {
  write: (text: string) => void;
  level: LogLevel;
  // La barre de progression réécrit la ligne courante : uniquement sur un vrai terminal.
  isTTY: boolean;
  width?: number;
}

const BAR_WIDTH = 24;

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search ? '?…' : ''}`;
  } catch {
    return url;
  }
}

// Journal de la CLI sur stderr (stdout reste réservé aux rapports).
export function createLogger(options: LoggerOptions): Logger {
  const { write, level, isTTY } = options;
  const maxWidth = Math.max(40, options.width ?? 80);
  let barVisible = false;

  const clearBar = () => {
    if (barVisible) {
      write('\r\u001b[2K');
      barVisible = false;
    }
  };
  const line = (text: string) => {
    clearBar();
    write(`${text}\n`);
  };

  return {
    info(message) {
      if (level !== 'quiet') line(message);
    },
    debug(message) {
      if (level === 'verbose') line(`[debug] ${message}`);
    },
    progress(done, total, label) {
      if (level === 'quiet' || !isTTY || total <= 0) return;
      const filled = Math.round((Math.min(done, total) / total) * BAR_WIDTH);
      const bar = `[${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}] ${done}/${total}`;
      const text = `${bar} ${label}`.slice(0, maxWidth - 1);
      write(`\r\u001b[2K${text}`);
      barVisible = true;
    },
    endProgress() {
      clearBar();
    },
    clientEvent(event) {
      if (event.type === 'rate-limit-wait') {
        // Toujours signalé (même sans --verbose) quand l'attente est perceptible.
        if (event.waitMs >= 2000) {
          this.info(`Modrinth rate limit reached: waiting ${Math.ceil(event.waitMs / 1000)} s…`);
        } else {
          this.debug(`rate limiter: waiting ${event.waitMs} ms`);
        }
        return;
      }
      if (level !== 'verbose') return;
      if (event.type === 'request') {
        this.debug(
          `${event.method} ${shortUrl(event.url)} → ${event.status} (${event.durationMs} ms)`,
        );
      } else if (event.type === 'cache-hit') {
        this.debug(`${event.method} ${shortUrl(event.url)} → cache`);
      } else {
        this.debug(`retrying ${shortUrl(event.url)} in ${event.delayMs} ms (${event.reason})`);
      }
    },
  };
}
