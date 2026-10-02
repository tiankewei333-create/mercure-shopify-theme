#!/usr/bin/env node
/**
 * Builds a Shopify URL-redirect import file from a WooCommerce site's old URLs.
 *
 * Input: one or more files with the old URLs, either plain text (one URL or path per line) or
 * sitemap XML (e.g. wp-sitemap-posts-product-1.xml, product-sitemap.xml). Optionally the Shopify
 * products export CSV, so product redirects are only written for handles that really exist.
 *
 * Output: redirects.csv ("Redirect from,Redirect to"), ready for Online Store > Navigation >
 * URL redirects > Import, plus redirects-unmatched.csv listing every URL that needs a human decision.
 *
 * Usage:
 *   npm run redirects:woo -- --urls old-urls.txt --urls product-sitemap.xml \
 *     [--products products_export.csv] [--blog news] [--out redirects.csv]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const args = parseArgs(process.argv.slice(2));
if (!args.urls.length) {
  console.error('Pass at least one --urls file (plain list or sitemap XML).');
  process.exit(1);
}

const blogHandle = args.blog || 'news';
const outFile = args.out || 'redirects.csv';
const unmatchedFile = join(dirname(outFile), 'redirects-unmatched.csv');

// Shopify serves these itself; a redirect from them would be ignored or break checkout.
const SKIP = new Set(['/checkout', '/wp-admin', '/wp-login.php', '/feed', '/wp-json']);

const knownHandles = args.products ? productHandles(args.products) : null;
const oldPaths = [...new Set(args.urls.flatMap(readUrls).map(toPath).filter(Boolean))];

const redirects = new Map();
const unmatched = [];

for (const from of oldPaths) {
  const result = mapPath(from);
  if (!result) continue;
  if (result.reason) {
    unmatched.push([from, result.reason]);
    continue;
  }
  if (result.to === from) continue;
  redirects.set(from, result.to);
}

writeFileSync(outFile, toCsv([['Redirect from', 'Redirect to'], ...redirects]));
writeFileSync(unmatchedFile, toCsv([['Old URL', 'Why it needs review'], ...unmatched]));

console.log(`${oldPaths.length} old URLs read`);
console.log(`${redirects.size} redirects written to ${outFile}`);
console.log(`${unmatched.length} need review, listed in ${unmatchedFile}`);

function mapPath(path) {
  if ([...SKIP].some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return null;

  const segments = path.split('/').filter(Boolean);
  const [first, ...rest] = segments;
  const last = segments.at(-1);

  if (!first) return null;
  if (first === 'shop') return { to: '/collections/all' };
  if (first === 'cart') return { to: '/cart' };
  if (first === 'my-account') return { to: '/account' };

  if (first === 'product' && rest.length) {
    const handle = handleize(last);
    if (knownHandles && !knownHandles.has(handle)) {
      return { reason: `no Shopify product with handle "${handle}"` };
    }
    return { to: `/products/${handle}` };
  }

  // Nested categories (/product-category/brewers/kettles/) map to the deepest one.
  if (first === 'product-category' && rest.length) return { to: `/collections/${handleize(last)}` };
  if (first === 'product-tag' && rest.length) return { to: `/collections/all/${handleize(last)}` };

  if (first === 'blog' && rest.length) return { to: `/blogs/${blogHandle}/${handleize(last)}` };
  if (/^\d{4}$/.test(first) && segments.length >= 3) return { to: `/blogs/${blogHandle}/${handleize(last)}` };

  if (first === 'category' || first === 'tag' || first === 'author' || first === 'page') {
    return { reason: 'blog archive page, pick a target by hand' };
  }

  if (segments.length === 1) return { to: `/pages/${handleize(first)}` };

  return { reason: 'unknown URL pattern' };
}

/** Shopify-style handle: lowercase ASCII words joined by hyphens. */
function handleize(value) {
  return safeDecode(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toPath(raw) {
  const value = raw.trim();
  if (!value || value.startsWith('#')) return null;
  let path;
  try {
    path = new URL(value, 'https://old-site.invalid').pathname;
  } catch {
    return null;
  }
  path = path.replace(/\/+$/, '') || '/';
  if (path === '/') return null;
  return path.toLowerCase().replace(/%[0-9a-f]{2}/g, (escape) => escape.toUpperCase());
}

/** Excel and PowerShell often save UTF-8 with a BOM, which would glue onto the first header. */
function readText(file) {
  return readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
}

function readUrls(file) {
  const text = readText(file);
  if (text.includes('<loc>')) {
    return [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => decodeXml(match[1]));
  }
  return text.split(/\r?\n/);
}

function productHandles(file) {
  const rows = parseCsv(readText(file));
  const column = rows[0]?.indexOf('Handle') ?? -1;
  if (column === -1) {
    console.error(`${file} has no "Handle" column. Use the CSV from Products > Export.`);
    process.exit(1);
  }
  return new Set(rows.slice(1).map((row) => row[column]?.trim()).filter(Boolean));
}

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, commas and newlines inside quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toCsv(rows) {
  const cell = (value) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return `${rows.map((row) => row.map((value) => cell(String(value))).join(',')).join('\n')}\n`;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeXml(value) {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function parseArgs(argv) {
  const parsed = { urls: [] };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      console.error(`Missing value for --${key}`);
      process.exit(1);
    }
    if (key === 'urls') parsed.urls.push(value);
    else parsed[key] = value;
    i++;
  }
  return parsed;
}
