// === Stars Background ===
function initStars() {
  const canvas = document.getElementById('stars');
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const stars = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    size: Math.random() * 1.5 + 0.5,
    opacity: Math.random() * 0.8 + 0.2,
  }));

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const star of stars) {
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(180, 180, 255, ${star.opacity})`;
      ctx.fill();
      star.opacity += (Math.random() - 0.5) * 0.02;
      star.opacity = Math.max(0.1, Math.min(1, star.opacity));
    }
    requestAnimationFrame(draw);
  }
  draw();
}

// === State ===
const conversationHistory = [];
let isWaiting = false;

// === DOM Refs ===
const chatMessages = document.getElementById('chatMessages');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const resultPanel = document.getElementById('resultPanel');

// === Chat Functions ===
function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = `message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'assistant' ? '\u2733' : '\u{1F464}';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = formatMessage(text);

  div.appendChild(avatar);
  div.appendChild(bubble);
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function formatMessage(text) {
  // Convert markdown-like formatting to HTML
  return text
    .split('\n')
    .map(line => {
      line = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      line = line.replace(/`(.*?)`/g, '<code>$1</code>');
      if (line.startsWith('- ')) {
        return `<li>${line.slice(2)}</li>`;
      }
      return line;
    })
    .join('<br>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    .replace(/<\/ul><br><ul>/g, '');
}

function showTyping() {
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = 'typingIndicator';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '\u2733';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';

  div.appendChild(avatar);
  div.appendChild(bubble);
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTyping() {
  const el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

// === Claude API ===
async function sendToClaud(userText) {
  conversationHistory.push({ role: 'user', content: userText });

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: conversationHistory }),
  });

  if (!res.ok) throw new Error('API request failed');

  const data = await res.json();
  const reply = data.reply;

  conversationHistory.push({ role: 'assistant', content: reply });
  return reply;
}

// === Token Config Detection ===
function extractTokenConfig(text) {
  const match = text.match(/<TOKEN_CONFIG>(.*?)<\/TOKEN_CONFIG>/s);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function cleanReplyText(text) {
  return text.replace(/<TOKEN_CONFIG>.*?<\/TOKEN_CONFIG>/s, '').trim();
}

// === Stellar Token Creation ===
async function createStellarToken(config) {
  const overlay = showCreatingOverlay();
  const StellarSdk = window.StellarSdk;
  const server = new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');

  try {
    // Step 1: Generate keypairs
    updateCreatingStep(overlay, 'Generating issuer and distributor accounts...');
    const issuerKeypair = StellarSdk.Keypair.random();
    const distributorKeypair = StellarSdk.Keypair.random();

    // Step 2: Fund both accounts via Friendbot
    updateCreatingStep(overlay, 'Funding accounts via Stellar Friendbot...');
    await Promise.all([
      fetch(`https://friendbot.stellar.org?addr=${issuerKeypair.publicKey()}`),
      fetch(`https://friendbot.stellar.org?addr=${distributorKeypair.publicKey()}`),
    ]);

    // Wait for accounts to be available
    await new Promise(r => setTimeout(r, 2000));

    // Step 3: Set compliance flags on issuer
    updateCreatingStep(overlay, 'Setting compliance flags on issuer...');
    const issuerAccount = await server.loadAccount(issuerKeypair.publicKey());
    const asset = new StellarSdk.Asset(config.code, issuerKeypair.publicKey());

    let flagValue = 0;
    if (config.auth_required) flagValue |= StellarSdk.AuthRequiredFlag;
    if (config.auth_revocable) flagValue |= StellarSdk.AuthRevocableFlag;
    if (config.clawback_enabled) flagValue |= StellarSdk.AuthClawbackEnabledFlag | StellarSdk.AuthRevocableFlag;

    if (flagValue > 0) {
      const flagTx = new StellarSdk.TransactionBuilder(issuerAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET,
      })
        .addOperation(StellarSdk.Operation.setOptions({ setFlags: flagValue }))
        .setTimeout(30)
        .build();

      flagTx.sign(issuerKeypair);
      await server.submitTransaction(flagTx);
    }

    // Step 4: Create trustline from distributor to issuer
    updateCreatingStep(overlay, 'Creating trustline...');
    const distributorAccount = await server.loadAccount(distributorKeypair.publicKey());

    const trustTx = new StellarSdk.TransactionBuilder(distributorAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(StellarSdk.Operation.changeTrust({ asset }))
      .setTimeout(30)
      .build();

    trustTx.sign(distributorKeypair);
    await server.submitTransaction(trustTx);

    // Step 4b: If auth_required, authorize the trustline
    if (config.auth_required) {
      updateCreatingStep(overlay, 'Authorizing trustline...');
      const issuerAccount2 = await server.loadAccount(issuerKeypair.publicKey());
      const authTx = new StellarSdk.TransactionBuilder(issuerAccount2, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET,
      })
        .addOperation(StellarSdk.Operation.setTrustLineFlags({
          trustor: distributorKeypair.publicKey(),
          asset,
          flags: { authorized: true },
        }))
        .setTimeout(30)
        .build();

      authTx.sign(issuerKeypair);
      await server.submitTransaction(authTx);
    }

    // Step 5: Mint tokens
    updateCreatingStep(overlay, `Minting ${config.supply.toLocaleString()} ${config.code} tokens...`);
    const issuerAccount3 = await server.loadAccount(issuerKeypair.publicKey());

    const mintTx = new StellarSdk.TransactionBuilder(issuerAccount3, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(StellarSdk.Operation.payment({
        destination: distributorKeypair.publicKey(),
        asset,
        amount: config.supply.toString(),
      }))
      .setTimeout(30)
      .build();

    mintTx.sign(issuerKeypair);
    const mintResult = await server.submitTransaction(mintTx);

    // Done!
    removeCreatingOverlay(overlay);
    showTokenResult(config, issuerKeypair.publicKey(), distributorKeypair.publicKey(), mintResult.hash);
    showComparisonCard();

    addMessage('assistant', `Your **${config.code}** token has been created successfully on Stellar Testnet! Check the result panel for details and the explorer link.`);

  } catch (error) {
    removeCreatingOverlay(overlay);
    console.error('Token creation error:', error);
    addMessage('assistant', `Something went wrong during token creation: ${error.message || 'Unknown error'}. Please try again.`);
  }
}

// === Creating Overlay ===
function showCreatingOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'creating-overlay';
  overlay.innerHTML = `
    <div class="creating-card">
      <div class="creating-spinner"></div>
      <h3>Creating Your Token</h3>
      <p>Building transactions on Stellar Testnet...</p>
      <div class="creating-step"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function updateCreatingStep(overlay, text) {
  const el = overlay.querySelector('.creating-step');
  if (el) el.textContent = text;
}

function removeCreatingOverlay(overlay) {
  overlay.remove();
}

// === Token Result Card ===
function showTokenResult(config, issuerPublic, distributorPublic, txHash) {
  resultPanel.classList.add('visible');

  const card = document.createElement('div');
  card.className = 'token-card success';
  card.innerHTML = `
    <div class="token-card-header">
      <div class="token-card-icon">\u2713</div>
      <div>
        <div class="token-card-title">${config.code} Created!</div>
        <div class="token-card-subtitle">${config.name || config.code} \u2014 ${config.supply.toLocaleString()} tokens</div>
      </div>
    </div>
    <div class="token-details">
      <div class="token-detail">
        <span class="token-detail-label">Token Code</span>
        <span class="token-detail-value">${config.code}</span>
      </div>
      <div class="token-detail">
        <span class="token-detail-label">Supply</span>
        <span class="token-detail-value">${config.supply.toLocaleString()}</span>
      </div>
      <div class="token-detail">
        <span class="token-detail-label">Issuer</span>
        <span class="token-detail-value code">${issuerPublic.slice(0, 8)}...${issuerPublic.slice(-8)}</span>
      </div>
      <div class="token-detail">
        <span class="token-detail-label">Distributor</span>
        <span class="token-detail-value code">${distributorPublic.slice(0, 8)}...${distributorPublic.slice(-8)}</span>
      </div>
      <div class="token-detail">
        <span class="token-detail-label">Auth Required</span>
        <span class="flag-badge ${config.auth_required ? 'on' : 'off'}">${config.auth_required ? 'ON' : 'OFF'}</span>
      </div>
      <div class="token-detail">
        <span class="token-detail-label">Auth Revocable</span>
        <span class="flag-badge ${config.auth_revocable ? 'on' : 'off'}">${config.auth_revocable ? 'ON' : 'OFF'}</span>
      </div>
      <div class="token-detail">
        <span class="token-detail-label">Clawback</span>
        <span class="flag-badge ${config.clawback_enabled ? 'on' : 'off'}">${config.clawback_enabled ? 'ON' : 'OFF'}</span>
      </div>
    </div>
    <a href="https://stellar.expert/explorer/testnet/tx/${txHash}" target="_blank" rel="noopener" class="explorer-link">
      View on Stellar Explorer \u2197
    </a>
  `;

  resultPanel.appendChild(card);
}

// === Comparison Card ===
function showComparisonCard() {
  const card = document.createElement('div');
  card.className = 'comparison-card';
  card.innerHTML = `
    <h3>Stellar vs Ethereum ERC-20</h3>
    <table class="comparison-table">
      <thead>
        <tr>
          <th></th>
          <th>Stellar</th>
          <th>Ethereum</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Time</td>
          <td class="stellar">~5 seconds</td>
          <td class="ethereum">30-60 min</td>
        </tr>
        <tr>
          <td>Cost</td>
          <td class="stellar">$0.00001</td>
          <td class="ethereum">$5-80 gas</td>
        </tr>
        <tr>
          <td>Code</td>
          <td class="stellar">~15 lines</td>
          <td class="ethereum">~200+ lines</td>
        </tr>
        <tr>
          <td>Audit</td>
          <td class="stellar">Not needed</td>
          <td class="ethereum">Recommended</td>
        </tr>
      </tbody>
    </table>
  `;

  resultPanel.appendChild(card);
}

// === Send Message Handler ===
async function handleSend() {
  const text = userInput.value.trim();
  if (!text || isWaiting) return;

  isWaiting = true;
  sendBtn.disabled = true;
  userInput.value = '';
  userInput.style.height = 'auto';

  addMessage('user', text);
  showTyping();

  try {
    const reply = await sendToClaud(text);
    removeTyping();

    const tokenConfig = extractTokenConfig(reply);
    const cleanText = cleanReplyText(reply);

    if (cleanText) {
      addMessage('assistant', cleanText);
    }

    if (tokenConfig) {
      await createStellarToken(tokenConfig);
    }
  } catch (error) {
    removeTyping();
    addMessage('assistant', 'Sorry, something went wrong. Please try again.');
    console.error(error);
  }

  isWaiting = false;
  sendBtn.disabled = false;
  userInput.focus();
}

// === Event Listeners ===
document.addEventListener('DOMContentLoaded', () => {
  initStars();

  sendBtn.addEventListener('click', handleSend);

  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Auto-resize textarea
  userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
  });
});
