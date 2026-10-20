import type { PromptChoice, Prompter } from '../../src/interactive/prompter.js';

// Réponse scriptée : `undefined` = accepter la valeur par défaut ; pour un select, un nombre
// (index) ou le début du libellé du choix.
export type ScriptedAnswer = string | number | boolean | undefined | Error;

export interface ScriptedStep {
  match: RegExp;
  answer: ScriptedAnswer;
}

export interface ScriptedPrompter extends Prompter {
  asked: string[];
  // Libellés et index par défaut proposés pour chaque select (pour vérifier les défauts).
  selects: { message: string; choices: string[]; defaultIndex?: number }[];
}

// Faux prompteur : chaque question consomme la première étape non utilisée dont le motif
// correspond au message. Une question imprévue fait échouer le test.
export function createScriptedPrompter(steps: ScriptedStep[]): ScriptedPrompter {
  const pending = [...steps];
  const take = (message: string): ScriptedAnswer => {
    const index = pending.findIndex((s) => s.match.test(message));
    if (index === -1) throw new Error(`Unexpected prompt: ${message}`);
    const [step] = pending.splice(index, 1);
    if (step?.answer instanceof Error) throw step.answer;
    return step?.answer;
  };
  const prompter: ScriptedPrompter = {
    asked: [],
    selects: [],
    async input(message, options = {}) {
      prompter.asked.push(message);
      const answer = take(message);
      const value = answer === undefined ? (options.default ?? '') : String(answer);
      const valid = options.validate?.(value) ?? true;
      if (valid !== true) throw new Error(`Invalid scripted answer for "${message}": ${valid}`);
      return value;
    },
    async select(message: string, choices: PromptChoice[], defaultIndex?: number) {
      prompter.asked.push(message);
      prompter.selects.push({ message, choices: choices.map((c) => c.label), defaultIndex });
      const answer = take(message);
      if (answer === undefined) return defaultIndex ?? 0;
      if (typeof answer === 'number') return answer;
      const found = choices.findIndex((c) => c.label.startsWith(String(answer)));
      if (found === -1) throw new Error(`No choice "${String(answer)}" for "${message}"`);
      return found;
    },
    async confirm(message, defaultValue) {
      prompter.asked.push(message);
      const answer = take(message);
      return answer === undefined ? defaultValue : Boolean(answer);
    },
  };
  return prompter;
}
