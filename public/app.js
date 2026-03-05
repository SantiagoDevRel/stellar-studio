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
let apiKey = '';
let tokenState = null;

// === DOM Refs ===
const apiKeyScreen = document.getElementById('apiKeyScreen');
const apiKeyInput = document.getElementById('apiKeyInput');
const apiKeyBtn = document.getElementById('apiKeyBtn');
const mainApp = document.getElementById('mainApp');
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
    body: JSON.stringify({ messages: conversationHistory, apiKey }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'API request failed');

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
    updateCreatingStep(overlay, 'Generating issuer and distributor accounts...');
    const issuerKeypair = StellarSdk.Keypair.random();
    const distributorKeypair = StellarSdk.Keypair.random();

    updateCreatingStep(overlay, 'Funding accounts via Stellar Friendbot...');
    await Promise.all([
      fetch(`https://friendbot.stellar.org?addr=${issuerKeypair.publicKey()}`),
      fetch(`https://friendbot.stellar.org?addr=${distributorKeypair.publicKey()}`),
    ]);

    await new Promise(r => setTimeout(r, 2000));

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

    // Create 2 demo holder accounts to showcase admin features
    const demoHolders = [];
    for (let i = 1; i <= 2; i++) {
      updateCreatingStep(overlay, `Creating demo holder account ${i}/2...`);
      const holderKp = StellarSdk.Keypair.random();

      // Fund via friendbot
      await fetch(`https://friendbot.stellar.org?addr=${holderKp.publicKey()}`);

      // Establish trustline
      updateCreatingStep(overlay, `Setting up trustline for holder ${i}/2...`);
      const holderAccount = await server.loadAccount(holderKp.publicKey());
      const trustTx = new StellarSdk.TransactionBuilder(holderAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET,
      })
        .addOperation(StellarSdk.Operation.changeTrust({ asset }))
        .setTimeout(30)
        .build();
      trustTx.sign(holderKp);
      await server.submitTransaction(trustTx);

      // If auth_required, authorize this holder
      if (config.auth_required) {
        const issuerAcc = await server.loadAccount(issuerKeypair.publicKey());
        const authHolderTx = new StellarSdk.TransactionBuilder(issuerAcc, {
          fee: StellarSdk.BASE_FEE,
          networkPassphrase: StellarSdk.Networks.TESTNET,
        })
          .addOperation(StellarSdk.Operation.setTrustLineFlags({
            trustor: holderKp.publicKey(),
            asset,
            flags: { authorized: true },
          }))
          .setTimeout(30)
          .build();
        authHolderTx.sign(issuerKeypair);
        await server.submitTransaction(authHolderTx);
      }

      // Send 100 tokens from distributor
      updateCreatingStep(overlay, `Sending 100 ${config.code} to holder ${i}/2...`);
      const distAcc = await server.loadAccount(distributorKeypair.publicKey());
      const payTx = new StellarSdk.TransactionBuilder(distAcc, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET,
      })
        .addOperation(StellarSdk.Operation.payment({
          destination: holderKp.publicKey(),
          asset,
          amount: '100',
        }))
        .setTimeout(30)
        .build();
      payTx.sign(distributorKeypair);
      await server.submitTransaction(payTx);

      demoHolders.push(holderKp);
    }

    // Store state for admin dashboard
    // totalMinted tracks all tokens ever created; totalBurned tracks clawbacks
    tokenState = {
      config,
      issuerKeypair,
      distributorKeypair,
      demoHolders,
      asset,
      txHash: mintResult.hash,
      server,
      totalMinted: config.supply + 200,  // initial supply + 100 per demo holder
      totalBurned: 0,
    };

    removeCreatingOverlay(overlay);
    showAdminDashboard();
    addMessage('assistant', `Your **${config.code}** token has been created successfully on Stellar Testnet! Two demo holder accounts were created with 100 ${config.code} each so you can try freeze, unfreeze, and clawback from the admin dashboard.`);

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

// === Horizon Queries ===
async function fetchTokenHolders() {
  const { asset, server } = tokenState;
  const accounts = await server.accounts().forAsset(asset).limit(50).call();

  return accounts.records.map(account => {
    const balance = account.balances.find(
      b => b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer()
    );
    return {
      accountId: account.account_id,
      balance: balance ? balance.balance : '0',
      isAuthorized: balance ? balance.is_authorized : false,
      isAuthorizedToMaintainLiabilities: balance ? balance.is_authorized_to_maintain_liabilities : false,
      isDistributor: account.account_id === tokenState.distributorKeypair.publicKey(),
    };
  });
}

// === Admin Transactions ===
async function freezeAccount(trustorPublicKey) {
  const { issuerKeypair, asset, server } = tokenState;
  const StellarSdk = window.StellarSdk;
  const issuerAccount = await server.loadAccount(issuerKeypair.publicKey());
  const tx = new StellarSdk.TransactionBuilder(issuerAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(StellarSdk.Operation.setTrustLineFlags({
      trustor: trustorPublicKey,
      asset,
      flags: { authorized: false, authorizedToMaintainLiabilities: true },
    }))
    .setTimeout(30)
    .build();
  tx.sign(issuerKeypair);
  return await server.submitTransaction(tx);
}

async function unfreezeAccount(trustorPublicKey) {
  const { issuerKeypair, asset, server } = tokenState;
  const StellarSdk = window.StellarSdk;
  const issuerAccount = await server.loadAccount(issuerKeypair.publicKey());
  const tx = new StellarSdk.TransactionBuilder(issuerAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(StellarSdk.Operation.setTrustLineFlags({
      trustor: trustorPublicKey,
      asset,
      flags: { authorized: true },
    }))
    .setTimeout(30)
    .build();
  tx.sign(issuerKeypair);
  return await server.submitTransaction(tx);
}

async function clawbackTokens(fromPublicKey, amount) {
  const { issuerKeypair, asset, server } = tokenState;
  const StellarSdk = window.StellarSdk;
  const issuerAccount = await server.loadAccount(issuerKeypair.publicKey());
  const tx = new StellarSdk.TransactionBuilder(issuerAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(StellarSdk.Operation.clawback({
      asset,
      from: fromPublicKey,
      amount: amount.toString(),
    }))
    .setTimeout(30)
    .build();
  tx.sign(issuerKeypair);
  return await server.submitTransaction(tx);
}

async function mintTokens(amount) {
  const { issuerKeypair, distributorKeypair, asset, server } = tokenState;
  const StellarSdk = window.StellarSdk;
  const issuerAccount = await server.loadAccount(issuerKeypair.publicKey());
  const tx = new StellarSdk.TransactionBuilder(issuerAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(StellarSdk.Operation.payment({
      destination: distributorKeypair.publicKey(),
      asset,
      amount: amount.toString(),
    }))
    .setTimeout(30)
    .build();
  tx.sign(issuerKeypair);
  return await server.submitTransaction(tx);
}

// === Admin Dashboard UI ===
function showAdminDashboard() {
  const { config, issuerKeypair, distributorKeypair, txHash } = tokenState;
  resultPanel.innerHTML = '';
  resultPanel.classList.add('visible');

  // Dashboard header — compact
  const header = document.createElement('div');
  header.className = 'dashboard-header';
  header.innerHTML = `
    <div class="dashboard-title-row">
      <div class="dashboard-icon">${config.code.slice(0, 2)}</div>
      <div>
        <div class="dashboard-title">${config.code}</div>
        <div class="dashboard-subtitle">${config.name || config.code} \u2014 Admin Dashboard</div>
      </div>
      <a href="https://stellar.expert/explorer/testnet/tx/${txHash}" target="_blank" rel="noopener" class="explorer-link-small" style="margin-left:auto;margin-top:0">
        Explorer \u2197
      </a>
    </div>
  `;
  resultPanel.appendChild(header);

  // Supply stats bar (circulating supply + mint button)
  const statsBar = document.createElement('div');
  statsBar.className = 'dashboard-stats-bar';
  statsBar.innerHTML = `
    <div class="stats-row">
      <div class="stat-item">
        <span class="stat-label">Circulating</span>
        <span class="stat-value" id="circulatingSupply">\u2014</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Total Minted</span>
        <span class="stat-value" id="mintedTotal">\u2014</span>
      </div>
      <div class="stat-item burned">
        <span class="stat-label">\ud83d\udd25 Burned</span>
        <span class="stat-value" id="totalBurned">0</span>
      </div>
    </div>
    <div class="mint-row">
      <button class="action-btn mint-btn" id="mintBtn">\u2728 Mint Tokens</button>
      <button class="info-btn" data-tooltip="Mint creates new tokens from the issuer and sends them to the distributor account. On Stellar, the issuer has unlimited minting power \u2014 there is no hard cap enforced by the protocol.">i</button>
    </div>
  `;
  resultPanel.appendChild(statsBar);

  // Wire mint button
  document.getElementById('mintBtn').addEventListener('click', async () => {
    const amount = prompt('How many ' + config.code + ' tokens to mint to the distributor?');
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) return;
    const btn = document.getElementById('mintBtn');
    btn.disabled = true;
    btn.classList.add('loading');
    btn.innerHTML = '<span class="mini-spinner"></span>Minting...';
    try {
      await mintTokens(amount);
      tokenState.totalMinted += parseFloat(amount);
      showActionToast('Minted ' + parseFloat(amount).toLocaleString() + ' ' + config.code);
      await refreshHoldersList();
    } catch (error) {
      showActionToast('Mint failed: ' + error.message, true);
    }
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.innerHTML = '\u2728 Mint Tokens';
  });

  // Wire info button in stats bar
  statsBar.querySelectorAll('.info-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showTooltip(btn, btn.dataset.tooltip);
    });
  });

  // Token info card — collapsed by default for space
  const infoCard = document.createElement('div');
  infoCard.className = 'dashboard-card token-info-card collapsed';
  infoCard.innerHTML = `
    <div class="dashboard-card-header" onclick="this.parentElement.classList.toggle('collapsed')">
      <span>Token Details</span>
      <span class="collapse-chevron">\u25BC</span>
    </div>
    <div class="dashboard-card-body">
      <div class="token-detail">
        <span class="token-detail-label">Issuer</span>
        <span class="token-detail-value code">${issuerKeypair.publicKey().slice(0, 8)}...${issuerKeypair.publicKey().slice(-8)}</span>
      </div>
      <div class="token-detail">
        <span class="token-detail-label">Distributor</span>
        <span class="token-detail-value code">${distributorKeypair.publicKey().slice(0, 8)}...${distributorKeypair.publicKey().slice(-8)}</span>
      </div>
      <div class="token-flags-row">
        <div class="flag-with-info">
          <span class="flag-badge ${config.auth_required ? 'on' : 'off'}">Auth Required: ${config.auth_required ? 'ON' : 'OFF'}</span>
          <button class="info-btn" data-tooltip="AUTH_REQUIRED is a Stellar protocol flag. When ON, any account that wants to hold your token must first be approved by the issuer. Without approval, they can create a trustline but can't receive tokens. Used by regulated assets like bank tokens or securities.">i</button>
        </div>
        <div class="flag-with-info">
          <span class="flag-badge ${config.auth_revocable ? 'on' : 'off'}">Revocable: ${config.auth_revocable ? 'ON' : 'OFF'}</span>
          <button class="info-btn" data-tooltip="AUTH_REVOCABLE is a Stellar protocol flag. When ON, the issuer can freeze any account's ability to send or receive the token. The account keeps its balance but can't move it. Think of it like a bank freezing a suspicious account. Required for clawback to work.">i</button>
        </div>
        <div class="flag-with-info">
          <span class="flag-badge ${config.clawback_enabled ? 'on' : 'off'}">Clawback: ${config.clawback_enabled ? 'ON' : 'OFF'}</span>
          <button class="info-btn" data-tooltip="AUTH_CLAWBACK_ENABLED is a Stellar protocol flag. When ON, the issuer can pull tokens back from any holder's account — the tokens are burned (destroyed), reducing the circulating supply. Like a bank reversing a fraudulent transaction. Automatically enables auth_revocable.">i</button>
        </div>
      </div>
    </div>
  `;
  resultPanel.appendChild(infoCard);

  // Wire info buttons on flag badges
  infoCard.querySelectorAll('.info-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showTooltip(btn, btn.dataset.tooltip);
    });
  });

  // Holders section
  const holdersSection = document.createElement('div');
  holdersSection.className = 'dashboard-card holders-section';
  holdersSection.innerHTML = `
    <div class="holders-header">
      <span>Token Holders</span>
      <div class="holders-header-right">
        <span class="holders-count" id="holdersCount">...</span>
        <button class="refresh-btn" id="refreshHoldersBtn" title="Refresh holders">\u21BB</button>
      </div>
    </div>
    <div class="holders-list" id="holdersList">
      <div class="holders-loading"><div class="mini-spinner"></div>Loading holders...</div>
    </div>
  `;
  resultPanel.appendChild(holdersSection);

  document.getElementById('refreshHoldersBtn').addEventListener('click', refreshHoldersList);

  refreshHoldersList();
}

async function refreshHoldersList() {
  const listEl = document.getElementById('holdersList');
  const countEl = document.getElementById('holdersCount');
  if (!listEl || !countEl) return;

  listEl.innerHTML = '<div class="holders-loading"><div class="mini-spinner"></div>Fetching holders...</div>';

  try {
    const holders = await fetchTokenHolders();
    countEl.textContent = holders.length;
    listEl.innerHTML = '';

    // Update supply stats
    const circulating = holders.reduce((sum, h) => sum + parseFloat(h.balance), 0);
    const code = tokenState.config.code;
    const circulatingEl = document.getElementById('circulatingSupply');
    const mintedEl = document.getElementById('mintedTotal');
    const burnedEl = document.getElementById('totalBurned');
    if (circulatingEl) circulatingEl.textContent = circulating.toLocaleString() + ' ' + code;
    if (mintedEl) mintedEl.textContent = tokenState.totalMinted.toLocaleString() + ' ' + code;
    if (burnedEl) burnedEl.textContent = tokenState.totalBurned.toLocaleString() + ' ' + code;

    if (holders.length === 0) {
      listEl.innerHTML = '<div class="holders-empty">No holders found</div>';
      return;
    }

    holders.forEach(holder => {
      listEl.appendChild(createHolderRow(holder));
    });
  } catch (error) {
    listEl.innerHTML = `<div class="holders-error">Failed to load: ${error.message}</div>`;
  }
}

function createHolderRow(holder) {
  const { config } = tokenState;
  const row = document.createElement('div');
  row.className = 'holder-row';

  const truncId = `${holder.accountId.slice(0, 6)}...${holder.accountId.slice(-6)}`;
  let label = '';
  if (holder.isDistributor) {
    label = '<span class="distributor-badge">Distributor</span>';
  } else {
    const demoIdx = (tokenState.demoHolders || []).findIndex(kp => kp.publicKey() === holder.accountId);
    if (demoIdx >= 0) label = `<span class="distributor-badge demo">Holder ${demoIdx + 1}</span>`;
  }

  let authStatus = '';
  if (config.auth_required || config.auth_revocable) {
    if (holder.isAuthorized) {
      authStatus = '<span class="auth-badge authorized">Authorized</span>';
    } else if (holder.isAuthorizedToMaintainLiabilities) {
      authStatus = '<span class="auth-badge frozen">Frozen</span>';
    } else {
      authStatus = '<span class="auth-badge unauthorized">Unauthorized</span>';
    }
  }

  const freezeEnabled = config.auth_revocable || config.clawback_enabled;
  const clawbackEnabled = config.clawback_enabled;
  const isFrozen = !holder.isAuthorized && holder.isAuthorizedToMaintainLiabilities;

  row.innerHTML = `
    <div class="holder-info">
      <div class="holder-account">
        <span class="holder-id">${truncId}</span>${label}
      </div>
      <div class="holder-meta">
        <span class="holder-balance">${parseFloat(holder.balance).toLocaleString()} ${config.code}</span>
        ${authStatus}
      </div>
    </div>
    <div class="holder-actions">
      <div class="action-btn-wrapper">
        <button class="action-btn ${freezeEnabled ? '' : 'disabled'} ${isFrozen ? 'active' : ''}"
                data-action="${isFrozen ? 'unfreeze' : 'freeze'}"
                ${freezeEnabled ? '' : 'disabled'}>
          ${isFrozen ? '\u2600 Unfreeze' : '\u2744 Freeze'}
        </button>
        <button class="info-btn" data-tooltip="${freezeEnabled
          ? (isFrozen
            ? 'Unfreeze restores this account\u2019s ability to send and receive your token. Uses setTrustLineFlags to re-authorize the trustline.'
            : 'Freeze prevents this account from sending or receiving your token. Uses the auth_revocable flag via setTrustLineFlags on the issuer.')
          : 'Freeze is unavailable because this token was not created with the auth_revocable flag enabled.'}">i</button>
      </div>
      <div class="action-btn-wrapper">
        <button class="action-btn ${clawbackEnabled ? '' : 'disabled'}"
                data-action="clawback"
                ${clawbackEnabled ? '' : 'disabled'}>
          \u21A9 Clawback
        </button>
        <button class="info-btn" data-tooltip="${clawbackEnabled
          ? 'Clawback BURNS (destroys) tokens from this account — they are permanently removed from circulation, not returned anywhere. The issuer can mint new tokens if needed. Uses Stellar\u2019s clawback operation.'
          : 'Clawback is unavailable because this token was not created with the clawback_enabled flag.'}">i</button>
      </div>
    </div>
  `;

  // Wire up action buttons
  row.querySelectorAll('.action-btn:not(.disabled)').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      btn.disabled = true;
      btn.classList.add('loading');

      try {
        if (action === 'freeze') {
          await freezeAccount(holder.accountId);
        } else if (action === 'unfreeze') {
          await unfreezeAccount(holder.accountId);
        } else if (action === 'clawback') {
          const amount = prompt('How many ' + config.code + ' to claw back and BURN?\n\nCurrent balance: ' + holder.balance + '\n\nNote: clawed-back tokens are destroyed permanently.');
          if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
            btn.disabled = false;
            btn.classList.remove('loading');
            return;
          }
          await clawbackTokens(holder.accountId, amount);
          tokenState.totalBurned += parseFloat(amount);
        }
        showActionToast(action === 'clawback' ? 'Clawback successful — tokens burned' : action + ' successful');
        await refreshHoldersList();
      } catch (error) {
        showActionToast(`${action} failed: ${error.message}`, true);
        btn.disabled = false;
        btn.classList.remove('loading');
      }
    });
  });

  // Wire up info buttons
  row.querySelectorAll('.info-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showTooltip(btn, btn.dataset.tooltip);
    });
  });

  return row;
}

// === Tooltip ===
function showTooltip(anchor, text) {
  const existing = document.querySelector('.admin-tooltip');
  if (existing) existing.remove();

  const tooltip = document.createElement('div');
  tooltip.className = 'admin-tooltip';
  tooltip.textContent = text;
  document.body.appendChild(tooltip);

  const rect = anchor.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 8;

  // Vertical: prefer below, but flip above if it would overflow bottom
  const spaceBelow = vh - rect.bottom - margin;
  const spaceAbove = rect.top - margin;

  if (spaceBelow >= tooltipRect.height + margin) {
    tooltip.style.top = (rect.bottom + margin) + 'px';
  } else if (spaceAbove >= tooltipRect.height + margin) {
    tooltip.style.top = (rect.top - tooltipRect.height - margin) + 'px';
  } else {
    // Neither fits well — center vertically and cap within viewport
    tooltip.style.top = Math.max(margin, Math.min(vh - tooltipRect.height - margin, rect.top - tooltipRect.height / 2)) + 'px';
  }

  // Horizontal: center on button, but clamp within viewport
  let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
  left = Math.max(margin, Math.min(left, vw - tooltipRect.width - margin));
  tooltip.style.left = left + 'px';

  setTimeout(() => tooltip.remove(), 5000);
  document.addEventListener('click', () => tooltip.remove(), { once: true });
}

// === Toast ===
function showActionToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.className = `action-toast ${isError ? 'error' : 'success'}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
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
    const msg = error.message.includes('authentication')
      ? 'Invalid API key. Please refresh and try again with a valid key.'
      : `Sorry, something went wrong: ${error.message}`;
    addMessage('assistant', msg);
    console.error(error);
  }

  isWaiting = false;
  sendBtn.disabled = false;
  userInput.focus();
}

// === API Key Screen ===
function handleApiKey() {
  const key = apiKeyInput.value.trim();
  if (!key || !key.startsWith('sk-')) return;

  apiKey = key;
  apiKeyScreen.classList.add('hidden');
  mainApp.classList.remove('hidden');
  userInput.focus();
}

// === Event Listeners ===
document.addEventListener('DOMContentLoaded', () => {
  initStars();

  apiKeyBtn.addEventListener('click', handleApiKey);
  apiKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleApiKey();
  });

  sendBtn.addEventListener('click', handleSend);

  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
  });
});
