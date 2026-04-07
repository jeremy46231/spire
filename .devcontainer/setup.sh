#!/bin/bash
set -e

# Java 25 (Amazon Corretto)
wget -O - https://apt.corretto.aws/corretto.key | sudo gpg --dearmor -o /usr/share/keyrings/corretto-keyring.gpg
echo 'deb [signed-by=/usr/share/keyrings/corretto-keyring.gpg] https://apt.corretto.aws stable main' | sudo tee /etc/apt/sources.list.d/corretto.list
sudo apt-get update
sudo apt-get install -y java-25-amazon-corretto-jdk libxi6 libxtst6 libxrender1

# Bun
npm install -g bun

# Dependencies + server setups
bun install
bun run setup

# Pre-warm Paper (downloads internal jars, then exits)
cd .spire/server && java -jar paper.jar --help
