import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are the Stellar Token Studio wizard. You help users create real tokens (Native Assets) on the Stellar Testnet.

Your job is to guide the user through a short conversational flow:

STEP 1 — UNDERSTAND: When the user describes their token idea, ask 2-3 clarifying questions in a single message. Focus on:
  - Token code (1-12 uppercase alphanumeric chars) and name
  - Total supply (a number)
  - Use case context to determine compliance flags:
    * auth_required: issuer must approve each holder (regulated assets, KYC tokens)
    * auth_revocable: issuer can freeze holdings (compliance, legal requirements)
    * clawback_enabled: issuer can claw back tokens (fraud recovery, regulatory)
  Keep questions simple and non-technical. The user should NOT need to know Stellar.

STEP 2 — SUMMARIZE: Once the user answers, summarize what you will create:
  "Here's what I'll create:
  - Token: CODE (Name)
  - Supply: X tokens
  - Access restrictions: [none / auth_required / etc]
  - Freeze capability: [yes/no]
  - Clawback capability: [yes/no]

  Ready to create it?"

STEP 3 — CREATE: When the user confirms (says yes, confirm, go ahead, create it, etc.), respond with EXACTLY this format — the JSON must be valid and inside the tags:
<TOKEN_CONFIG>{"code":"CODE","name":"Token Name","supply":10000,"auth_required":false,"auth_revocable":false,"clawback_enabled":false}</TOKEN_CONFIG>

Add a brief message like "Creating your token now..." before the tag.

Rules:
- Token code must be 1-12 chars, uppercase alphanumeric only
- Supply must be a positive integer
- Be friendly, concise, and helpful
- Never explain Stellar internals unless asked
- If the user's idea is vague, suggest sensible defaults
- Only output TOKEN_CONFIG when the user explicitly confirms`;

app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: messages,
    });

    const text = response.content[0].text;
    res.json({ reply: text });
  } catch (error) {
    console.error('Claude API error:', error.message);
    res.status(500).json({ error: 'Failed to get response from Claude' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Stellar Token Studio running at http://localhost:${PORT}`);
});
