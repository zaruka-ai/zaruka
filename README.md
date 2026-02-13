# Zaruka

Decentralized personal AI assistant. Self-hosted, model-agnostic, private by design.

## Quick Start

```bash
curl -fsSL https://zaruka.pro/install | bash
```

Or install manually:

```bash
npm install -g zaruka
zaruka setup
zaruka start
```

## Features

- **Self-hosted** — all data stays on your machine in `~/.zaruka/`
- **Model-agnostic** — Claude, GPT-4, Ollama, or any OpenAI-compatible API
- **Telegram interface** — chat with your assistant in natural language
- **Task management** — create, track, and complete tasks with reminders
- **Weather & marine** — forecasts via Open-Meteo (free, no API key)
- **Extensible** — modular skill system for adding new capabilities

## CLI Commands

```bash
zaruka setup       # interactive onboarding wizard
zaruka start       # start the bot
zaruka stop        # stop the bot
zaruka status      # check status and task counts
zaruka doctor      # run diagnostics
zaruka config      # change settings
```

## Architecture

```
~/.zaruka/
├── config.json    — configuration (tokens, provider, timezone)
├── data.db        — SQLite database
└── logs/          — log files
```

The assistant runs as a Telegram bot in polling mode — no open ports needed. All processing happens locally on your machine.

## Supported Providers

| Provider | Model Examples |
|----------|---------------|
| Anthropic | claude-haiku-4-5-20251001, claude-sonnet-4-5-20250929 |
| OpenAI | gpt-4o, gpt-4-turbo |
| OpenAI-compatible | Ollama (llama3), vLLM, etc. |

## Security

- No central server — nothing to compromise
- API keys stored with 600 permissions (owner-only)
- Polling mode — no open ports
- Auditable open-source code

## License

MIT
