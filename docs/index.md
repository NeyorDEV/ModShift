---
layout: home

hero:
  name: ModShift
  text: Move a modpack to another Minecraft version or loader
  tagline: Checks every mod on Modrinth, finds versions and equivalents, resolves dependencies and writes a migrated .mrpack. It does not convert mod code.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Installation
      link: /guide/installation
    - theme: alt
      text: GitHub
      link: https://github.com/NeyorDEV/ModShift

features:
  - title: Mod by mod
    details: Compatible, update found, alternatives (ranked and explained, to verify) or not found, with the reason. Missing dependencies and conflicts are explained.
  - title: Migrated .mrpack
    details: A pack that follows Modrinth's own validation rules, plus a MIGRATION_REPORT.md listing what was excluded and why.
  - title: Changing loader
    details: Multi-loader mods keep the same project; compatibility layers are only reported, as experimental and not guaranteed.
  - title: Client and server
    details: Client-only and server-only mods from Modrinth metadata, and --side server to build a dedicated-server pack.
  - title: Three ways to use it
    details: CLI for scripts and CI, a guided interactive mode, and a local web page on 127.0.0.1.
  - title: In your pull requests
    details: The ModShift Check GitHub Action posts the report on each pull request.
---
