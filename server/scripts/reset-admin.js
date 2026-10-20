/**
 * Admin recovery tool.
 *   npm run admin:reset-password            # prompts for a new password
 *   ADMIN_NEW_PASSWORD=... npm run admin:reset-password   # non-interactive
 *   npm run admin:disable-2fa               # lost authenticator device
 * In Docker: docker compose exec app node server/scripts/reset-admin.js [--disable-2fa]
 */
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { query, q1, pool } = require('../db');
const { passwordProblem } = require('../lib/security');

function promptHidden(label) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const origWrite = rl._writeToOutput;
    rl._writeToOutput = function (s) {
      if (rl.line === '' || s.includes('\n') || s.includes(label)) origWrite.call(rl, s);
    };
    rl.question(label, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const disable2fa = process.argv.includes('--disable-2fa');
  const admin = await q1('SELECT id, username FROM admin_user WHERE id = 1');
  if (!admin) throw new Error('No admin account exists yet. Start the server once to create it.');

  if (disable2fa) {
    await query(`UPDATE admin_user SET totp_secret = '', totp_enabled = FALSE, totp_last_step = 0 WHERE id = 1`);
    console.log(`Two-factor authentication disabled for "${admin.username}".`);
    return;
  }

  const pw = process.env.ADMIN_NEW_PASSWORD || (await promptHidden('New admin password (12+ chars): '));
  const problem = passwordProblem(pw);
  if (problem) throw new Error(problem);
  await query('UPDATE admin_user SET password_hash = ?, session_epoch = session_epoch + 1 WHERE id = 1', [
    bcrypt.hashSync(pw, 12),
  ]);
  console.log(`Password updated for "${admin.username}". All existing admin sessions were signed out.`);
}

main()
  .catch((e) => {
    console.error(e.message || e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
