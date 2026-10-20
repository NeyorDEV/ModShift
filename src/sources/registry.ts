import type { ModSource } from './types.js';

const ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;

export class SourceRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceRegistryError';
  }
}

// Registre extensible des sources de mods. L'ordre d'enregistrement est l'ordre d'appel.
export class SourceRegistry {
  private readonly sources = new Map<string, ModSource>();

  register(source: ModSource): this {
    if (!ID_PATTERN.test(source.id)) {
      throw new SourceRegistryError(
        `invalid source id "${source.id}" (lowercase letters, digits and dashes, 2-40 characters)`,
      );
    }
    if (this.sources.has(source.id)) {
      throw new SourceRegistryError(`source "${source.id}" is already registered`);
    }
    if (!source.name.trim()) throw new SourceRegistryError(`source "${source.id}" has no name`);
    if (source.primary && this.list().some((s) => s.primary)) {
      throw new SourceRegistryError('only one primary source (Modrinth) can be registered');
    }
    this.sources.set(source.id, source);
    return this;
  }

  get(id: string): ModSource | undefined {
    return this.sources.get(id);
  }

  list(): ModSource[] {
    return [...this.sources.values()];
  }

  // Valide la section `sources` de modshift.config.json : clés connues, options de chaque source.
  validateOptions(options: Record<string, unknown>): void {
    for (const [id, value] of Object.entries(options)) {
      const source = this.sources.get(id);
      if (!source) {
        throw new SourceRegistryError(
          `unknown source "${id}" (known: ${this.list()
            .map((s) => s.id)
            .join(', ')})`,
        );
      }
      if (!source.validateOptions) {
        throw new SourceRegistryError(`source "${id}" takes no options`);
      }
      source.validateOptions(value);
    }
  }
}
