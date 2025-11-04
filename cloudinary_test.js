// cloudinary_test.js  (robust)
// Downloads a stable image (picsum) into a buffer then uploads to Cloudinary via upload_stream.
// Requires: npm install cloudinary dotenv node-fetch streamifier

const cloudinary = require('cloudinary').v2;
const fetch = require('node-fetch');
const streamifier = require('streamifier');
require('dotenv').config();

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('Missing CLOUDINARY_* in .env');
  process.exit(1);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Use a stable placeholder service (picsum) which is usually reliable.
// If you prefer another image, replace this URL with any direct-image URL.
const testUrl = 'https://picsum.photos/1200/800';

(async () => {
  try {
    console.log('Downloading test image from:', testUrl);
    const res = await fetch(testUrl, { timeout: 20000 });
    if (!res.ok) throw new Error('Image download failed: ' + res.status + ' ' + res.statusText);
    const buffer = await res.buffer();
    console.log('Downloaded', buffer.length, 'bytes. Uploading to Cloudinary...');

    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream({
        folder: 'spiritual_quotes_test',
        use_filename: true,
        unique_filename: false,
        resource_type: 'image'
      }, (error, result) => {
        if (error) return reject(error);
        resolve(result);
      });
      streamifier.createReadStream(buffer).pipe(uploadStream);
    });

    console.log('Upload OK:', uploadResult.secure_url);
  } catch (err) {
    console.error('Upload failed:', err.message || err);
    process.exit(2);
  }
})();
