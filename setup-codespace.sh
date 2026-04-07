#!/bin/bash
set -e

echo "Installing bun..."
curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

echo "Installing dependencies..."
bun i

echo "Starting Spire..."
bun start
