#!/bin/bash
# -------------------------------------------------------------------
# Pterodactyl Panel Auto-Update & Startup Script
# -------------------------------------------------------------------

echo "========================================================"
echo "  🚀 Starting RearMC Tierlist Bot on Pterodactyl Panel"
echo "========================================================"

# 1. Check if git repository is initialized
if [ -d ".git" ]; then
    echo "[Auto-Updater] Git repository detected."

    # Check if AUTO_UPDATE is enabled (Default: true)
    if [ "$AUTO_UPDATE" != "false" ] && [ "$AUTO_UPDATE" != "0" ]; then
        echo "[Auto-Updater] Checking for remote updates from Git..."

        # Fetch and pull remote changes
        git fetch origin main 2>/dev/null || git fetch origin 2>/dev/null
        
        # Check if local is behind remote
        LOCAL=$(git rev-parse HEAD 2>/dev/null)
        REMOTE=$(git rev-parse @{u} 2>/dev/null)

        if [ "$LOCAL" != "$REMOTE" ] && [ -n "$REMOTE" ]; then
            echo "[Auto-Updater] ⚡ New update found ($LOCAL -> $REMOTE)! Pulling changes..."
            git pull origin main 2>/dev/null || git pull
            
            echo "[Auto-Updater] 📦 Installing/Updating dependencies..."
            npm install --no-audit --no-fund
            
            echo "[Auto-Updater] 🔨 Building TypeScript application..."
            npm run build
            echo "[Auto-Updater] ✅ Update & Build completed successfully!"
        else
            echo "[Auto-Updater] ✅ Bot is up to date (Commit: $LOCAL)."
        fi
    fi
else
    echo "[Auto-Updater] Git repository not found. Running existing build."
fi

# 2. Build if dist folder does not exist
if [ ! -d "dist" ]; then
    echo "[Startup] dist folder missing. Compiling TypeScript..."
    npm run build
fi

# 3. Start the bot
echo "========================================================"
echo "  🟢 Launching RearMC Tierlist Bot..."
echo "========================================================"
exec node dist/index.js
