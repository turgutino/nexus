# Publishing the static site on GitHub Pages (free, no server, no card)

This publishes a **read-only copy** of the site: home, about, services, projects, team, blog, contact page and the language
switcher. Content is exported once from the running site into `static/site-data.json`; pages then read that file in the browser.

**What works:** all public pages, blog search and categories, 7 languages, SEO titles, mobile layout.
**What does not exist on the static site:** the admin panel, newsletter signup, analytics, file attachments on the contact form.
To change content you edit it in the admin panel of your local copy, export again and push (steps below).

The address will be `https://<github-username>.github.io/<repository-name>/` (e.g. `https://turgutino.github.io/Company-site/`).
Pages is free for **public** repositories.

> **Before the first publish:** the site currently shows the demo content that ships with the project
> (company "Nexus Studio", example team members, blog posts). Replace it with your real content in the admin panel first
> (see "Updating the content"), otherwise the demo text becomes public.

## One-time setup

1. **Contact form (optional but recommended).** The static site cannot store messages, so the form forwards them to a form service.
   Create a free form at [formspree.io](https://formspree.io) (it gives you an endpoint like `https://formspree.io/f/abcdwxyz`),
   then edit `static/config.json`:
   ```json
   {
     "siteUrl": "https://turgutino.github.io/Company-site",
     "contactEndpoint": "https://formspree.io/f/abcdwxyz",
     "contactExtraFields": {},
     "contactEmail": "you@example.com"
   }
   ```
   `contactEmail` is shown to visitors if the form fails or is not configured. Web3Forms and similar services work too:
   put their public access key into `contactExtraFields` (e.g. `{"access_key": "..."}`) and use their endpoint.
2. **Turn on Pages.** Repository → Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Push to `main`. The workflow *Deploy static site (GitHub Pages)* builds and publishes automatically; the Actions tab shows progress
   and the final URL.

## Updating the content

1. Start the site locally and edit content in the admin panel (`http://localhost:3000/admin/`):
   ```bash
   docker compose up -d
   ```
2. Export the content (site must be running):
   ```bash
   npm run export:data
   ```
   This rewrites `static/site-data.json` and `static/uploads/` (only public content and the images it uses).
3. Check it locally (optional): `npm run build:static` builds into `dist-static/`.
4. Commit and push `static/` — the workflow republishes the site within a minute or two.

## Custom domain (optional, later)

Put your domain on one line in `static/CNAME` (for example `www.mycompany.com`), point the domain's DNS at GitHub Pages
(see GitHub docs: "Managing a custom domain for your GitHub Pages site"), and push. The build then serves from the root path automatically.

## Alternative: Vercel

The same `dist-static` folder works on Vercel (free, gives `*.vercel.app`): import the repository, set **Build Command**
`node scripts/build-static.js --site-url https://YOUR-PROJECT.vercel.app` and **Output Directory** `dist-static`.
Vercel serves from the root, so no base path is needed.

## Good to know

- The build rewrites links so the site works under `/<repository-name>/`; `--base` controls this (`node scripts/build-static.js --base /Company-site`).
  On Windows Git Bash a leading `/` argument is rewritten by the shell; the script repairs that, or use PowerShell.
- The Docker/VPS deployment (`DEPLOY.md`) is unaffected and remains available if you later need the admin panel online.
