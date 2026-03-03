# Stellar Token Studio

A single-page web app where you describe a token in plain English, Claude AI parses the intent, and the app creates a real Native Asset on Stellar Testnet — live, with a real explorer link.

## Tech Stack

- Vanilla HTML/CSS/JS (no framework)
- Stellar SDK v11 via CDN
- Anthropic Claude API for natural language parsing
- Stellar Friendbot for automatic testnet account funding

## Key Features

1. Natural language token creation ("Create a CBDC with compliance controls")
2. Claude parses intent and extracts: token code, supply, compliance flags
3. Auto-funds issuer + receiver accounts via Friendbot
4. Creates trustline, sets auth_required / auth_revocable / clawback flags
5. Mints tokens with a real payment operation
6. Shows live transaction link on stellar.expert explorer

## License

MIT
