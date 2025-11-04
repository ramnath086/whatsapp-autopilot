# WhatsApp Spiritual Autopilot — Fallback (whatsapp-web.js)

**What this package contains**
- `send_daily_wweb.js` — main Node.js script with internal scheduler (node-cron). Scans QR once, then runs daily at configured time.
- `package.json` — dependencies and start script.
- `contacts.json` — placeholder contacts (you must replace with your opted-in list).
- `quotes.json` — 120 spiritual motivational quotes with inspirational photo background URLs (Unsplash dynamic images).
- `.env` — scheduler config (default 09:00 Asia/Kolkata).
- `logs/` — auto-created log folder after first run.

**Quick setup (Linux / macOS / WSL)**
1. Install Node.js 16+.
2. Unzip the package and `cd` into the folder.
3. Install dependencies:
   ```
   npm install
   ```
4. Edit `contacts.json` and add contacts (name + phone with country code). Make sure each contact has opted in.
5. (Optional) Change send time in `.env` via `CRON_SCHEDULE`.
6. First run to authenticate:
   ```
   node send_daily_wweb.js
   ```
   - A QR code will appear in the terminal. Open WhatsApp on your phone → Menu → Linked devices → Link a device → scan the QR.
   - Session will be saved automatically in LocalAuth; subsequent runs will be headless.

**Run as a persistent service (recommended)**
- Using PM2:
  ```
  npm install -g pm2
  pm2 start send_daily_wweb.js --name whatsapp-spiritual-autopilot
  pm2 save
  ```
  PM2 will keep the process alive and the internal scheduler will trigger daily sends.

- Or run once daily via cron (if you prefer):
  Edit `crontab -e` and add:
  ```
  @reboot /usr/bin/node /path/to/send_daily_wweb.js >> /path/to/logs/cron.log 2>&1
  ```
  The script itself contains a scheduler; ensure the process is running (use PM2 or systemd) so node-cron can trigger daily jobs.

**Notes & warnings**
- This uses WhatsApp Web automation (not the official Cloud API). Keep list small and ensure opt-ins. Excessive automation may risk WhatsApp restrictions.
- Images use Unsplash dynamic URLs (source.unsplash.com). They return high-quality inspirational photos based on keywords.
- Monitor `logs/whatsapp.log` for errors and delivery issues.
- To unsubscribe a contact, remove them from `contacts.json` or implement a reply-parser (advanced).

**Need help?**
If you want, I can:
- Replace placeholder contacts with your real list (paste CSV),
- Generate 30 unique image files uploaded to Cloudinary and update `quotes.json` with direct links,
- Add an unsubscribe auto-handler that removes numbers on 'STOP' reply.

Enjoy — your package is ready to download.

## New features added
- `upload_images_cloudinary.js` — server-side Cloudinary uploader: fetches remote images from `quotes.json`, uploads them to your Cloudinary account (requires credentials in `.env`) and updates `quotes.json` with Cloudinary `secure_url` links.
  - Install dependencies: `npm install cloudinary dotenv`
  - Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` in `.env`
  - Run: `node upload_images_cloudinary.js`

- Unsubscribe handler — The WhatsApp client now listens for incoming messages. If a subscribed contact replies with `STOP`, `UNSUBSCRIBE`, or similar, they will be removed from `contacts.json` automatically and receive a confirmation reply.

Please test Cloudinary uploads with a small sample first to ensure your Cloudinary account has capacity.
