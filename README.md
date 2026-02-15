<p align="center">
  <img src="https://zaruka.pro/logo.png" alt="Zaruka" width="120" />
</p>

<h1 align="center">Zaruka</h1>

<p align="center">
  <strong>Your personal AI assistant that lives on your machine.</strong><br>
  Self-hosted. Model-agnostic. Private by design.
</p>

<p align="center">
  <a href="https://github.com/zaruka-ai/zaruka/blob/main/LICENSE"><img src="https://img.shields.io/github/license/zaruka-ai/zaruka" alt="license" /></a>
  <a href="https://github.com/zaruka-ai/zaruka/pkgs/container/zaruka"><img src="https://img.shields.io/badge/ghcr.io-zaruka-blue" alt="docker" /></a>
</p>

<p align="center">
  <a href="https://zaruka.pro">Website</a>
</p>

---

Zaruka is a decentralized AI assistant you talk to through Telegram. It runs entirely on your hardware — your data never leaves your server. Pick any LLM provider (Claude, GPT, Ollama, or any OpenAI-compatible endpoint) and get a smart, extensible assistant that manages tasks, checks weather, monitors your server, transcribes voice messages, and even creates new skills on the fly.

## Install

```bash
curl -fsSL https://zaruka.pro/install.sh | bash
```

That's it. The script installs Zaruka, asks for your Telegram bot token, and starts it as a background service. Open Telegram and send `/start` to your bot.

## Features

**Pick any brain** — Claude, GPT, Ollama, LM Studio, or any OpenAI-compatible API. Switch models anytime from Telegram.

**Self-evolving skills** — Ask Zaruka to do something new and it writes the skill itself. Currency conversion, stock prices, translations — it figures out the API and creates the tool automatically.

**Task management** — Create tasks with natural language due dates, get daily reminders, mark complete — all from chat.

**Voice messages** — Send a voice note and Zaruka transcribes it using OpenAI Whisper, Groq, or local Whisper. Then responds to what you said.

**Server monitoring** — Tracks CPU, RAM, and disk usage. Sends you a Telegram alert when thresholds are exceeded.

**Weather** — Forecasts for any location, no API key needed (Open-Meteo).

**Multi-language** — Auto-detects your language and responds in it. Supports English, Russian, Spanish, French, German, Chinese, and more.

**Credential vault** — Securely stores API keys and tokens locally. Hand Zaruka a key and it remembers it.

**Conversation memory** — Full chat history stored in local SQLite. Context is never lost.

## Supported Providers

| Provider | Models | Auth |
|----------|--------|------|
| **Anthropic** | Claude | API key or OAuth |
| **OpenAI** | GPT | API key or OAuth |
| **Self-hosted** | Ollama, LM Studio, any OpenAI-compatible | Local / API key |

## Docker

```yaml
services:
  zaruka:
    image: ghcr.io/zaruka-ai/zaruka:latest
    environment:
      - ZARUKA_TELEGRAM_TOKEN=your_token
    volumes:
      - zaruka_data:/data
    restart: unless-stopped

volumes:
  zaruka_data:
```

```bash
docker compose up -d
```

## How It Works

```
You (Telegram) → Zaruka (your server) → LLM provider of your choice
                      ↓
              Local SQLite DB
              Chat history
              Skills directory
              Credentials vault
```

All data stays on your machine. The only external calls are to the LLM provider you choose (or none, if you run Ollama locally).

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Initialize bot |
| `/help` | Show all commands |
| `/settings` | Change model, language, alert thresholds |
| `/usage` | API token usage and costs |
| `/resources` | Current CPU, RAM, disk stats |

## License

MIT
