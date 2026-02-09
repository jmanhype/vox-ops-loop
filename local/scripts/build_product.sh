#!/bin/bash

# VoxYZ Product Builder - Serialized v1.7 (GitHub Push Fix)
# Arguments: All arguments are treated as the prompt

# Source env vars (ZAI_API_KEY etc.) if not already set
ENV_FILE="/Users/speed/.openclaw/workspace/ops-loop/local/.env"
if [ -z "$ZAI_API_KEY" ] && [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
  echo "🔑 Loaded env from $ENV_FILE"
fi

PROMPT="$*"
echo "🤖 Received Prompt: $PROMPT"

CLEAN_NAME=$(echo "$PROMPT" | grep -o "'[^']*'" | head -1 | tr -d "'")
if [ -z "$CLEAN_NAME" ]; then CLEAN_NAME=$(echo "$PROMPT" | sed -n 's/.*Build \([^ ]*\).*/\1/p'); fi
CLEAN_NAME=$(echo "$CLEAN_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]//g')
if [ -z "$CLEAN_NAME" ]; then CLEAN_NAME="vox-app-$(date +%s)"; fi

echo "📂 Target Directory: $CLEAN_NAME"
echo "$CLEAN_NAME" > /tmp/current_slug.txt

PROJECT_DIR="/Users/speed/.openclaw/workspace/$CLEAN_NAME"
WRECKIT_BIN="/Users/speed/.openclaw/workspace/wreckit/scripts/run-wreckit.mjs"
WRECKIT_CONFIG="/Users/speed/.openclaw/workspace/.wreckit/config.json"
POLISH_SCRIPT="/Users/speed/.openclaw/workspace/ops-loop/local/scripts/polish_repo.mjs"
NOTIFY_SCRIPT="/Users/speed/.openclaw/workspace/vox-logs/notify_result.js"

echo "   [1/6] Initializing directory..."
mkdir -p "$PROJECT_DIR/.wreckit"
cd "$PROJECT_DIR" || exit 1
git init
cp "$WRECKIT_CONFIG" .wreckit/config.json

echo "   [2/6] Finding Strategy..."
SPECIFIC_STRATEGY=$(ls -t /Users/speed/.openclaw/workspace/MVP_STRATEGY_*.md | grep -i "$CLEAN_NAME" | head -1)
if [ -n "$SPECIFIC_STRATEGY" ]; then
  STRATEGY_FILE="$SPECIFIC_STRATEGY"
else
  STRATEGY_FILE=$(ls -t /Users/speed/.openclaw/workspace/MVP_STRATEGY_*.md | head -1)
fi

echo "   -> Using Strategy: $STRATEGY_FILE"
if [ -f "$STRATEGY_FILE" ]; then
    # Proven Method: cat | node
    cat "$STRATEGY_FILE" | node "$WRECKIT_BIN" --command ideas
else
    echo "❌ Error: Strategy file not found."
    exit 1
fi

echo "   [3/6] Implementing code (Iterative)..."
count=0
while [ $count -lt 50 ]; do
  node "$WRECKIT_BIN" --command next --verbose
  EXIT_CODE=$?
  if [ $EXIT_CODE -ne 0 ]; then break; fi
  count=$((count+1))
done

echo "   [4/6] Polishing (README/Desc)..."
export SLUG="$CLEAN_NAME"
node "$POLISH_SCRIPT"

echo "   [5/6] Shipping to GitHub..."
git add .
git commit -m "Final High-Fidelity Build by VoxYZ"

# Sanitize Description: Remove newlines and weird chars
RAW_DESC=$(cat repo_desc.txt 2>/dev/null || echo "Professional microservice by VoxYZ")
DESCRIPTION=$(echo "$RAW_DESC" | tr -d '\n\r' | sed 's/[^a-zA-Z0-9 .,!?_-]//g')

# Ensure origin doesn't exist
git remote remove origin 2>/dev/null

# Create repo if it doesn't exist, then push
if gh repo view "jmanhype/$CLEAN_NAME" > /dev/null 2>&1; then
  echo "   -> Repo already exists, adding remote and pushing..."
  git remote add origin "https://github.com/jmanhype/$CLEAN_NAME.git"
  git push --force -u origin main
else
  echo "   -> Creating new repo..."
  gh repo create "$CLEAN_NAME" --public --source=. --remote=origin --push --description "$DESCRIPTION"
fi

# Verify push succeeded
if [ $? -ne 0 ]; then
  echo "⚠️  Push failed, retrying..."
  git remote remove origin 2>/dev/null
  git remote add origin "https://github.com/jmanhype/$CLEAN_NAME.git"
  git push --force -u origin main
fi

echo "   [6/6] Sending notification..."
URL="https://github.com/jmanhype/$CLEAN_NAME"
CHAT_ID="643905554"
echo "🚀 <b>Mission Complete!</b>\n\nYour high-fidelity repository is live:\n$URL\n\n💎✨" > /tmp/final_msg.txt
node "$NOTIFY_SCRIPT" "$CHAT_ID" /tmp/final_msg.txt

echo "✅ Build Finished: $CLEAN_NAME"