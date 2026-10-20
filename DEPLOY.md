# Deploying to a free server (Oracle Cloud Always Free + DuckDNS)

Everything here is free: the VPS (Oracle "Always Free"), the domain (a free `*.duckdns.org` sub-domain) and the HTTPS
certificate (Let's Encrypt, handled by Caddy). Free-tier terms change, so skim Oracle's current "Always Free" page before you sign up.

Result: `https://YOURNAME.duckdns.org` serving the site, admin panel at `/admin/`.

```
Internet ─▶ Caddy (80/443, HTTPS) ─▶ app (Node) ─▶ Postgres + Redis     (all in Docker on one VPS)
```

## 1. Oracle Cloud account (once)

1. Sign up at oracle.com/cloud/free. A card is requested only to verify identity; stay on the **Free** account and do not click "Upgrade".
2. Pick a **home region** carefully — it cannot be changed. If one region has no free capacity later, you cannot move.
3. Create an instance (Compute → Instances → Create):
   - Image: **Ubuntu 22.04 or 24.04**.
   - Shape: **VM.Standard.A1.Flex** (ARM, e.g. 2 OCPU / 12 GB) if available, otherwise **VM.Standard.E2.1.Micro** (1 GB; the setup script adds swap).
     Only pick shapes marked **Always Free-eligible**.
   - Networking: assign a **public IPv4 address**.
   - SSH keys: *Generate a key pair* and **download the private key**. Keep it safe; you cannot download it again.
4. Open the web ports: Networking → Virtual Cloud Networks → your VCN → Subnet → **Security List** → *Add Ingress Rules*:
   - Source CIDR `0.0.0.0/0`, TCP, destination port **80**
   - Source CIDR `0.0.0.0/0`, TCP, destination port **443**
5. (Recommended) Make the public IP permanent: instance → Attached VNICs → IPv4 → *Reserved public IP*. A reserved IP that is attached to an instance is free.

Note the instance's **public IP**.

## 2. Free domain name (DuckDNS)

1. Go to duckdns.org and sign in (GitHub/Google).
2. Create a sub-domain, e.g. `myteam` → `myteam.duckdns.org`.
3. Set its **current ip** to your server's public IP and click *update ip*.

## 3. Push the code to GitHub

On your PC, in the project folder, push the latest commits to `origin main` (the server pulls from GitHub).
If the repository is **private**, create a read-only *deploy key* (GitHub → repo → Settings → Deploy keys) with the key generated on the server in step 5.

## 4. Log in to the server

```bash
ssh -i path/to/oracle-private.key ubuntu@SERVER_IP
```
(On Windows use PowerShell or Git Bash. If SSH complains about key permissions, restrict the key file to your user.)

## 5. Prepare the server (once)

```bash
git clone https://github.com/turgutino/nexus.git ~/company-site
cd ~/company-site
bash deploy/server-setup.sh
```
The script installs Docker, enables a firewall (SSH/80/443 only) and adds swap on small machines.
**Log out and back in** afterwards so the `docker` group takes effect.

Private repository? Run `ssh-keygen -t ed25519 -C deploy` on the server, add `~/.ssh/id_ed25519.pub` as a deploy key on GitHub and clone with the SSH URL instead.

## 6. Configure `.env` on the server

```bash
cd ~/company-site
cp .env.example .env
nano .env
```

Set at least:

| Variable | Value |
|---|---|
| `SESSION_SECRET` | output of `openssl rand -hex 48` |
| `DB_PASSWORD` | a long random password (Postgres is created with it on first start) |
| `ADMIN_USERNAME` | e.g. `admin` |
| `ADMIN_PASSWORD` | a strong password, 12+ characters (used once, to create the admin) |
| `SITE_DOMAIN` | `myteam.duckdns.org` (no `https://`) |

`TRUST_PROXY` and `SITE_URL` are set automatically by `docker-compose.prod.yml`. Newsletter keys (`RESEND_*`) are optional — see "Newsletter" below.

## 7. Start it

```bash
cd ~/company-site
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

The first build takes a few minutes. Caddy requests the HTTPS certificate automatically as soon as the domain points at the server and ports 80/443 are reachable.

Check:

```bash
curl -I https://myteam.duckdns.org/healthz
```
Then open `https://myteam.duckdns.org` and `https://myteam.duckdns.org/admin/`.

Afterwards remove the plain-text bootstrap password from `.env` (comment out `ADMIN_PASSWORD`) — the admin already exists in the database. Change the password any time in **Admin → Security**.

## 8. Backups (important)

Test it once:

```bash
bash deploy/backup.sh
ls ~/backups
```

Then schedule it daily at 03:00 (`crontab -e`):

```
0 3 * * * cd /home/ubuntu/company-site && bash deploy/backup.sh >> /home/ubuntu/backup.log 2>&1
```

Copy `~/backups` off the server now and then (e.g. `scp` to your PC) — a backup that lives only on the same machine does not survive losing the machine.

Restore a database dump:

```bash
gunzip -c ~/backups/db-YYYY-MM-DD-HHMM.sql.gz | docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
```

## 9. Updating the site later

```bash
cd ~/company-site && git pull --ff-only
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Automatic deploys: add repository secrets `SSH_HOST`, `SSH_USER` (`ubuntu`) and `SSH_PRIVATE_KEY` (a *separate* key whose public half is in the server's `~/.ssh/authorized_keys`).
After that every push to `main` that passes CI redeploys. Without these secrets the deploy job is skipped.

## Newsletter (optional)

Resend can only send from a domain you control and can verify with DNS records. A `*.duckdns.org` sub-domain generally does not allow that, so for newsletter e-mail you will eventually need your own domain (about 10 USD/year). Until then newsletter signup stays disabled in production and everything else works.

## Troubleshooting

| Symptom | Check |
|---|---|
| Site not reachable at all | Oracle Security List has ingress for 80 and 443; `sudo ufw status`; DuckDNS IP is correct (`nslookup myteam.duckdns.org`). |
| Browser certificate error right after start | Wait a minute and check `docker compose ... logs caddy`. It needs DNS to be correct and ports 80/443 open. |
| App container keeps restarting | `docker compose ... logs app` — usually a weak/missing `SESSION_SECRET` or a weak admin password (the app refuses to start on purpose). |
| Admin login does nothing | You are on plain `http://`. Use the `https://` address. |
| Forgot admin password | `docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm --no-deps app node server/scripts/reset-admin.js` |
| Lost 2FA device | same command with `--disable-2fa` |
| Still unreachable although the Oracle rules are right | Ubuntu images from Oracle ship with restrictive iptables rules. Check `sudo iptables -L INPUT -n --line-numbers` and insert ACCEPT rules for 80 and 443 above any REJECT rule, then `sudo netfilter-persistent save`. |

## Keeping the free server alive

Oracle may reclaim Always Free instances that sit idle for a long period. Visit the site occasionally, keep the daily backups running and keep an off-server copy of the backups.
