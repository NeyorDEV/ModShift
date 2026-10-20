// Format d'une version de loader écrite dans un .mrpack (ex. 0.16.5, 21.1.77, 47.3.0,
// 0.27.1-beta.1). Refuse ce qui n'est clairement pas une version (ex. « <version> » ou « X.Y.Z »
// recopiés d'un exemple : toute vraie version contient un chiffre), sans prétendre vérifier
// qu'elle existe.
const LOADER_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;

export function isValidLoaderVersion(value: string): boolean {
  return LOADER_VERSION_PATTERN.test(value) && /[0-9]/.test(value);
}

export function invalidLoaderVersionMessage(value: string): string {
  return `invalid loader version "${value}": expected something like 0.16.5 or 21.1.77 (letters, digits and . + _ - only)`;
}
