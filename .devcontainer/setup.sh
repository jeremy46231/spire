#!/bin/bash
set -e

echo "[setup] Installing bun..."
npm i -g bun

echo "[setup] Installing dependencies..."
bun i

echo "[setup] Setting up server..."
bun setup

echo "[setup] Starting Spire..."
bun start
