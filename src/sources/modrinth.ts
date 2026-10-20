import type { ModSource } from './types.js';

// Source principale : le moteur interroge Modrinth directement (identification par hash,
// versions pour la cible, dépendances, alternatives). Enregistrée pour être listée et pour que
// sa place dans le registre soit explicite ; elle n'a pas de point d'extension.
export const modrinthSource: ModSource = {
  id: 'modrinth',
  name: 'Modrinth',
  description: 'Primary source: identifies files by hash and finds versions for the target.',
  primary: true,
};
