#!/usr/bin/env node
// Aggregates the Expenses app's per-expense source files into the single
// data/expenses.json the frontend consumes.
//
// Source of truth (committed):
//   apps/expenses/data/meta.json                       project + currency rates
//   apps/expenses/data/categories.json                 category registry
//   apps/expenses/data/expenses/<yyyy>/<mm>/<id>.json  one expense per file
//
// Output (generated, gitignored — exists only in deploy output):
//   apps/expenses/data/expenses.json
//
// Usage:
//   node scripts/build-expenses-data.mjs           build (validates first)
//   node scripts/build-expenses-data.mjs --check   validate only (CI)

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'expenses');
const DATA_DIR = join(APP_DIR, 'data');
const EXPENSES_DIR = join(DATA_DIR, 'expenses');
const OUT_FILE = join(DATA_DIR, 'expenses.json');
const CHECK_ONLY = process.argv.includes('--check');

const errors = [];
const fail = (file, msg) => errors.push(`${file}: ${msg}`);

function readJSON(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    fail(label, `unreadable or invalid JSON (${e.message})`);
    return null;
  }
}

const meta = readJSON(join(DATA_DIR, 'meta.json'), 'data/meta.json');
const categories = readJSON(join(DATA_DIR, 'categories.json'), 'data/categories.json');

const categoryIds = new Set(Array.isArray(categories) ? categories.map((c) => c.id) : []);
if (Array.isArray(categories)) {
  for (const c of categories) {
    if (!c.id || !c.name) fail('data/categories.json', `category missing id or name: ${JSON.stringify(c)}`);
  }
}

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function validCurrency(cur) {
  return cur === 'EUR' || (meta && meta.fixedRates && typeof meta.fixedRates[cur] === 'number');
}

const expenses = [];
const seenIds = new Map(); // id -> file that declared it

function checkExpense(exp, rel, year, month) {
  for (const key of ['id', 'date', 'amount', 'currency', 'vendor', 'category']) {
    if (exp[key] === undefined || exp[key] === '') fail(rel, `missing required field "${key}"`);
  }
  if (exp.id && rel.split('/').pop() !== `${exp.id}.json`) {
    fail(rel, `filename does not match id "${exp.id}"`);
  }
  if (exp.id) {
    if (seenIds.has(exp.id)) fail(rel, `duplicate id also declared in ${seenIds.get(exp.id)}`);
    else seenIds.set(exp.id, rel);
  }
  if (exp.date !== undefined) {
    if (typeof exp.date !== 'string' || !ISO_DATE.test(exp.date)) {
      fail(rel, `date "${exp.date}" is not an ISO YYYY-MM-DD date`);
    } else if (!exp.date.startsWith(`${year}-${month}-`)) {
      fail(rel, `date "${exp.date}" does not belong in folder ${year}/${month}/`);
    }
  }
  if (exp.amount !== undefined && (typeof exp.amount !== 'number' || !Number.isFinite(exp.amount) || exp.amount <= 0)) {
    fail(rel, `amount must be a positive number, got ${JSON.stringify(exp.amount)}`);
  }
  if (exp.currency !== undefined && !validCurrency(exp.currency)) {
    fail(rel, `currency "${exp.currency}" is not EUR and has no rate in meta.fixedRates`);
  }
  if (exp.category !== undefined && !categoryIds.has(exp.category)) {
    fail(rel, `unknown category "${exp.category}"`);
  }
  if (exp.attachments !== undefined) {
    if (!Array.isArray(exp.attachments)) {
      fail(rel, 'attachments must be an array');
      return;
    }
    for (const a of exp.attachments) {
      if (!a.file || !a.originalName) {
        fail(rel, `attachment missing file or originalName: ${JSON.stringify(a)}`);
        continue;
      }
      const abs = join(APP_DIR, a.file);
      if (!existsSync(abs)) {
        fail(rel, `attachment file not found on disk: ${a.file}`);
      } else if (typeof a.size === 'number' && statSync(abs).size !== a.size) {
        fail(rel, `attachment ${a.file} size ${statSync(abs).size} does not match declared ${a.size}`);
      }
      if (a.extractedText !== undefined && typeof a.extractedText !== 'string') {
        fail(rel, `attachment ${a.file} extractedText must be a string`);
      }
    }
  }
}

if (existsSync(EXPENSES_DIR)) {
  for (const year of readdirSync(EXPENSES_DIR).sort()) {
    if (!/^\d{4}$/.test(year)) {
      fail(`data/expenses/${year}`, 'not a 4-digit year directory');
      continue;
    }
    for (const month of readdirSync(join(EXPENSES_DIR, year)).sort()) {
      if (!/^(0[1-9]|1[0-2])$/.test(month)) {
        fail(`data/expenses/${year}/${month}`, 'not a 2-digit month directory (01-12)');
        continue;
      }
      for (const name of readdirSync(join(EXPENSES_DIR, year, month)).sort()) {
        const rel = `data/expenses/${year}/${month}/${name}`;
        if (!name.endsWith('.json')) {
          fail(rel, 'unexpected non-JSON file in expenses tree');
          continue;
        }
        const exp = readJSON(join(EXPENSES_DIR, year, month, name), rel);
        if (!exp) continue;
        checkExpense(exp, rel, year, month);
        expenses.push(exp);
      }
    }
  }
} else {
  fail('data/expenses', 'directory does not exist');
}

if (errors.length) {
  console.error(`Expenses data validation FAILED (${errors.length} problem${errors.length === 1 ? '' : 's'}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`Validated ${expenses.length} expenses, ${categoryIds.size} categories.`);
if (CHECK_ONLY) process.exit(0);

expenses.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id)));
const out = {
  meta: { ...meta, updated: new Date().toISOString() },
  categories,
  expenses,
};
writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${OUT_FILE}`);
