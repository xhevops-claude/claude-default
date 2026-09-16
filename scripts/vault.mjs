#!/usr/bin/env node
/* Arcade vault — encrypts the private data of apps/forecast and apps/expenses.
 *
 * The site is static and the repo is public, so anything the browser can fetch
 * anyone can fetch. A login screen would be theatre; only the encryption is
 * real. So the plaintext is gitignored and only ciphertext is committed:
 *
 *   apps/<app>/data/vault.json        the app's data, encrypted
 *   apps/expenses/files/<guid>.enc    each attachment, encrypted on its own so
 *                                     the app fetches one only when opened
 *
 *   node scripts/vault.mjs lock [forecast|expenses|all]
 *   node scripts/vault.mjs unlock [forecast|expenses|all]
 *   node scripts/vault.mjs rekey
 *
 * The secret is the passphrase and the PIN joined by a NUL, which neither can
 * contain. Both apps join them the same way — change it in one place and you
 * must change it everywhere or nothing opens.
 *
 * Envelope encryption. A random data key encrypts the content and never
 * changes; your passphrase only ever encrypts THAT key. So changing the
 * passphrase rewrites about a hundred bytes instead of every file — which
 * matters because ciphertext does not compress, and git would otherwise keep a
 * fresh copy of all 8.6 MB of scans for every password change, forever.
 *
 * What the browser caches is the wrapping key, not the data key, so a password
 * change still drops every device back to the lock screen. Evicting a device
 * from data it has ALREADY seen is a different job: `rekey --full` mints a new
 * data key and re-encrypts everything.
 *
 * Both vaults deliberately carry the same salt and the same wrapped data key,
 * so one unlock covers the whole site. The IV is fresh on every encryption,
 * which is what AES-GCM actually requires.
 *
 * Secrets come from the environment — FORECAST_PASSPHRASE / FORECAST_PIN, plus
 * FORECAST_NEW_* for rekey — so they never land in shell history.
 */
import { webcrypto as crypto } from 'node:crypto';
import { readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ITERATIONS = 600000;

const FORECAST_DIR = path.join(ROOT, 'apps', 'forecast', 'data');
const EXPENSES_DIR = path.join(ROOT, 'apps', 'expenses', 'data');
const EXPENSES_FILES = path.join(ROOT, 'apps', 'expenses', 'files');

const FORECAST_FILES = ['meta', 'income', 'loans', 'liabilities', 'budget',
  'extras', 'calendar', 'investments'];

const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

async function deriveKey(secret, salt) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

function secretFrom(passVar, pinVar) {
  const pass = process.env[passVar];
  const pin = process.env[pinVar];
  if (!pass || !pin) {
    console.error(`Set both ${passVar} and ${pinVar}, then run again.`);
    process.exit(1);
  }
  return `${pass}\u0000${pin}`;
}

function vaultPath(app) {
  return path.join(app === 'forecast' ? FORECAST_DIR : EXPENSES_DIR, 'vault.json');
}

function hasVault(app) {
  return existsSync(vaultPath(app));
}

// A vault that will not open is a wrong secret; one that is not there yet is
// simply not there. Conflating the two made rekey report a bad passphrase and
// quietly do nothing.
function failedToOpen(err) {
  console.error('Wrong passphrase or PIN — nothing was opened.');
  if (process.env.VAULT_DEBUG) console.error(err);
  process.exit(1);
}

// Whichever vault already exists dictates the salt, so both stay in step.
async function existingSalt() {
  for (const app of ['forecast', 'expenses']) {
    const p = vaultPath(app);
    if (existsSync(p)) return unb64(JSON.parse(await readFile(p, 'utf8')).kdf.salt);
  }
  return null;
}

async function newDataKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true,
    ['encrypt', 'decrypt']);
}

async function wrapKey(kek, dek) {
  const raw = await crypto.subtle.exportKey('raw', dek);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw);
  return { iv: b64(iv), ct: b64(ct) };
}

async function unwrapKey(kek, wrapped) {
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(wrapped.iv) }, kek, unb64(wrapped.ct));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);
}

/* The data key of whichever vault already exists, so a re-lock keeps using it
 * and previously encrypted attachments still open. v1 vaults encrypted the
 * content directly under the passphrase key and carry no wrapped key; those
 * get a fresh data key and are written out as v2. */
async function existingDataKey(kek) {
  for (const app of ['forecast', 'expenses']) {
    if (!hasVault(app)) continue;
    const vault = JSON.parse(await readFile(vaultPath(app), 'utf8'));
    if (!vault.wrappedKey) return null;
    return unwrapKey(kek, vault.wrappedKey);
  }
  return null;
}

async function encryptJson(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
    new TextEncoder().encode(JSON.stringify(value)));
  return { iv: b64(iv), ct: b64(ct) };
}

async function decryptJson(key, vault) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(vault.iv) }, key, unb64(vault.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

function wrap(salt, wrappedKey, body) {
  return JSON.stringify({
    v: 2,
    note: 'Encrypted. See scripts/vault.mjs.',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: b64(salt) },
    cipher: 'AES-GCM',
    wrappedKey,
    ...body,
  }, null, 2) + '\n';
}

// Re-wraps the data key under a new passphrase without touching the content.
async function rewrap(app, salt, wrappedKey) {
  const vault = JSON.parse(await readFile(vaultPath(app), 'utf8'));
  vault.v = 2;
  vault.kdf = { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: b64(salt) };
  vault.wrappedKey = wrappedKey;
  await writeFile(vaultPath(app), JSON.stringify(vault, null, 2) + '\n');
}

// A v1 vault has its content under the passphrase key itself.
function contentKey(vault, kek, dek) {
  return vault.wrappedKey ? dek : kek;
}

/* ------------------------------------------------------------------ walking */

// Every .json under a directory, keyed by its path relative to that directory.
async function collectJson(dir, base = dir, out = {}) {
  if (!existsSync(dir)) return out;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectJson(full, base, out);
    else if (entry.name.endsWith('.json')) {
      out[path.relative(base, full)] = JSON.parse(await readFile(full, 'utf8'));
    }
  }
  return out;
}

async function writeJsonTree(dir, tree) {
  for (const [rel, value] of Object.entries(tree)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, JSON.stringify(value, null, 2) + '\n');
  }
}

/* ------------------------------------------------------------------ forecast */

async function lockForecast(key, salt, wrapped) {
  const bundle = {};
  for (const name of FORECAST_FILES) {
    const file = path.join(FORECAST_DIR, `${name}.json`);
    if (!existsSync(file)) {
      console.error(`forecast: missing ${name}.json — unlock first.`);
      process.exit(1);
    }
    bundle[name] = JSON.parse(await readFile(file, 'utf8'));
  }
  await writeFile(vaultPath('forecast'),
    wrap(salt, wrapped, await encryptJson(key, bundle)));
  console.log(`forecast: locked ${FORECAST_FILES.length} files`);
}

async function unlockForecast(kek, dek) {
  const vault = JSON.parse(await readFile(vaultPath('forecast'), 'utf8'));
  const bundle = await decryptJson(contentKey(vault, kek, dek), vault);
  for (const name of FORECAST_FILES) {
    await writeFile(path.join(FORECAST_DIR, `${name}.json`),
      JSON.stringify(bundle[name], null, 2) + '\n');
  }
  console.log(`forecast: unlocked ${FORECAST_FILES.length} files`);
}

/* ------------------------------------------------------------------ expenses */

/* The ledger goes in whole — the registries, every per-expense source file and
 * the generated aggregate the app actually reads — so a later session can
 * restore the working tree from the vault alone. Attachments are encrypted one
 * by one instead, so opening the app does not mean downloading and decrypting
 * megabytes of scans nobody asked to see. */
async function lockExpenses(key, salt, wrapped) {
  const aggregate = path.join(EXPENSES_DIR, 'expenses.json');
  if (!existsSync(aggregate)) {
    console.error('expenses: data/expenses.json is missing — run npm run build:data first.');
    process.exit(1);
  }
  const sources = await collectJson(EXPENSES_DIR);
  delete sources['vault.json'];
  const bundle = { sources, aggregate: JSON.parse(await readFile(aggregate, 'utf8')) };
  await writeFile(vaultPath('expenses'),
    wrap(salt, wrapped, await encryptJson(key, bundle)));

  let count = 0;
  if (existsSync(EXPENSES_FILES)) {
    for (const name of await readdir(EXPENSES_FILES)) {
      if (name.endsWith('.enc')) continue;
      const raw = await readFile(path.join(EXPENSES_FILES, name));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, raw);
      // iv || ciphertext, so one fetch carries everything needed to open it.
      await writeFile(path.join(EXPENSES_FILES, `${name}.enc`),
        Buffer.concat([Buffer.from(iv), Buffer.from(ct)]));
      count++;
    }
  }
  console.log(`expenses: locked ${Object.keys(sources).length} json + ${count} attachments`);
}

async function unlockExpenses(kek, dek) {
  const vault = JSON.parse(await readFile(vaultPath('expenses'), 'utf8'));
  const key = contentKey(vault, kek, dek);
  const bundle = await decryptJson(key, vault);
  await writeJsonTree(EXPENSES_DIR, bundle.sources);
  await writeFile(path.join(EXPENSES_DIR, 'expenses.json'),
    JSON.stringify(bundle.aggregate, null, 2) + '\n');

  let count = 0;
  if (existsSync(EXPENSES_FILES)) {
    for (const name of await readdir(EXPENSES_FILES)) {
      if (!name.endsWith('.enc')) continue;
      const raw = await readFile(path.join(EXPENSES_FILES, name));
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12));
      await writeFile(path.join(EXPENSES_FILES, name.replace(/\.enc$/, '')),
        Buffer.from(plain));
      count++;
    }
  }
  console.log(`expenses: unlocked ${Object.keys(bundle.sources).length} json + ${count} attachments`);
}

/* Removes the plaintext an unlock left behind, so a working tree can be put
 * back to what git actually tracks. */
async function scrub() {
  for (const name of FORECAST_FILES) {
    await rm(path.join(FORECAST_DIR, `${name}.json`), { force: true });
  }
  const sources = await collectJson(EXPENSES_DIR);
  for (const rel of Object.keys(sources)) {
    if (rel === 'vault.json') continue;
    await rm(path.join(EXPENSES_DIR, rel), { force: true });
  }
  if (existsSync(EXPENSES_FILES)) {
    for (const name of await readdir(EXPENSES_FILES)) {
      if (!name.endsWith('.enc')) await rm(path.join(EXPENSES_FILES, name), { force: true });
    }
  }
  console.log('Plaintext removed; only the encrypted files remain.');
}

/* ---------------------------------------------------------------------- cli */

const cmd = process.argv[2];
const args = process.argv.slice(3);
const full = args.includes('--full');
const which = args.find((a) => !a.startsWith('--')) || 'all';
const wants = (app) => which === 'all' || which === app;

if (cmd === 'lock' || cmd === 'unlock') {
  const secret = secretFrom('FORECAST_PASSPHRASE', 'FORECAST_PIN');
  const salt = (await existingSalt()) || crypto.getRandomValues(new Uint8Array(16));
  const kek = await deriveKey(secret, salt);

  if (cmd === 'unlock') {
    // Fail loudly on a wrong secret rather than writing garbage.
    try {
      const dek = await existingDataKey(kek);
      if (wants('forecast') && hasVault('forecast')) await unlockForecast(kek, dek);
      if (wants('expenses') && hasVault('expenses')) await unlockExpenses(kek, dek);
    } catch (err) {
      failedToOpen(err);
    }
  } else {
    // Reuse the data key already in play so attachments encrypted under it
    // still open; only a repo with no v2 vault yet mints a new one.
    let dek;
    try {
      dek = await existingDataKey(kek);
    } catch (err) {
      failedToOpen(err);
    }
    if (!dek) dek = await newDataKey();
    const wrapped = await wrapKey(kek, dek);
    if (wants('forecast')) await lockForecast(dek, salt, wrapped);
    if (wants('expenses')) await lockExpenses(dek, salt, wrapped);
  }
} else if (cmd === 'scrub') {
  await scrub();
} else if (cmd === 'rekey') {
  const apps = ['forecast', 'expenses'].filter((a) => wants(a) && hasVault(a));
  if (!apps.length) {
    console.error('Nothing to rekey — no vault exists yet.');
    process.exit(1);
  }
  const oldSalt = await existingSalt();
  const oldKek = await deriveKey(secretFrom('FORECAST_PASSPHRASE', 'FORECAST_PIN'), oldSalt);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await deriveKey(secretFrom('FORECAST_NEW_PASSPHRASE', 'FORECAST_NEW_PIN'), salt);

  let dek;
  try {
    dek = await existingDataKey(oldKek);
  } catch (err) {
    failedToOpen(err);
  }

  if (full || !dek) {
    /* A real re-key: new data key, everything encrypted again. This is what
     * locks out anyone who already got hold of the old data key, and the only
     * path for a v1 vault, whose content hangs off the passphrase itself. */
    try {
      for (const app of apps) {
        if (app === 'forecast') await unlockForecast(oldKek, dek);
        else await unlockExpenses(oldKek, dek);
      }
    } catch (err) {
      failedToOpen(err);
    }
    const fresh = await newDataKey();
    const wrapped = await wrapKey(kek, fresh);
    for (const app of apps) {
      if (app === 'forecast') await lockForecast(fresh, salt, wrapped);
      else await lockExpenses(fresh, salt, wrapped);
    }
    console.log(`Re-keyed ${apps.join(' and ')} in full — new data key, everything re-encrypted.`);
  } else {
    // Just re-wrap: the content is untouched, so git stores no new blobs.
    const wrapped = await wrapKey(kek, dek);
    for (const app of apps) await rewrap(app, salt, wrapped);
    console.log(`Passphrase changed for ${apps.join(' and ')} — the data itself was not rewritten.`);
    console.log('Every device drops back to the lock screen. Use --full to also change the data key.');
  }
} else {
  console.error('Usage: vault.mjs <lock|unlock|scrub|rekey> [forecast|expenses|all] [--full]');
  process.exit(1);
}
