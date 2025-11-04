
/**
 * send_daily_wweb.js
 * - Uses whatsapp-web.js + LocalAuth for persistent login
 * - Internal scheduler (node-cron) to run daily at configured time (default 09:00 Asia/Kolkata)
 * - Rotates quotes by day-of-year
 * - Sends image (by URL) with caption to each contact
 * - Throttles, retries, logs
 */

const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fetch = require('node-fetch');
const pRetry = require('p-retry');
const winston = require('winston');
const cron = require('node-cron');
require('dotenv').config();

const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(info => `${info.timestamp} ${info.level.toUpperCase()}: ${info.message}`)
  ),
  transports: [
    new winston.transports.File({ filename: path.join(LOG_DIR, 'whatsapp.log') }),
    new winston.transports.Console()
  ]
});

const CONTACTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'contacts.json')));
const QUOTES = JSON.parse(fs.readFileSync(path.join(__dirname, 'quotes.json')));

// Scheduler: default cron schedule '0 9 * * *' (09:00 daily). You can override via .env CRON_SCHEDULE
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 9 * * *';
const CRON_TIMEZONE = process.env.CRON_TIMEZONE || 'Asia/Kolkata';

function getDayOfYear(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d - start;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

function selectQuoteForToday() {
  const idx = getDayOfYear() % QUOTES.length;
  return QUOTES[idx];
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'spiritual-daily-session' }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', qr => {
  logger.info('QR code received — scan with WhatsApp mobile app (Linked Devices -> Link a device).');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  logger.info('WhatsApp client ready. Scheduling daily job: ' + CRON_SCHEDULE + ' TZ=' + CRON_TIMEZONE);
  // Schedule the job
  cron.schedule(CRON_SCHEDULE, async () => {
    logger.info('Cron triggered: sending today\'s quote.');
    await runSendLoop();
  }, { timezone: CRON_TIMEZONE });
  logger.info('Scheduler initialized. Waiting for first run.');
});

// helper: sleep ms
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// helper: format chat id
function toChatId(phone) { const digits = phone.replace(/\D/g, ''); return `${digits}@c.us`; }

// fetch remote URL and convert to MessageMedia
async function fetchMediaFromUrl(url) {
  return await pRetry(async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Image fetch failed: ' + res.status);
    const buffer = await res.buffer();
    const mime = res.headers.get('content-type') || 'image/jpeg';
    const base64 = buffer.toString('base64');
    const data = `data:${mime};base64,${base64}`;
    return MessageMedia.fromDataURL(data);
  }, { retries: 2 });
}

async function sendToContact(contact, quote) {
  const chatId = toChatId(contact.phone);
  const caption = `Hi ${contact.name},\n\n${quote.text}`;
  const media = await fetchMediaFromUrl(quote.image);
  if (!media) throw new Error('Failed to fetch media');
  return client.sendMessage(chatId, media, { caption });
}

async function runSendLoop() {
  const quote = selectQuoteForToday();
  logger.info('Selected quote: ' + quote.text);
  for (const c of CONTACTS) {
    try {
      await pRetry(() => sendToContact(c, quote), { retries: 2, factor: 1.4 });
      logger.info(`Sent to ${c.phone}`);
    } catch (err) {
      logger.error(`Failed to send to ${c.phone}: ${err.message}`);
    }
    await sleep(2000 + Math.floor(Math.random() * 1500));
  }
  logger.info('Send loop completed.');
}


// Unsubscribe / incoming message handler
// If a contact texts "STOP", "UNSUBSCRIBE", or similar, we'll remove them from contacts.json and confirm.
client.on('message', async msg => {
  try {
    const body = (msg.body || '').trim().toLowerCase();
    const stopKeywords = ['stop', 'unsubscribe', 'stop messages', 'stop now', 'cancel'];
    if (stopKeywords.includes(body)) {
      // derive phone from msg.from (format like '9199xxxxxxx@c.us' or '9199xxxxxxx@us')
      const from = msg.from || '';
      const phone = from.split('@')[0];
      if (!phone) return;
      const contactsPath = path.join(__dirname, 'contacts.json');
      const contacts = JSON.parse(fs.readFileSync(contactsPath, 'utf8'));
      const idx = contacts.findIndex(c => c.phone.replace(/\\D/g,'') === phone.replace(/\\D/g,''));
      if (idx !== -1) {
        const removed = contacts.splice(idx, 1)[0];
        fs.writeFileSync(contactsPath, JSON.stringify(contacts, null, 2), 'utf8');
        logger.info(`Unsubscribed and removed ${removed.name} (${removed.phone}) via STOP message.`);
        await msg.reply('You have been unsubscribed from daily messages. If this was a mistake, reply JOIN or contact the sender.');
      } else {
        // If not found by exact phone, try matching by name in message (not typical)
        await msg.reply('We did not find your number in the subscription list. If you want to unsubscribe, reply STOP from the subscribed number.');
      }
    } else if (body === 'join' || body === 'start') {
      await msg.reply('To subscribe, please ask the sender to add your number. This account accepts subscriptions only from the owner.');
    }
  } catch (e) {
    logger.error('Error processing incoming message: ' + (e.message || e));
  }
});

client.initialize();
