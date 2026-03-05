# Stellar Token Studio
An AI-powered web app where you describe your token idea in plain English, Claude guides you through a conversational wizard, and the app creates a real Native Asset on Stellar Testnet: live, with a real explorer link. (but Claude ask you a few questions to make sure you create the token YOU NEED!)

## How It Works
1. **Describe your idea** — "I want a token for my coffee shop loyalty program"
2. **Claude asks clarifying questions** — guides you through compliance needs,
   supply, and use case (2-3 focused questions)
3. **Claude summarizes** — "I'll create BREW, 10,000 supply, no access restrictions. Proceed?"
4. **Token created live** — real transaction on Stellar Testnet in ~5 seconds
5. **Comparison card appears** — Stellar vs Ethereum ERC-20 side by side

## Why Native Assets vs SAC/SEP41
Stellar supports two token models:
- **Native Assets (SEP-0041 compatible)** — created at protocol level, no smart contract needed, no audit required, compliance flags (auth_required, auth_revocable, clawback) built in. This is what Stellar Token Studio creates.
- **SAC (Stellar Asset Contract)** — wraps a Native Asset into a Soroban smart contract, enabling DeFi interactions (AMMs, lending, etc.). Shown as a "what's next" step after token creation.

This demo focuses on Native Assets because they cover 90% of real-world token use cases (loyalty points, stablecoins, CBDCs, equity tokens) without writing or auditing a single line of smart contract code.

## Tech Stack
- Vanilla HTML/CSS/JS (no framework)
- Stellar SDK v11 via CDN
- Anthropic Claude API (claude-sonnet-4-20250514) for conversational wizard
- Stellar Friendbot for automatic testnet account funding

## Key Features
1. Conversational AI wizard — Claude asks the right questions, user doesn't need to know Stellar
2. Smart intent parsing — compliance flags chosen based on use case, not technical knowledge
3. Pre-creation summary — Claude explains what it will create before doing it
4. Live token creation — trustline, compliance flags, mint in one flow
5. Real explorer link — every transaction verifiable on stellar.expert
6. Comparison card — Stellar vs Ethereum ERC-20 cost and complexity

## Comparison Stellar vs Ethereum (shown after token creation)
- Time: ~5 seconds vs 30-60 min on Ethereum
- Cost: $0.00001 vs $5-80 in gas
- Code: ~15 lines vs ~200 lines + OpenZeppelin
- Audit: Not needed vs Recommended
