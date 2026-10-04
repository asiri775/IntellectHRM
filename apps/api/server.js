// Entry point for cPanel "Setup Node.js App" (Phusion Passenger) and other hosts
// that start a single file. Loads apps/api/.env (if present) without overriding
// variables already set by the host, then starts the API.
const fs = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const raw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1); // quoted value, keep # inside
    else value = value.replace(/\s+#.*$/, ''); // strip trailing comment
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

require('./dist/src/main.js');
