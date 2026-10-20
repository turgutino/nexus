const fs = require('fs');

/** Single-line text: drops every control character (including newlines and tabs). */
function stripText(s, max) {
  return String(s ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

/** Multi-line text: keeps \n and \t, normalizes \r\n, drops other control characters. */
function stripMultiline(s, max) {
  return String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

/**
 * Accepts only relative paths, #anchors, http(s), mailto and tel links.
 * Anything else (javascript:, data:, vbscript: ...) becomes ''.
 */
function safeLink(input, max = 500) {
  const raw = String(input ?? '')
    .replace(/[\u0000-\u001F\u007F\s]/g, (c) => (c === ' ' ? ' ' : ''))
    .trim()
    .slice(0, max);
  if (!raw) return '';
  if (raw.startsWith('//')) return '';
  if (raw.startsWith('/') || raw.startsWith('#') || raw.startsWith('?')) return raw;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  if (!m) return raw;
  const scheme = m[1].toLowerCase();
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel' ? raw : '';
}

/** Image/media URLs: site-relative uploads or http(s) only. */
function safeMediaUrl(input, max = 500) {
  const v = safeLink(input, max);
  if (!v) return '';
  if (/^(mailto|tel):/i.test(v) || v.startsWith('#') || v.startsWith('?')) return '';
  return v;
}

/** Embed URLs (maps): https only. */
function safeEmbedUrl(input, max = 800) {
  const raw = String(input ?? '').trim().slice(0, max);
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return '';
  }
}

const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

/** The stored extension is derived from the validated MIME type, never from the client file name. */
function extForMime(mime) {
  return MIME_TO_EXT[String(mime || '').toLowerCase()] || null;
}

/** Content sniffing so a spoofed Content-Type cannot smuggle another file type. */
function matchesMagic(mime, buf) {
  if (!buf || buf.length < 4) return false;
  const starts = (...bytes) => bytes.every((b, i) => buf[i] === b);
  switch (mime) {
    case 'image/jpeg':
      return starts(0xff, 0xd8, 0xff);
    case 'image/png':
      return starts(0x89, 0x50, 0x4e, 0x47);
    case 'image/gif':
      return starts(0x47, 0x49, 0x46, 0x38);
    case 'image/webp':
      return buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
    case 'application/pdf':
      return buf.toString('ascii', 0, 4) === '%PDF';
    case 'application/msword':
      return starts(0xd0, 0xcf, 0x11, 0xe0);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return starts(0x50, 0x4b, 0x03, 0x04);
    case 'image/svg+xml': {
      const head = buf.toString('utf8', 0, Math.min(buf.length, 1024)).trimStart().toLowerCase();
      return head.startsWith('<svg') || head.startsWith('<?xml');
    }
    default:
      return false;
  }
}

async function fileMatchesMime(filePath, mime) {
  let fh;
  try {
    fh = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return matchesMagic(mime, buf.subarray(0, bytesRead));
  } catch {
    return false;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

async function removeFileQuietly(filePath) {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch {
    /* ignore */
  }
}

/** Only known public pages are recorded in analytics; query strings and unknown paths are dropped. */
const TRACKABLE_PAGES = new Set([
  '/',
  '/index.html',
  '/about.html',
  '/services.html',
  '/service.html',
  '/projects.html',
  '/project.html',
  '/team.html',
  '/blog.html',
  '/post.html',
  '/contact.html',
  '/unsubscribe.html',
  '/confirm.html',
]);

function normalizeTrackPath(input) {
  let s = String(input || '/').replace(/\0/g, '').trim().slice(0, 512);
  const cut = s.search(/[?#]/);
  if (cut !== -1) s = s.slice(0, cut);
  if (!s.startsWith('/')) s = `/${s}`;
  return TRACKABLE_PAGES.has(s) ? s : null;
}

/** Referrer keeps origin + path only (no query/hash: they often carry tokens or personal data). */
function sanitizeReferrer(input) {
  const raw = String(input || '').trim().replace(/\0/g, '').slice(0, 1024);
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return `${u.origin}${u.pathname}`.slice(0, 512);
  } catch {
    return '';
  }
}

function parsePositiveInt(v) {
  return /^\d{1,9}$/.test(String(v ?? '')) && Number(v) > 0 ? Number(v) : null;
}

/** Accepts ISO-like date strings only; returns a normalized 'YYYY-MM-DD HH:MM:SS' or null. */
function parseTimestamp(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(s)) return undefined;
  let iso = s.includes('T') || s.includes(' ') ? s.replace(' ', 'T') : `${s}T00:00:00`;
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) iso += 'Z';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

const WEAK_SECRETS = new Set([
  'change-me-in-production',
  'dev-only-change-in-production',
  'changeme',
  'secret',
  'password',
]);

function isWeakSecret(v) {
  const s = String(v || '').trim();
  return s.length < 32 || WEAK_SECRETS.has(s.toLowerCase());
}

const WEAK_PASSWORDS = new Set(['admin123', 'admin', 'password', 'changeme', '12345678', 'password123']);

function passwordProblem(pw) {
  const s = String(pw ?? '');
  if (s.length < 12) return 'Password must be at least 12 characters.';
  if (s.length > 200) return 'Password is too long.';
  if (WEAK_PASSWORDS.has(s.toLowerCase())) return 'Password is too common.';
  if (/^(.)\1+$/.test(s)) return 'Password is too simple.';
  return null;
}

module.exports = {
  stripText,
  stripMultiline,
  safeLink,
  safeMediaUrl,
  safeEmbedUrl,
  extForMime,
  matchesMagic,
  fileMatchesMime,
  removeFileQuietly,
  normalizeTrackPath,
  sanitizeReferrer,
  parsePositiveInt,
  parseTimestamp,
  isWeakSecret,
  passwordProblem,
  WEAK_PASSWORDS,
};
