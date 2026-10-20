// Abstraction des questions posées à l'utilisateur : la vraie implémentation utilise
// @inquirer/prompts, les tests fournissent des réponses scriptées.

export interface PromptChoice {
  label: string;
  description?: string;
}

export interface Prompter {
  input(
    message: string,
    options?: { default?: string; validate?: (value: string) => string | true },
  ): Promise<string>;
  // Renvoie l'index du choix retenu.
  select(message: string, choices: PromptChoice[], defaultIndex?: number): Promise<number>;
  confirm(message: string, defaultValue: boolean): Promise<boolean>;
}

// Levée quand l'utilisateur interrompt la session (Ctrl+C).
export class PromptCancelledError extends Error {
  constructor() {
    super('Interactive session cancelled: nothing was saved.');
    this.name = 'PromptCancelledError';
  }
}

// Inquirer signale une interruption par une ExitPromptError.
function rethrow(error: unknown): never {
  if (error instanceof Error && error.name === 'ExitPromptError') throw new PromptCancelledError();
  throw error;
}

export async function createInquirerPrompter(): Promise<Prompter> {
  // Import à la demande : la bibliothèque n'est chargée que par le mode interactif.
  const { confirm, input, select } = await import('@inquirer/prompts');
  return {
    input: (message, options = {}) =>
      input({ message, default: options.default, validate: options.validate }).catch(rethrow),
    select: (message, choices, defaultIndex) =>
      select({
        message,
        choices: choices.map((c, i) => ({ value: i, name: c.label, description: c.description })),
        default: defaultIndex,
        pageSize: 12,
      }).catch(rethrow),
    confirm: (message, defaultValue) => confirm({ message, default: defaultValue }).catch(rethrow),
  };
}
