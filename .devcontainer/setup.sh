#!/bin/bash
set -e

# Bun
npm install -g bun

# Dependencies + server setups
bun install
bun run setup

# Pre-warm Paper (downloads internal jars, then exits)
cd .spire/server && java -jar paper.jar --help
