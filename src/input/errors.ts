// Erreur levée quand une entrée (pack, jar, dossier) est invalide ou illisible.
export class InputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InputError';
  }
}
