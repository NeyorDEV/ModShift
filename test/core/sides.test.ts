import { describe, expect, it } from 'vitest';
import {
  mrpackEnv,
  neededOn,
  sideCategory,
  sideFromEnvironment,
  sideOf,
} from '../../src/core/sides.js';

describe('sideFromEnvironment (labrinth convert_v3_environment_to_v2_side_types)', () => {
  it.each([
    ['client_and_server', ['required', 'required']],
    ['client_only', ['required', 'unsupported']],
    ['client_only_server_optional', ['required', 'optional']],
    ['singleplayer_only', ['required', 'required']],
    ['server_only', ['unsupported', 'required']],
    ['server_only_client_optional', ['optional', 'required']],
    ['dedicated_server_only', ['unsupported', 'required']],
    ['client_or_server', ['optional', 'optional']],
    ['client_or_server_prefers_both', ['optional', 'optional']],
  ])('%s → %j', (environment, expected) => {
    expect(sideFromEnvironment(environment)).toEqual(expected);
  });

  it('leaves unknown or missing environments undecided', () => {
    expect(sideFromEnvironment('unknown')).toBeUndefined();
    expect(sideFromEnvironment(undefined)).toBeUndefined();
  });

  it('fixes the side of plugins and resource packs whatever the environment', () => {
    expect(sideFromEnvironment('client_only', 'plugin')).toEqual(['unsupported', 'required']);
    expect(sideFromEnvironment(undefined, 'resourcepack')).toEqual(['required', 'unsupported']);
  });
});

describe('sideOf', () => {
  it("prefers the version's environment over the deprecated project fields", () => {
    expect(
      sideOf({ client_side: 'optional', server_side: 'optional' }, { environment: 'client_only' }),
    ).toEqual({ client: 'required', server: 'unsupported', source: 'version' });
  });

  it('falls back to the project fields, then to unknown', () => {
    expect(sideOf({ client_side: 'unsupported', server_side: 'required' }, {})).toEqual({
      client: 'unsupported',
      server: 'required',
      source: 'project',
    });
    expect(sideOf({ client_side: 'weird' }, undefined)).toEqual({
      client: 'unknown',
      server: 'unknown',
      source: 'none',
    });
  });
});

describe('side categories', () => {
  const side = (client: string, server: string) =>
    sideOf({ client_side: client, server_side: server }, {});

  it('classifies client-only, server-only, both and ambiguous mods', () => {
    expect(sideCategory(side('required', 'unsupported'))).toBe('client');
    expect(sideCategory(side('unsupported', 'required'))).toBe('server');
    expect(sideCategory(side('optional', 'required'))).toBe('both');
    expect(sideCategory(side('required', 'unknown'))).toBe('unknown');
    // Combinaison incohérente : aucun côté.
    expect(sideCategory(side('unsupported', 'unsupported'))).toBe('unknown');
  });

  it('tells whether a mod is needed for an installation', () => {
    const clientOnly = side('required', 'unsupported');
    expect(neededOn(clientOnly, 'server')).toBe('no');
    expect(neededOn(clientOnly, 'client')).toBe('yes');
    expect(neededOn(clientOnly, 'both')).toBe('yes');
    expect(neededOn(side('required', 'unknown'), 'server')).toBe('unknown');
  });

  it('gives .mrpack env values only when both sides are known', () => {
    expect(mrpackEnv(side('required', 'optional'))).toEqual({
      client: 'required',
      server: 'optional',
    });
    expect(mrpackEnv(side('required', 'unknown'))).toBeUndefined();
  });
});
