#!/bin/bash
# -------------------------------------------------------------------
# Pterodactyl Panel Auto-Update & Startup Script
# -------------------------------------------------------------------

echo "========================================================"
echo "  🚀 Starting RearMC Tierlist Bot on Pterodactyl Panel"
echo "========================================================"

REPO_URL="https://github.com/tejasjhain-sudo/tierlistbot.git"

# 1. Initialize git if not present so auto-updates work on Pterodactyl
if [ ! -d ".git" ]; then
    echo "[Auto-Updater] Initializing Git remote tracking..."
    git init
    git remote add origin $REPO_URL 2>/dev/null || true
fi

# 2. Check and perform auto-update (Default: true)
if [ "$AUTO_UPDATE" != "false" ] && [ "$AUTO_UPDATE" != "0" ]; then
    echo "[Auto-Updater] Checking for updates from GitHub..."
    git fetch origin main 2>/dev/null || true

    LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "none")
    REMOTE=$(git rev-parse origin/main 2>/dev/null || echo "none")

    if [ "$LOCAL" != "$REMOTE" ] && [ "$REMOTE" != "none" ]; then
        echo "[Auto-Updater] ⚡ New update found ($LOCAL -> $REMOTE)! Pulling changes..."
        git reset --hard origin/main 2>/dev/null || git pull origin main 2>/dev/null || true

        echo "[Auto-Updater] 📦 Installing/Updating dependencies..."
        npm install --no-audit --no-fund

        echo "[Auto-Updater] 🔨 Building TypeScript application..."
        npm run build
        echo "[Auto-Updater] ✅ Update & Build completed successfully!"
    else
        echo "[Auto-Updater] ✅ Bot is up to date (Commit: $LOCAL)."
    fi
fi

# 3. Build if dist folder does not exist
if [ ! -d "dist" ]; then
    echo "[Startup] dist folder missing. Compiling TypeScript..."
    npm run build
fi

# 4. Launch Bot
echo "========================================================"
echo "  🟢 Launching RearMC Tierlist Bot..."
echo "========================================================"
exec node dist/index.js
