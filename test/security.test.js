const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../server/lib/security');

test('stripText removes newlines, stripMultiline keeps them', () => {
  assert.equal(s.stripText('a\nb\tc', 50), 'abc');
  assert.equal(s.stripMultiline('a\r\n\r\nb\u0000c', 50), 'a\n\nbc');
  assert.equal(s.stripMultiline('x'.repeat(100), 10).length, 10);
});

test('safeLink blocks dangerous schemes', () => {
  assert.equal(s.safeLink('javascript:alert(1)'), '');
  assert.equal(s.safeLink('JaVaScRiPt:alert(1)'), '');
  assert.equal(s.safeLink('java\nscript:alert(1)'), '');
  assert.equal(s.safeLink('data:text/html,<script>'), '');
  assert.equal(s.safeLink('//evil.example'), '');
  assert.equal(s.safeLink('/services.html'), '/services.html');
  assert.equal(s.safeLink('https://example.com/a'), 'https://example.com/a');
  assert.equal(s.safeLink('mailto:a@b.co'), 'mailto:a@b.co');
  assert.equal(s.safeLink('#top'), '#top');
});

test('safeMediaUrl and safeEmbedUrl', () => {
  assert.equal(s.safeMediaUrl('/uploads/a.png'), '/uploads/a.png');
  assert.equal(s.safeMediaUrl('javascript:x'), '');
  assert.equal(s.safeMediaUrl('mailto:a@b.co'), '');
  assert.equal(s.safeEmbedUrl('https://www.google.com/maps/embed?pb=1'), 'https://www.google.com/maps/embed?pb=1');
  assert.equal(s.safeEmbedUrl('http://example.com'), '');
  assert.equal(s.safeEmbedUrl('javascript:x'), '');
});

test('extension comes from MIME type only', () => {
  assert.equal(s.extForMime('image/png'), '.png');
  assert.equal(s.extForMime('application/pdf'), '.pdf');
  assert.equal(s.extForMime('text/html'), null);
});

test('magic bytes must match declared MIME', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const html = Buffer.from('<html><script>alert(1)</script></html>');
  assert.equal(s.matchesMagic('image/png', png), true);
  assert.equal(s.matchesMagic('image/png', html), false);
  assert.equal(s.matchesMagic('application/pdf', Buffer.from('%PDF-1.7')), true);
  assert.equal(s.matchesMagic('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(s.matchesMagic('image/svg+xml', Buffer.from('<svg xmlns="x"></svg>')), true);
  assert.equal(s.matchesMagic('image/svg+xml', html), false);
});

test('analytics path allow-list drops queries and unknown paths', () => {
  assert.equal(s.normalizeTrackPath('/blog.html?q=secret'), '/blog.html');
  assert.equal(s.normalizeTrackPath('/'), '/');
  assert.equal(s.normalizeTrackPath('/admin/'), null);
  assert.equal(s.normalizeTrackPath('/<script>'), null);
});

test('referrer keeps origin and path only', () => {
  assert.equal(s.sanitizeReferrer('https://a.example/x?token=1#h'), 'https://a.example/x');
  assert.equal(s.sanitizeReferrer('javascript:alert(1)'), '');
});

test('id and timestamp parsing', () => {
  assert.equal(s.parsePositiveInt('12'), 12);
  assert.equal(s.parsePositiveInt('NaN'), null);
  assert.equal(s.parsePositiveInt('0'), null);
  assert.equal(s.parsePositiveInt('1;DROP'), null);
  assert.equal(s.parseTimestamp(''), null);
  assert.equal(s.parseTimestamp('garbage'), undefined);
  assert.equal(s.parseTimestamp('2026-05-01'), '2026-05-01 00:00:00');
  assert.equal(s.parseTimestamp('2026-13-45'), undefined);
});

test('secret and password strength rules', () => {
  assert.equal(s.isWeakSecret('change-me-in-production'), true);
  assert.equal(s.isWeakSecret('short'), true);
  assert.equal(s.isWeakSecret('a'.repeat(48)), false);
  assert.ok(s.passwordProblem('admin123'));
  assert.ok(s.passwordProblem('aaaaaaaaaaaaaaaa'));
  assert.equal(s.passwordProblem('correct-horse-battery-staple'), null);
});
