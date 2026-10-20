import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli.js';
import { MODSHIFT_VERSION } from '../src/version.js';

describe('cli', () => {
  it('exposes name and version', () => {
    const program = buildProgram();
    expect(program.name()).toBe('modshift');
    expect(program.version()).toBe(MODSHIFT_VERSION);
  });
});
