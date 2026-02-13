#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[zaruka]${NC} $1"; }
warn()  { echo -e "${YELLOW}[zaruka]${NC} $1"; }
error() { echo -e "${RED}[zaruka]${NC} $1"; exit 1; }

echo ""
echo "  ╔══════════════════════════════════╗"
echo "  ║     Zaruka — Install Script      ║"
echo "  ╚══════════════════════════════════╝"
echo ""

# Detect OS
OS="$(uname -s)"
case "$OS" in
  Linux*)  info "Detected: Linux" ;;
  Darwin*) info "Detected: macOS" ;;
  *)       error "Unsupported OS: $OS. Zaruka supports macOS and Linux." ;;
esac

# Check for Node.js 20+
check_node() {
  if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v | sed 's/v//')
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge 20 ]; then
      info "Node.js $NODE_VERSION found"
      return 0
    else
      warn "Node.js $NODE_VERSION found, but 20+ is required"
      return 1
    fi
  else
    warn "Node.js not found"
    return 1
  fi
}

# Install Node.js via nvm if needed
install_node() {
  info "Installing Node.js via nvm..."

  if ! command -v nvm &>/dev/null; then
    if [ -s "$HOME/.nvm/nvm.sh" ]; then
      # shellcheck source=/dev/null
      . "$HOME/.nvm/nvm.sh"
    else
      info "Installing nvm..."
      curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
      export NVM_DIR="$HOME/.nvm"
      # shellcheck source=/dev/null
      . "$NVM_DIR/nvm.sh"
    fi
  fi

  nvm install 22
  nvm use 22
  info "Node.js $(node -v) installed"
}

if ! check_node; then
  install_node
fi

# Install zaruka globally
info "Installing zaruka..."
npm install -g zaruka

info "Zaruka installed!"
echo ""
info "Run 'zaruka setup' to configure your assistant."
echo ""
