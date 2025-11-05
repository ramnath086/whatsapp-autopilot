/**
 * send_daily_wweb.js
 * Production-ready autopilot for sending daily quotes via WhatsApp (whatsapp-web.js)
 *
 * Requirements:
 *  - quotes_cloudinary.json (array of { text, image })
 *  - contacts.json (array of { name, phone })
 *  - unsubscribe_handler.js (optional, will be required if present)
 *  - Environment variables (set in Render or .env locally):
 *      CRON_SCHEDULE (e.g. "30 5 * * *")
 *      CRON_TIMEZONE (e.g. "Asia/Kolkata")
 *      PORT (optional)
 *
 * Usage: node send_daily_wweb.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const express = require('express');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const LOG_FILE = path.join(__dirname, 'send_log.log');
const QUOTES_FILE = path.join(__dirname, 'quotes_cloudinary.json');
const CONTACTS_FILE = path.join(__dirname, 'contacts.json');

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch(e){}
}

// --- Express keep-alive + QR endpoint setup ---
const app = express();
let currentQR = null; // data URL

app.get('/', (req, res) => res.send('✅ WhatsApp Autopilot running'));
app.get('/qr', (req, res) => {
  if (!currentQR) return res.status(404).send('QR not ready yet — try again in a few seconds.');
  const html = `
    <html>
      <body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#0b0b0b;margin:0">
        <div style="text-align:center;">
          <img src="${currentQR}" style="width:360px;height:360px;border:6px solid #fff;border-radius:8px;display:block;margin:0 auto"/>
          <p style="color:#fff;font-family:Arial,Helvetica,sans-serif">Scan this QR with WhatsApp → Linked Devices → Link a Device</p>
        </div>
      </body>
    </html>`;
  res.send(html);
});

// optional status route
app.get('/status', (req, res) => res.json({ ready: !!clientReadyFlag, quotes: safeLoadQuotes().length }));

// --- WhatsApp client init ---
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "autopilot" }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  }
});

let clientReadyFlag = false;

// QR event -> store PNG data URL for browser route
client.on('qr', async (qr) => {
  try {
    currentQR = await qrcode.toDataURL(qr);
    log('QR ready — open /qr to scan.');
  } catch (err) {
    console.error('QR -> dataURL error', err);
  }
});

// ready event
client.on('ready', () => {
  clientReadyFlag = true;
  log('WhatsApp client ready. Scheduling daily job:', process.env.CRON_SCHEDULE || '30 5 * * *', 'TZ=' + (process.env.CRON_TIMEZONE || 'Asia/Kolkata'));
  // clear stored QR once ready
  currentQR = null;
});

// handle auth failure
client.on('auth_failure', (msg) => {
  log('Auth failure:', msg);
});

// ensure unsubscribe handler if exists
try {
  const registerUnsubscribe = require('./unsubscribe_handler');
  registerUnsubscribe(client);
  log('unsubscribe_handler loaded');
} catch (e) {
  log('No unsubscribe_handler found — skipping (optional)');
}

// helper: load quotes & contacts safely
function safeLoadQuotes() {
  try {
    const raw = fs.readFileSync(QUOTES_FILE, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch (e) {
    return [];
  }
}
function safeLoadContacts() {
  try {
    const raw = fs.readFileSync(CONTACTS_FILE, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch (e) {
    return [];
  }
}

// send one quote to all contacts (index input)
async function sendQuoteToAll(index = 0) {
  const quotes = safeLoadQuotes();
  const contacts = safeLoadContacts();
  if (!quotes.length) {
    log('No quotes found to send.');
    return;
  }
  const q = quotes[index % quotes.length];
  log(`Sending quote index ${index} -> "${q.text?.slice(0,80)}..." to ${contacts.length} contacts`);
  for (const c of contacts) {
    try {
      if (!c.phone) { log('Skipping contact missing phone:', JSON.stringify(c)); continue; }
      const phoneDigits = c.phone.replace(/\D/g,'');
      if (!phoneDigits) continue;
      const chatId = phoneDigits + '@c.us';
      await client.sendMessage(chatId, { url: q.image }, { caption: q.text });
      log('Sent to', c.name || phoneDigits);
    } catch (err) {
      log('Send failed for', c.name || c.phone, '->', err.message || err);
    }
  }
}

// Scheduler setup
function startScheduler() {
  const scheduleExpr = process.env.CRON_SCHEDULE || '30 5 * * *';
  const tz = process.env.CRON_TIMEZONE || 'Asia/Kolkata';
  try {
    cron.schedule(scheduleExpr, async () => {
      try {
        if (!clientReadyFlag) { log('Client not ready yet — skipping scheduled send'); return; }
        // pick a rotating index based on day (or use random)
        const quotes = safeLoadQuotes();
        if (!quotes.length) { log('No quotes to send.'); return; }
        const dayIndex = Math.floor((Date.now() / (1000 * 60 * 60 * 24))) % quotes.length;
        await sendQuoteToAll(dayIndex);
        log('Scheduled run complete.');
      } catch (inner) {
        log('Scheduled run error:', inner.message || inner);
      }
    }, { timezone: tz });
    log('Scheduler initialized. Waiting for first run.');
  } catch (e) {
    log('Failed to initialize cron:', e.message || e);
  }
}

// start express server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  log(`Keep-alive & QR server running on port ${PORT}`);
});

// initialize WhatsApp client and scheduler
client.initialize().then(() => {
  startScheduler();
}).catch(err => {
  log('client.initialize() error', err);
});

// graceful shutdown
process.on('SIGINT', async () => {
  log('SIGINT received — shutting down');
  try { await client.destroy(); } catch(e){}
  process.exit(0);
});
process.on('SIGTERM', async () => {
  log('SIGTERM received — shutting down');
  try { await client.destroy(); } catch(e){}
  process.exit(0);
});
