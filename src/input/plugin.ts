import type { JarDependency, JarMetadata, Loader } from '../types.js';
import { asRecord, asString, parseLenientJson } from './zip.js';

// Fichiers de description des plugins de serveur et de proxy.
export const BUKKIT_PLUGIN_FILE = 'plugin.yml';
export const PAPER_PLUGIN_FILE = 'paper-plugin.yml';
export const BUNGEE_PLUGIN_FILE = 'bungee.yml';
export const VELOCITY_PLUGIN_FILE = 'velocity-plugin.json';

export const PLUGIN_METADATA_FILES = [
  BUKKIT_PLUGIN_FILE,
  PAPER_PLUGIN_FILE,
  BUNGEE_PLUGIN_FILE,
  VELOCITY_PLUGIN_FILE,
];

type YamlValue = string | string[];

function unquote(value: string): string {
  const v = value.trim();
  return (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))
    ? v.slice(1, -1)
    : v;
}

// Lecture volontairement minimale du YAML des plugins : seules les clés de premier niveau
// (scalaires et listes, en ligne `[a, b]` ou en bloc `- a`) sont utiles à ModShift.
// Les structures imbriquées (commands, permissions…) sont ignorées.
export function readTopLevelYaml(text: string): Record<string, YamlValue> {
  const result: Record<string, YamlValue> = {};
  let listKey: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '');
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item?.[1] !== undefined && listKey) {
      const list = result[listKey];
      if (Array.isArray(list)) list.push(unquote(item[1]));
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!pair?.[1]) {
      // Ligne indentée d'une structure imbriquée : ignorée.
      if (!/^\s/.test(line)) listKey = undefined;
      continue;
    }
    const [, key, value = ''] = pair;
    listKey = undefined;
    if (value === '') {
      result[key] = [];
      listKey = key;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      result[key] = value
        .slice(1, -1)
        .split(',')
        .map(unquote)
        .filter((v) => v);
    } else {
      result[key] = unquote(value);
    }
  }
  return result;
}

const asList = (value: YamlValue | undefined): string[] =>
  Array.isArray(value) ? value : value ? [value] : [];

// Identifiant de type « slug » déduit du nom d'un plugin (« Chest Shop » → « chest-shop »).
export function pluginSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function fromYaml(text: string, loader: Loader): JarMetadata[] {
  const yaml = readTopLevelYaml(text);
  const name = typeof yaml.name === 'string' ? yaml.name : undefined;
  if (!name) throw new Error('missing "name"');
  const dependencies: JarDependency[] = [
    ...asList(yaml.depend).map((d) => ({ modId: pluginSlug(d), required: true })),
    ...asList(yaml.depends).map((d) => ({ modId: pluginSlug(d), required: true })),
    ...asList(yaml.softdepend).map((d) => ({ modId: pluginSlug(d), required: false })),
  ];
  return [
    {
      loader,
      modId: pluginSlug(name),
      name,
      version: typeof yaml.version === 'string' ? yaml.version : undefined,
      dependencies,
    },
  ];
}

// plugin.yml : format commun à Bukkit, Spigot et Paper (déclaré comme « bukkit », le plus
// général, que Paper et Purpur acceptent d'après leur documentation).
export function parseBukkitPluginYml(text: string): JarMetadata[] {
  return fromYaml(text, 'bukkit');
}

export function parsePaperPluginYml(text: string): JarMetadata[] {
  return fromYaml(text, 'paper');
}

export function parseBungeeYml(text: string): JarMetadata[] {
  return fromYaml(text, 'bungeecord');
}

export function parseVelocityPluginJson(text: string, label = VELOCITY_PLUGIN_FILE): JarMetadata[] {
  const json = asRecord(parseLenientJson(text, label));
  const id = asString(json?.id);
  if (!json || !id) throw new Error('missing "id"');
  const dependencies: JarDependency[] = (Array.isArray(json.dependencies) ? json.dependencies : [])
    .map(asRecord)
    .flatMap((dep) => {
      const depId = asString(dep?.id);
      return depId ? [{ modId: depId, required: dep?.optional !== true }] : [];
    });
  return [
    {
      loader: 'velocity',
      modId: id,
      name: asString(json.name),
      version: asString(json.version),
      dependencies,
    },
  ];
}
