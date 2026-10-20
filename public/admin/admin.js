/* global fetch, FormData, document, window */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  let activityLogPage = 1;
  let activityLogTimer = null;
  let pending2faSecret = "";
  let analyticsCharts = [];
  let newsletterPage = 1;
  const newsletterLimit = 50;

  let state = {
    kv: {},
    services: [],
    team: [],
    messages: [],
    banners: [],
    projects: [],
    blogCategories: [],
    blogPosts: [],
    seoPages: [],
    translations: [],
    mediaFiles: [],
  };

  function setStatus(msg, type) {
    const el = $("#global-status");
    el.textContent = msg || "";
    el.className = "status " + (type || "");
  }

  async function apiJson(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (!(options.body instanceof FormData) && options.body != null && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const r = await fetch(path, {
      credentials: "include",
      ...options,
      headers,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText || "Request failed");
    return j;
  }

  async function uploadImage(file) {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/admin/upload", { method: "POST", credentials: "include", body: fd });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || "Upload failed");
    return j.url;
  }

  function switchTab(name) {
    $$(".tab").forEach((b) => b.classList.toggle("active", b.getAttribute("data-tab") === name));
    $$(".tab-panel").forEach((p) => p.classList.add("hidden"));
    const panel = $("#tab-" + name);
    if (panel) panel.classList.remove("hidden");
    if (name === "analytics") renderAnalytics();
    if (name === "translations") renderTranslationsAdmin();
    if (name === "media") renderMediaLibrary();
    if (name === "newsletter") renderNewsletterSubscribers();
    if (name === "security") loadSecurityPanel();
    if (name === "activity") {
      renderActivityLog();
      if (activityLogTimer) clearInterval(activityLogTimer);
      activityLogTimer = setInterval(renderActivityLog, 30000);
    } else if (activityLogTimer) {
      clearInterval(activityLogTimer);
      activityLogTimer = null;
    }
  }

  function showLoginCredentialStep() {
    const cred = $("#login-step-credentials");
    const totp = $("#login-step-totp");
    if (cred) cred.classList.remove("hidden");
    if (totp) totp.classList.add("hidden");
  }

  function showLoginTotpStep() {
    const cred = $("#login-step-credentials");
    const totp = $("#login-step-totp");
    if (cred) cred.classList.add("hidden");
    if (totp) totp.classList.remove("hidden");
    const te = $("#login-totp-err");
    if (te) te.textContent = "";
    const form = $("#login-totp-form");
    const inp = form && form.elements.namedItem("token");
    if (inp) {
      inp.value = "";
      inp.focus();
    }
  }

  async function loadSecurityPanel() {
    const switchEl = $("#twofa-switch-visual");
    const line = $("#twofa-status-line");
    const wrapOff = $("#twofa-off-wrap");
    const wrapOn = $("#twofa-on-wrap");
    if (!switchEl) return;
    try {
      const st = await apiJson("/api/admin/2fa/status");
      const on = st.totpEnabled;
      switchEl.classList.toggle("on", on);
      if (line) {
        line.textContent = on
          ? "Status: on — signing in requires an authenticator code."
          : "Status: off — password only.";
      }
      if (wrapOff) wrapOff.classList.toggle("hidden", on);
      if (wrapOn) wrapOn.classList.toggle("hidden", !on);
      if (on) {
        pending2faSecret = "";
        const qr = $("#twofa-qr");
        const hint = $("#twofa-setup-hint");
        const code = $("#twofa-enable-code");
        const sErr = $("#twofa-setup-err");
        if (qr) {
          qr.removeAttribute("src");
          qr.classList.add("hidden");
        }
        if (hint) hint.classList.add("hidden");
        if (code) code.value = "";
        if (sErr) sErr.textContent = "";
      }
    } catch (e) {
      setStatus(e.message, "err");
    }
  }

  function parseBannersJson(raw) {
    try {
      const v = JSON.parse(raw || "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  async function refreshBootstrap() {
    const j = await apiJson("/api/admin/bootstrap");
    state.kv = j.kv || {};
    state.services = j.services || [];
    state.team = j.team || [];
    state.messages = j.messages || [];
    state.banners = parseBannersJson(state.kv.banners_json);
    state.projects = j.projects || [];
    state.blogCategories = j.blogCategories || [];
    state.blogPosts = j.blogPosts || [];
    state.seoPages = j.seoPages || [];
    state.translations = j.translations || [];
    fillSiteForm();
    renderBanners();
    renderServices();
    renderTeam();
    renderMessages();
    renderProjectsAdmin();
    renderBlogCategoriesAdmin();
    renderBlogPostsAdmin();
    renderSeoAdmin();
    renderAnalytics();
  }

  function fillSiteForm() {
    const f = $("#form-site");
    if (!f) return;
    const keys = [
      "company_name",
      "footer_tagline",
      "hero_title",
      "hero_subtitle",
      "hero_image",
      "hero_cta_primary_text",
      "hero_cta_primary_link",
      "hero_cta_secondary_text",
      "hero_cta_secondary_link",
      "home_about_title",
      "home_about_text",
      "home_about_image",
      "about_page_title",
      "about_page_lead",
      "about_page_body",
      "about_mission",
      "about_values",
      "contact_map_embed_url",
      "default_locale",
      "home_projects_title",
      "home_projects_intro",
      "feature_flags_json",
      "analytics_mock_json",
    ];
    keys.forEach((k) => {
      const inp = f.elements.namedItem(k);
      if (inp) inp.value = state.kv[k] || "";
    });
  }

  function renderBanners() {
    const root = $("#banners-list");
    if (!root) return;
    root.innerHTML = "";
    state.banners.forEach((b, i) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <h3>Banner ${i + 1}</h3>
        <div class="mini-form">
          <label>Title <input type="text" data-b-i="${i}" data-b-f="title" value="${escAttr(b.title)}" /></label>
          <label>Subtitle <input type="text" data-b-i="${i}" data-b-f="subtitle" value="${escAttr(b.subtitle)}" /></label>
          <label>Image URL <input type="text" data-b-i="${i}" data-b-f="image" value="${escAttr(b.image)}" /></label>
          <label>Link <input type="text" data-b-i="${i}" data-b-f="link" value="${escAttr(b.link)}" /></label>
          <label>Link label <input type="text" data-b-i="${i}" data-b-f="linkText" value="${escAttr(b.linkText)}" /></label>
          <div class="upload-row">
            <input type="file" accept="image/*" data-banner-upload="${i}" />
            <button type="button" class="btn ghost sm" data-banner-remove="${i}">Remove</button>
          </div>
        </div>`;
      root.appendChild(card);
    });

    root.querySelectorAll("[data-b-f]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const i = Number(inp.getAttribute("data-b-i"));
        const f = inp.getAttribute("data-b-f");
        if (!state.banners[i]) return;
        state.banners[i][f] = inp.value;
      });
    });
    root.querySelectorAll("[data-banner-upload]").forEach((inp) => {
      inp.addEventListener("change", async () => {
        const i = Number(inp.getAttribute("data-banner-upload"));
        const file = inp.files && inp.files[0];
        inp.value = "";
        if (!file) return;
        try {
          const url = await uploadImage(file);
          state.banners[i].image = url;
          renderBanners();
          setStatus("Image uploaded.", "ok");
        } catch (e) {
          setStatus(e.message, "err");
        }
      });
    });
    root.querySelectorAll("[data-banner-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.getAttribute("data-banner-remove"));
        state.banners.splice(i, 1);
        renderBanners();
      });
    });
  }

  function escAttr(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function renderServices() {
    const root = $("#services-list-admin");
    if (!root) return;
    root.innerHTML = "";
    state.services.forEach((s) => root.appendChild(serviceCard(s)));
  }

  function serviceCard(s) {
    const isNew = !s.id;
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${isNew ? "New service" : escText(s.title)}</h3>
      <div class="mini-form" data-service-form="${s.id || "new"}">
        <label>Title <input name="title" value="${escAttr(s.title)}" /></label>
        <label>Slug <input name="slug" placeholder="auto from title" value="${escAttr(s.slug)}" /></label>
        <label>Icon key <input name="icon" placeholder="compass, pen, code…" value="${escAttr(s.icon)}" /></label>
        <label>Short description <textarea name="short_desc" rows="2">${escText(s.short_desc)}</textarea></label>
        <label>Long description <textarea name="long_desc" rows="5">${escText(s.long_desc)}</textarea></label>
        <label>Image URL <input name="image" value="${escAttr(s.image)}" /></label>
        <div class="row-2">
          <label>Sort order <input name="sort_order" type="number" value="${escAttr(s.sort_order)}" /></label>
          <label style="flex-direction:row;align-items:center;gap:0.5rem;margin-top:1.25rem">
            <input name="featured" type="checkbox" ${Number(s.featured) ? "checked" : ""} /> Featured on home
          </label>
        </div>
        <div class="upload-row">
          <input type="file" accept="image/*" data-svc-upload="${s.id || "new"}" />
        </div>
        <div class="row-actions">
          <button type="button" class="btn primary" data-save-service="${s.id || "new"}">Save</button>
          ${
            !isNew
              ? `<button type="button" class="btn danger" data-del-service="${s.id}">Delete</button>
                 <a class="btn ghost sm" href="/service.html?slug=${encodeURIComponent(s.slug)}" target="_blank" rel="noopener">Preview</a>`
              : ""
          }
        </div>
      </div>`;
    const upload = card.querySelector(`[data-svc-upload="${s.id || "new"}"]`);
    if (upload) {
      upload.addEventListener("change", async () => {
        const file = upload.files && upload.files[0];
        upload.value = "";
        if (!file) return;
        try {
          const url = await uploadImage(file);
          const form = card.querySelector("[data-service-form]");
          form.querySelector('input[name="image"]').value = url;
          setStatus("Image uploaded.", "ok");
        } catch (e) {
          setStatus(e.message, "err");
        }
      });
    }
    const saveBtn = card.querySelector("[data-save-service]");
    saveBtn.addEventListener("click", () => saveService(card, s.id));
    const delBtn = card.querySelector("[data-del-service]");
    if (delBtn) {
      delBtn.addEventListener("click", async () => {
        if (!confirm("Delete this service?")) return;
        try {
          await apiJson("/api/admin/services/" + s.id, { method: "DELETE" });
          await refreshBootstrap();
          setStatus("Service deleted.", "ok");
        } catch (e) {
          setStatus(e.message, "err");
        }
      });
    }
    return card;
  }

  function readServiceForm(card) {
    const form = card.querySelector("[data-service-form]");
    return {
      title: form.querySelector('[name="title"]').value,
      slug: form.querySelector('[name="slug"]').value,
      short_desc: form.querySelector('[name="short_desc"]').value,
      long_desc: form.querySelector('[name="long_desc"]').value,
      icon: form.querySelector('[name="icon"]').value,
      image: form.querySelector('[name="image"]').value,
      sort_order: form.querySelector('[name="sort_order"]').value,
      featured: form.querySelector('[name="featured"]').checked,
    };
  }

  async function saveService(card, id) {
    const body = readServiceForm(card);
    try {
      if (id === "new" || id === undefined) {
        await apiJson("/api/admin/services", { method: "POST", body: JSON.stringify(body) });
      } else {
        await apiJson("/api/admin/services/" + id, { method: "PUT", body: JSON.stringify(body) });
      }
      await refreshBootstrap();
      setStatus("Service saved.", "ok");
    } catch (e) {
      setStatus(e.message, "err");
    }
  }

  function renderTeam() {
    const root = $("#team-list-admin");
    if (!root) return;
    root.innerHTML = "";
    state.team.forEach((m) => root.appendChild(teamCard(m)));
  }

  function teamCard(m) {
    const isNew = !m.id;
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${isNew ? "New team member" : escText(m.name)}</h3>
      <div class="mini-form" data-team-form="${m.id || "new"}">
        <label>Name <input name="name" value="${escAttr(m.name)}" /></label>
        <label>Role <input name="role" value="${escAttr(m.role)}" /></label>
        <label>Bio <textarea name="bio" rows="3">${escText(m.bio)}</textarea></label>
        <label>Image URL <input name="image" value="${escAttr(m.image)}" /></label>
        <label>Sort order <input name="sort_order" type="number" value="${escAttr(m.sort_order)}" /></label>
        <div class="upload-row">
          <input type="file" accept="image/*" data-team-upload="${m.id || "new"}" />
        </div>
        <div class="row-actions">
          <button type="button" class="btn primary" data-save-team="${m.id || "new"}">Save</button>
          ${!isNew ? `<button type="button" class="btn danger" data-del-team="${m.id}">Delete</button>` : ""}
        </div>
      </div>`;
    const upload = card.querySelector(`[data-team-upload="${m.id || "new"}"]`);
    if (upload) {
      upload.addEventListener("change", async () => {
        const file = upload.files && upload.files[0];
        upload.value = "";
        if (!file) return;
        try {
          const url = await uploadImage(file);
          const form = card.querySelector("[data-team-form]");
          form.querySelector('input[name="image"]').value = url;
          setStatus("Image uploaded.", "ok");
        } catch (e) {
          setStatus(e.message, "err");
        }
      });
    }
    card.querySelector("[data-save-team]").addEventListener("click", () => saveTeam(card, m.id));
    const del = card.querySelector("[data-del-team]");
    if (del) {
      del.addEventListener("click", async () => {
        if (!confirm("Remove team member?")) return;
        try {
          await apiJson("/api/admin/team/" + m.id, { method: "DELETE" });
          await refreshBootstrap();
          setStatus("Removed.", "ok");
        } catch (e) {
          setStatus(e.message, "err");
        }
      });
    }
    return card;
  }

  function readTeamForm(card) {
    const form = card.querySelector("[data-team-form]");
    return {
      name: form.querySelector('[name="name"]').value,
      role: form.querySelector('[name="role"]').value,
      bio: form.querySelector('[name="bio"]').value,
      image: form.querySelector('[name="image"]').value,
      sort_order: form.querySelector('[name="sort_order"]').value,
    };
  }

  async function saveTeam(card, id) {
    const body = readTeamForm(card);
    try {
      if (id === "new" || id === undefined) {
        await apiJson("/api/admin/team", { method: "POST", body: JSON.stringify(body) });
      } else {
        await apiJson("/api/admin/team/" + id, { method: "PUT", body: JSON.stringify(body) });
      }
      await refreshBootstrap();
      setStatus("Team saved.", "ok");
    } catch (e) {
      setStatus(e.message, "err");
    }
  }

  function escText(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderProjectsAdmin() {
    const root = $("#projects-list-admin");
    if (!root) return;
    root.innerHTML = "";
    state.projects.forEach((p) => root.appendChild(projectAdminCard(p)));
  }

  function projectAdminCard(p) {
    const isNew = !p.id;
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${isNew ? "New project" : escText(p.title)} <span class="muted" style="font-weight:400">(${escText(p.kind)})</span></h3>
      <div class="mini-form" data-project-form="${p.id || "new"}">
        <label>Kind
          <select name="kind">
            <option value="project" ${p.kind === "microsaas" ? "" : "selected"}>Project</option>
            <option value="microsaas" ${p.kind === "microsaas" ? "selected" : ""}>Micro-SaaS</option>
          </select>
        </label>
        <label>Title <input name="title" value="${escAttr(p.title)}" /></label>
        <label>Slug <input name="slug" value="${escAttr(p.slug)}" /></label>
        <label>Short <textarea name="short_desc" rows="2">${escText(p.short_desc)}</textarea></label>
        <label>Long <textarea name="long_desc" rows="4">${escText(p.long_desc)}</textarea></label>
        <label>Image URL <input name="image" value="${escAttr(p.image)}" /></label>
        <label>External link <input name="link_url" value="${escAttr(p.link_url)}" /></label>
        <div class="row-2">
          <label>Sort <input name="sort_order" type="number" value="${escAttr(p.sort_order)}" /></label>
          <label style="flex-direction:row;align-items:center;gap:0.5rem;margin-top:1.25rem">
            <input name="featured" type="checkbox" ${Number(p.featured) ? "checked" : ""} /> Featured on home
          </label>
        </div>
        <div class="upload-row">
          <input type="file" accept="image/*" data-proj-upload="${p.id || "new"}" />
        </div>
        <div class="row-actions">
          <button type="button" class="btn primary" data-save-proj="${p.id || "new"}">Save</button>
          ${
            !isNew
              ? `<button type="button" class="btn danger" data-del-proj="${p.id}">Delete</button>
                 <a class="btn ghost sm" href="/project.html?slug=${encodeURIComponent(p.slug)}" target="_blank" rel="noopener">View</a>`
              : ""
          }
        </div>
      </div>`;
    const up = card.querySelector(`[data-proj-upload="${p.id || "new"}"]`);
    if (up) {
      up.addEventListener("change", async () => {
        const file = up.files && up.files[0];
        up.value = "";
        if (!file) return;
        try {
          const url = await uploadImage(file);
          card.querySelector('[name="image"]').value = url;
          setStatus("Image uploaded.", "ok");
        } catch (e) {
          setStatus(e.message, "err");
        }
      });
    }
    card.querySelector("[data-save-proj]").addEventListener("click", () => saveProject(card, p.id));
    const del = card.querySelector("[data-del-proj]");
    if (del) {
      del.addEventListener("click", async () => {
        if (!confirm("Delete project?")) return;
        try {
          await apiJson("/api/admin/projects/" + p.id, { method: "DELETE" });
          await refreshBootstrap();
          setStatus("Deleted.", "ok");
        } catch (e) {
          setStatus(e.message, "err");
        }
      });
    }
    return card;
  }

  function readProjectForm(card) {
    const f = card.querySelector("[data-project-form]");
    return {
      kind: f.querySelector('[name="kind"]').value,
      title: f.querySelector('[name="title"]').value,
      slug: f.querySelector('[name="slug"]').value,
      short_desc: f.querySelector('[name="short_desc"]').value,
      long_desc: f.querySelector('[name="long_desc"]').value,
      image: f.querySelector('[name="image"]').value,
      link_url: f.querySelector('[name="link_url"]').value,
      sort_order: f.querySelector('[name="sort_order"]').value,
      featured: f.querySelector('[name="featured"]').checked,
    };
  }

  async function saveProject(card, id) {
    const body = readProjectForm(card);
    try {
      if (!id || id === "new") await apiJson("/api/admin/projects", { method: "POST", body: JSON.stringify(body) });
      else await apiJson("/api/admin/projects/" + id, { method: "PUT", body: JSON.stringify(body) });
      await refreshBootstrap();
      setStatus("Project saved.", "ok");
    } catch (e) {
      setStatus(e.message, "err");
    }
  }

  function renderBlogCategoriesAdmin() {
    const root = $("#blog-cats-admin");
    if (!root) return;
    root.innerHTML = "";
    state.blogCategories.forEach((c) => {
      const div = document.createElement("div");
      div.className = "card";
      div.innerHTML = `
        <div class="mini-form" data-cat-id="${c.id}">
          <label>Name <input name="name" value="${escAttr(c.name)}" /></label>
          <label>Slug <input name="slug" value="${escAttr(c.slug)}" /></label>
          <label>Sort <input name="sort_order" type="number" value="${escAttr(c.sort_order)}" /></label>
          <div class="row-actions">
            <button type="button" class="btn primary" data-save-cat="${c.id}">Save</button>
            <button type="button" class="btn danger" data-del-cat="${c.id}">Delete</button>
          </div>
        </div>`;
      div.querySelector("[data-save-cat]").addEventListener("click", async () => {
        const form = div.querySelector(".mini-form");
        try {
          await apiJson("/api/admin/blog/categories/" + c.id, {
            method: "PUT",
            body: JSON.stringify({
              name: form.querySelector('[name="name"]').value,
              slug: form.querySelector('[name="slug"]').value,
              sort_order: form.querySelector('[name="sort_order"]').value,
            }),
          });
          await refreshBootstrap();
          setStatus("Category saved.", "ok");
        } catch (e) {
          setStatus(e.message, "err");
        }
      });
      div.querySelector("[data-del-cat]").addEventListener("click", async () => {
        if (!confirm("Delete category?")) return;
        try {
          await apiJson("/api/admin/blog/categories/" + c.id, { method: "DELETE" });
          await refreshBootstrap();
        } catch (e) {
          setStatus(e.message, "err");
        }
      });
      root.appendChild(div);
    });
  }

  function renderBlogPostsAdmin() {
    const root = $("#blog-posts-admin");
    if (!root) return;
    root.innerHTML = "";
    state.blogPosts.forEach((p) => root.appendChild(blogPostCard(p)));
  }

  function blogPostCard(p) {
    const isNew = !p.id;
    const card = document.createElement("div");
    card.className = "card";
    const catOpts = state.blogCategories
      .map(
        (c) =>
          `<option value="${c.id}" ${Number(p.category_id) === Number(c.id) ? "selected" : ""}>${escText(
            c.name
          )}</option>`
      )
      .join("");
    card.innerHTML = `
      <h3>${isNew ? "New post" : escText(p.title)}</h3>
      <div class="mini-form" data-post-form="${p.id || "new"}">
        <label>Category <select name="category_id">${catOpts}</select></label>
        <label>Title <input name="title" value="${escAttr(p.title)}" /></label>
        <label>Slug <input name="slug" value="${escAttr(p.slug)}" /></label>
        <label>Excerpt <textarea name="excerpt" rows="2">${escText(p.excerpt)}</textarea></label>
        <label>Body <textarea name="body" rows="6">${escText(p.body)}</textarea></label>
        <label>Published at <input name="published_at" value="${escAttr(p.published_at)}" placeholder="YYYY-MM-DD HH:MM:SS" /></label>
        <label style="flex-direction:row;align-items:center;gap:0.5rem">
          <input name="published" type="checkbox" ${Number(p.published) !== 0 ? "checked" : ""} /> Published
        </label>
        <label>Meta title <input name="meta_title" value="${escAttr(p.meta_title)}" /></label>
        <label>Meta description <textarea name="meta_description" rows="2">${escText(p.meta_description)}</textarea></label>
        <label>Meta keywords <input name="meta_keywords" value="${escAttr(p.meta_keywords)}" /></label>
        <div class="row-actions">
          <button type="button" class="btn primary" data-save-post="${p.id || "new"}">Save</button>
          ${
            !isNew
              ? `<button type="button" class="btn danger" data-del-post="${p.id}">Delete</button>
               <a class="btn ghost sm" href="/post.html?slug=${encodeURIComponent(p.slug)}" target="_blank" rel="noopener">View</a>`
              : ""
          }
        </div>
      </div>`;
    card.querySelector("[data-save-post]").addEventListener("click", () => saveBlogPost(card, p.id));
    const del = card.querySelector("[data-del-post]");
    if (del) {
      del.addEventListener("click", async () => {
        if (!confirm("Delete post?")) return;
        try {
          await apiJson("/api/admin/blog/posts/" + p.id, { method: "DELETE" });
          await refreshBootstrap();
        } catch (e) {
          setStatus(e.message, "err");
        }
      });
    }
    return card;
  }

  function readBlogPostForm(card) {
    const f = card.querySelector("[data-post-form]");
    return {
      category_id: f.querySelector('[name="category_id"]').value,
      title: f.querySelector('[name="title"]').value,
      slug: f.querySelector('[name="slug"]').value,
      excerpt: f.querySelector('[name="excerpt"]').value,
      body: f.querySelector('[name="body"]').value,
      published_at: f.querySelector('[name="published_at"]').value,
      published: f.querySelector('[name="published"]').checked,
      meta_title: f.querySelector('[name="meta_title"]').value,
      meta_description: f.querySelector('[name="meta_description"]').value,
      meta_keywords: f.querySelector('[name="meta_keywords"]').value,
    };
  }

  async function saveBlogPost(card, id) {
    const body = readBlogPostForm(card);
    try {
      if (!id || id === "new") await apiJson("/api/admin/blog/posts", { method: "POST", body: JSON.stringify(body) });
      else await apiJson("/api/admin/blog/posts/" + id, { method: "PUT", body: JSON.stringify(body) });
      await refreshBootstrap();
      setStatus("Post saved.", "ok");
    } catch (e) {
      setStatus(e.message, "err");
    }
  }

  function renderSeoAdmin() {
    const root = $("#seo-list-admin");
    if (!root) return;
    root.innerHTML = "";
    state.seoPages.forEach((row) => {
      const div = document.createElement("div");
      div.className = "card";
      div.innerHTML = `
        <h3>${escText(row.path)}</h3>
        <div class="mini-form">
          <input type="hidden" name="path" value="${escAttr(row.path)}" />
          <label>Title <input name="meta_title" value="${escAttr(row.meta_title)}" /></label>
          <label>Description <textarea name="meta_description" rows="2">${escText(row.meta_description)}</textarea></label>
          <label>Keywords <input name="meta_keywords" value="${escAttr(row.meta_keywords)}" /></label>
          <div class="row-actions">
            <button type="button" class="btn primary" data-seo-save>Save</button>
            <button type="button" class="btn danger sm" data-seo-del>Remove override</button>
          </div>
        </div>`;
      div.querySelector("[data-seo-save]").addEventListener("click", async () => {
        const form = div.querySelector(".mini-form");
        try {
          await apiJson("/api/admin/seo", {
            method: "PUT",
            body: JSON.stringify({
              path: form.querySelector('[name="path"]').value,
              meta_title: form.querySelector('[name="meta_title"]').value,
              meta_description: form.querySelector('[name="meta_description"]').value,
              meta_keywords: form.querySelector('[name="meta_keywords"]').value,
            }),
          });
          await refreshBootstrap();
          setStatus("SEO saved.", "ok");
        } catch (e) {
          setStatus(e.message, "err");
        }
      });
      div.querySelector("[data-seo-del]").addEventListener("click", async () => {
        const path = div.querySelector('[name="path"]').value;
        if (!confirm("Remove SEO row for " + path + "?")) return;
        try {
          await apiJson("/api/admin/seo?path=" + encodeURIComponent(path), { method: "DELETE" });
          await refreshBootstrap();
          setStatus("SEO row removed.", "ok");
        } catch (e) {
          setStatus(e.message, "err");
        }
      });
      root.appendChild(div);
    });
  }

  async function renderTranslationsAdmin() {
    const root = $("#translation-matrix-wrap");
    if (!root) return;
    root.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const j = await apiJson("/api/admin/translations");
      const locales = j.locales || [];
      const localeLabels = j.localeLabels || {};
      const keys = j.keys || [];
      const matrix = j.matrix || {};
      let thead =
        "<thead><tr><th style=\"min-width:140px\">Key</th>" +
        locales
          .map((loc) => `<th>${escText(localeLabels[loc] || loc)} <small>(${escText(loc)})</small></th>`)
          .join("") +
        '<th style="width:100px"></th></tr></thead>';
      let body = "<tbody>";
      for (const key of keys) {
        body += "<tr><td><code>" + escText(key) + "</code></td>";
        for (const loc of locales) {
          const v = (matrix[key] && matrix[key][loc]) || "";
          body +=
            '<td><textarea data-trl="' +
            escAttr(loc) +
            '" rows="2" style="width:100%;min-width:7rem">' +
            escText(v) +
            "</textarea></td>";
        }
        body +=
          '<td><button type="button" class="btn primary sm" data-tr-save="' +
          escAttr(key) +
          '">Save row</button></td></tr>';
      }
      body += "</tbody>";
      root.innerHTML =
        '<div class="card" style="overflow:auto"><table class="admin-table">' + thead + body + "</table></div>";
      root.querySelectorAll("[data-tr-save]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const key = btn.getAttribute("data-tr-save");
          const tr = btn.closest("tr");
          if (!tr || !key) return;
          const values = {};
          tr.querySelectorAll("textarea[data-trl]").forEach((ta) => {
            values[ta.getAttribute("data-trl")] = ta.value;
          });
          try {
            await apiJson("/api/admin/translations/" + encodeURIComponent(key), {
              method: "PUT",
              body: JSON.stringify({ values }),
            });
            setStatus("Saved " + key, "ok");
          } catch (e) {
            setStatus(e.message, "err");
          }
        });
      });
    } catch (e) {
      root.innerHTML = '<p class="err">Could not load translations: ' + escText(e.message) + "</p>";
    }
  }

  function destroyAnalyticsCharts() {
    analyticsCharts.forEach((ch) => {
      try {
        ch.destroy();
      } catch (_) {}
    });
    analyticsCharts = [];
  }

  function renderAnalytics() {
    const host = $("#analytics-dashboard");
    if (!host) return;
    destroyAnalyticsCharts();
    host.innerHTML = '<p class="muted">Loading…</p>';
    apiJson("/api/admin/analytics")
      .then((j) => {
        const t = j.totals || {};
        host.innerHTML = `
        <div class="analytics-summary cards-3">
          <div class="card">
            <h3 style="margin:0 0 0.5rem">Page views</h3>
            <p class="analytics-big">${t.views7d ?? 0}</p>
            <p class="muted" style="margin:0">Last 7 days</p>
            <p class="analytics-big secondary">${t.views30d ?? 0}</p>
            <p class="muted" style="margin:0">Last 30 days</p>
          </div>
          <div class="card">
            <h3 style="margin:0 0 0.5rem">Unique visitors</h3>
            <p class="analytics-big">${t.unique7d ?? 0}</p>
            <p class="muted" style="margin:0">Last 7 days (hashed IP)</p>
            <p class="analytics-big secondary">${t.unique30d ?? 0}</p>
            <p class="muted" style="margin:0">Last 30 days</p>
          </div>
          <div class="card">
            <h3 style="margin:0 0 0.5rem">Sessions & content</h3>
            <p class="muted" style="margin:0">Legacy visitor counter: <strong>${j.visitorCount ?? 0}</strong></p>
            <p class="muted" style="margin:0">Project detail views: <strong>${j.projectViews ?? 0}</strong></p>
            <p class="muted" style="margin:0">Blog post views: <strong>${j.blogViews ?? 0}</strong></p>
          </div>
        </div>
        <div class="card">
          <h3 style="margin-top:0">Daily views & uniques</h3>
          <p class="muted" style="margin-top:0">Last 30 days (unique = distinct visitors per calendar day from rollout)</p>
          <div class="chart-wrap"><canvas id="chart-analytics-daily"></canvas></div>
        </div>
        <div class="analytics-two">
          <div class="card">
            <h3 style="margin-top:0">Devices (30d)</h3>
            <div class="chart-wrap chart-wrap-sm"><canvas id="chart-analytics-devices"></canvas></div>
          </div>
          <div class="card">
            <h3 style="margin-top:0">Top pages (30d)</h3>
            <div class="table-scroll">
              <table class="admin-table">
                <thead><tr><th>Path</th><th>Views</th></tr></thead>
                <tbody id="analytics-top-pages"></tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="card">
          <h3 style="margin-top:0">Top referrers (30d)</h3>
          <div class="table-scroll">
            <table class="admin-table">
              <thead><tr><th>Referrer</th><th>Views</th></tr></thead>
              <tbody id="analytics-top-refs"></tbody>
            </table>
          </div>
        </div>`;

        const tp = j.topPages || [];
        const tr = j.topReferrers || [];
        const tpb = $("#analytics-top-pages");
        const trb = $("#analytics-top-refs");
        if (tpb) {
          tpb.innerHTML = tp.length
            ? tp.map((r) => `<tr><td><code>${escText(r.path)}</code></td><td>${r.views}</td></tr>`).join("")
            : '<tr><td colspan="2" class="muted">No page views yet.</td></tr>';
        }
        if (trb) {
          trb.innerHTML = tr.length
            ? tr
                .map((r) => `<tr><td class="ref-cell">${escText(r.referrer)}</td><td>${r.views}</td></tr>`)
                .join("")
            : '<tr><td colspan="2" class="muted">No referrers yet (direct only).</td></tr>';
        }

        if (typeof Chart === "undefined") return;

        const gridColor = "rgba(148, 163, 184, 0.12)";
        const tickColor = "#94a3b8";
        const daily = j.daily || [];
        const elDaily = document.getElementById("chart-analytics-daily");
        if (elDaily) {
          analyticsCharts.push(
            new Chart(elDaily, {
              type: "line",
              data: {
                labels: daily.map((d) => d.date),
                datasets: [
                  {
                    label: "Views",
                    data: daily.map((d) => d.views),
                    borderColor: "#38bdf8",
                    backgroundColor: "rgba(56, 189, 248, 0.12)",
                    fill: true,
                    tension: 0.25,
                  },
                  {
                    label: "Unique / day",
                    data: daily.map((d) => d.uniqueVisitors),
                    borderColor: "#818cf8",
                    backgroundColor: "rgba(129, 140, 248, 0.08)",
                    fill: true,
                    tension: 0.25,
                  },
                ],
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { labels: { color: "#e7edf6" } },
                },
                scales: {
                  x: {
                    ticks: { color: tickColor, maxRotation: 45 },
                    grid: { color: gridColor },
                  },
                  y: {
                    beginAtZero: true,
                    ticks: { color: tickColor },
                    grid: { color: gridColor },
                  },
                },
              },
            })
          );
        }

        const dev = j.devices || [];
        const elDev = document.getElementById("chart-analytics-devices");
        if (elDev && dev.length) {
          analyticsCharts.push(
            new Chart(elDev, {
              type: "doughnut",
              data: {
                labels: dev.map((d) => d.device),
                datasets: [
                  {
                    data: dev.map((d) => d.views),
                    backgroundColor: [
                      "rgba(56, 189, 248, 0.75)",
                      "rgba(129, 140, 248, 0.75)",
                      "rgba(74, 222, 128, 0.65)",
                      "rgba(251, 191, 36, 0.6)",
                      "rgba(148, 163, 184, 0.45)",
                    ],
                    borderColor: "#141a24",
                    borderWidth: 2,
                  },
                ],
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { position: "bottom", labels: { color: "#e7edf6" } },
                },
              },
            })
          );
        } else if (elDev && elDev.parentElement) {
          elDev.parentElement.innerHTML = '<p class="muted" style="margin:1.5rem 0;text-align:center">No device data yet.</p>';
        }
      })
      .catch(() => {
        destroyAnalyticsCharts();
        host.innerHTML = '<p class="err">Could not load analytics.</p>';
      });
  }

  function renderNewsletterSubscribers() {
    const meta = $("#newsletter-meta");
    const body = $("#newsletter-body");
    const activeCountEl = $("#newsletter-active-count");
    if (!body) return;
    body.innerHTML = '<tr><td colspan="5" class="muted">Loading…</td></tr>';
    const filterEl = $("#newsletter-filter");
    const status = (filterEl && filterEl.value) || "";
    const q = new URLSearchParams({
      page: String(newsletterPage),
      limit: String(newsletterLimit),
    });
    if (status === "active" || status === "unsubscribed") q.set("status", status);

    Promise.all([
      apiJson("/api/admin/newsletter/subscribers?" + q.toString()),
      apiJson("/api/admin/newsletter/subscribers?page=1&limit=1&status=active"),
    ])
      .then(([j, activeJ]) => {
        if (activeCountEl) activeCountEl.textContent = String(activeJ.total ?? 0);
        const total = j.total ?? 0;
        const subs = j.subscribers || [];
        if (meta) {
          const start = total === 0 ? 0 : (newsletterPage - 1) * newsletterLimit + 1;
          const end = Math.min(newsletterPage * newsletterLimit, total);
          meta.textContent =
            total === 0 ? "No rows for this filter." : `Showing ${start}–${end} of ${total} (filter + pagination).`;
        }
        const prev = $("#newsletter-prev");
        const next = $("#newsletter-next");
        const maxPage = Math.max(1, Math.ceil(total / newsletterLimit));
        if (prev) prev.disabled = newsletterPage <= 1;
        if (next) next.disabled = newsletterPage >= maxPage;

        if (!subs.length) {
          body.innerHTML = '<tr><td colspan="5" class="muted">No subscribers match this filter.</td></tr>';
          return;
        }
        body.innerHTML = subs
          .map((s) => {
            const unsub = s.unsubscribedAt ? formatMediaDate(s.unsubscribedAt) : "—";
            return `<tr data-id="${s.id}">
            <td>${escText(s.email)}</td>
            <td>${escText(s.status)}</td>
            <td>${formatMediaDate(s.createdAt)}</td>
            <td>${escText(unsub)}</td>
            <td><button type="button" class="btn ghost sm newsletter-del" data-id="${s.id}">Delete</button></td>
          </tr>`;
          })
          .join("");
      })
      .catch((e) => {
        if (meta) meta.textContent = "";
        body.innerHTML =
          '<tr><td colspan="5" class="err">' + escText(e.message || "Could not load subscribers.") + "</td></tr>";
      });
  }

  function isImageFilename(name) {
    return /\.(jpe?g|png|gif|webp|svg|ico|avif|bmp)$/i.test(String(name || ""));
  }

  function formatMediaBytes(n) {
    const x = Number(n) || 0;
    if (x < 1024) return x + " B";
    if (x < 1024 * 1024) return (x / 1024).toFixed(1) + " KB";
    return (x / (1024 * 1024)).toFixed(1) + " MB";
  }

  function formatMediaDate(iso) {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return String(iso || "—");
    }
  }

  function paintMediaGrid() {
    const grid = $("#media-grid");
    if (!grid) return;
    const filterEl = $("#media-filter");
    const q = (filterEl && filterEl.value ? filterEl.value : "").trim().toLowerCase();
    const list = !q
      ? state.mediaFiles
      : state.mediaFiles.filter((f) => String(f.name).toLowerCase().includes(q));
    if (!state.mediaFiles.length) {
      grid.innerHTML = '<p class="muted">No files in uploads yet.</p>';
      return;
    }
    if (!list.length) {
      grid.innerHTML = '<p class="muted">No files match your search.</p>';
      return;
    }
    grid.innerHTML = "";
    list.forEach((f) => {
      const card = document.createElement("div");
      card.className = "media-card";
      const thumbWrap = document.createElement("div");
      thumbWrap.className = "media-thumb-wrap";
      if (isImageFilename(f.name)) {
        const img = document.createElement("img");
        img.className = "media-thumb";
        img.src = f.url;
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener("error", () => {
          img.remove();
          thumbWrap.classList.add("media-thumb-fallback");
          thumbWrap.textContent = "File";
        });
        thumbWrap.appendChild(img);
      } else {
        thumbWrap.classList.add("media-thumb-fallback");
        thumbWrap.textContent = "File";
      }
      const body = document.createElement("div");
      body.className = "media-card-body";
      const title = document.createElement("div");
      title.className = "media-card-name";
      title.textContent = f.name;
      const meta = document.createElement("div");
      meta.className = "media-card-meta";
      meta.textContent = formatMediaBytes(f.size) + " · " + formatMediaDate(f.mtime);
      const actions = document.createElement("div");
      actions.className = "media-card-actions";
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn ghost sm";
      copyBtn.textContent = "Copy URL";
      copyBtn.addEventListener("click", async () => {
        const full = window.location.origin + f.url;
        try {
          await navigator.clipboard.writeText(full);
          setStatus("URL copied to clipboard.", "ok");
        } catch {
          setStatus("Could not copy (clipboard denied).", "err");
        }
      });
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn danger sm";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", async () => {
        if (!confirm('Delete "' + f.name + '" from the server? This cannot be undone.')) return;
        try {
          await apiJson("/api/admin/media/" + encodeURIComponent(f.name), { method: "DELETE" });
          setStatus("File deleted.", "ok");
          await renderMediaLibrary();
        } catch (e) {
          setStatus(e.message, "err");
        }
      });
      actions.appendChild(copyBtn);
      actions.appendChild(delBtn);
      body.appendChild(title);
      body.appendChild(meta);
      body.appendChild(actions);
      card.appendChild(thumbWrap);
      card.appendChild(body);
      grid.appendChild(card);
    });
  }

  async function renderMediaLibrary() {
    const grid = $("#media-grid");
    const filterEl = $("#media-filter");
    if (!grid) return;
    grid.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const j = await apiJson("/api/admin/media");
      state.mediaFiles = j.files || [];
      paintMediaGrid();
    } catch (e) {
      grid.innerHTML = '<p class="err">' + escText(e.message) + "</p>";
      return;
    }
    if (filterEl && !filterEl.dataset.mediaBound) {
      filterEl.dataset.mediaBound = "1";
      filterEl.addEventListener("input", () => paintMediaGrid());
    }
  }

  function bindActivityLogControlsOnce() {
    const tab = $("#tab-activity");
    if (!tab || tab.dataset.logBound) return;
    tab.dataset.logBound = "1";
    const prev = $("#activity-log-prev");
    const next = $("#activity-log-next");
    const filter = $("#activity-action-filter");
    if (prev) {
      prev.addEventListener("click", () => {
        if (activityLogPage > 1) {
          activityLogPage--;
          renderActivityLog();
        }
      });
    }
    if (next) {
      next.addEventListener("click", () => {
        activityLogPage++;
        renderActivityLog();
      });
    }
    if (filter) {
      filter.addEventListener("change", () => {
        activityLogPage = 1;
        renderActivityLog();
      });
    }
  }

  async function renderActivityLog() {
    bindActivityLogControlsOnce();
    const tbody = $("#activity-log-body");
    const meta = $("#activity-log-meta");
    const filterEl = $("#activity-action-filter");
    const prev = $("#activity-log-prev");
    const next = $("#activity-log-next");
    if (!tbody) return;

    const qs = new URLSearchParams();
    qs.set("page", String(activityLogPage));
    qs.set("limit", "50");
    if (filterEl && filterEl.value) qs.set("action", filterEl.value);

    try {
      const j = await apiJson("/api/admin/activity-log?" + qs.toString());
      const actions = j.actions || [];
      const selVal = filterEl && filterEl.value ? filterEl.value : "";
      if (filterEl) {
        filterEl.innerHTML =
          '<option value="">All actions</option>' +
          actions.map((a) => '<option value="' + escAttr(a) + '">' + escText(a) + "</option>").join("");
        if (selVal && actions.includes(selVal)) filterEl.value = selVal;
      }

      const total = Number(j.total || 0);
      const limit = Number(j.limit || 50);
      const page = Number(j.page || 1);
      const pages = Math.max(1, Math.ceil(total / limit) || 1);
      if (activityLogPage > pages) {
        activityLogPage = pages;
        await renderActivityLog();
        return;
      }
      if (meta) meta.textContent = "Page " + page + " of " + pages + " · " + total + " entries";
      if (prev) prev.disabled = page <= 1;
      if (next) next.disabled = page >= pages;

      const entries = j.entries || [];
      tbody.innerHTML = "";
      if (!entries.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 5;
        td.className = "muted";
        td.textContent = "No activity recorded yet.";
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }
      entries.forEach((row) => {
        const tr = document.createElement("tr");
        const t0 = document.createElement("td");
        t0.textContent = row.createdAt ? new Date(row.createdAt).toLocaleString() : "—";
        const t1 = document.createElement("td");
        t1.textContent = row.adminUsername || "—";
        const t2 = document.createElement("td");
        t2.textContent = row.action || "—";
        const t3 = document.createElement("td");
        t3.className = "entity-cell";
        const et = (row.entityType || "").trim();
        const eid = (row.entityId || "").trim();
        t3.innerHTML =
          escText(et || "—") + (eid ? ' <span class="et">' + escText(eid) + "</span>" : "");
        const t4 = document.createElement("td");
        t4.className = "details-cell";
        t4.textContent = row.details || "";
        tr.appendChild(t0);
        tr.appendChild(t1);
        tr.appendChild(t2);
        tr.appendChild(t3);
        tr.appendChild(t4);
        tbody.appendChild(tr);
      });
    } catch (e) {
      tbody.innerHTML = "";
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.className = "err";
      td.textContent = escText(e.message);
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  }

  function renderMessages() {
    const root = $("#messages-list");
    if (!root) return;
    if (!state.messages.length) {
      root.innerHTML = '<p class="muted">No messages yet.</p>';
      return;
    }
    root.innerHTML = "";
    state.messages.forEach((m) => {
      const div = document.createElement("div");
      div.className = "card" + (m.isRead ? "" : " unread");
      div.innerHTML = `
        <div class="msg-meta">
          <strong>${escText(m.name)}</strong> · ${escText(m.email)}
          ${m.phone ? " · " + escText(m.phone) : ""}
          · ${escText(m.createdAt)}
          ${m.isRead ? "" : " · <em>Unread</em>"}
        </div>
        <p class="msg-body">${escText(m.message)}</p>
        ${
          m.attachmentPath
            ? `<p class="msg-meta"><a href="${escAttr(m.attachmentPath)}" target="_blank" rel="noopener">Attachment: ${escText(
                m.attachmentName || "download"
              )}</a></p>`
            : ""
        }
        <div class="row-actions">
          ${
            m.isRead
              ? ""
              : `<button type="button" class="btn ghost sm" data-read-msg="${m.id}">Mark read</button>`
          }
          <button type="button" class="btn danger sm" data-del-msg="${m.id}">Delete</button>
        </div>`;
      const readBtn = div.querySelector("[data-read-msg]");
      if (readBtn) {
        readBtn.addEventListener("click", async () => {
          try {
            await apiJson("/api/admin/messages/" + m.id + "/read", { method: "PATCH" });
            await refreshBootstrap();
          } catch (e) {

            setStatus(e.message, "err");

          }

        });

      }

      div.querySelector("[data-del-msg]").addEventListener("click", async () => {

        if (!confirm("Delete message?")) return;

        try {

          await apiJson("/api/admin/messages/" + m.id, { method: "DELETE" });

          await refreshBootstrap();

        } catch (e) {

          setStatus(e.message, "err");

        }

      });

      root.appendChild(div);

    });

  }



  async function init() {

    const loginView = $("#view-login");

    const appView = $("#view-app");



    try {

      const s = await apiJson("/api/admin/session");

      if (s.authed) {

        loginView.classList.add("hidden");

        appView.classList.remove("hidden");

        await refreshBootstrap();

      } else if (s.needTotp) {

        showLoginTotpStep();

      }

    } catch {

      /* show login */

    }



    $("#login-form").addEventListener("submit", async (e) => {

      e.preventDefault();

      const fd = new FormData(e.target);

      const err = $("#login-err");

      err.textContent = "";

      try {

        const j = await apiJson("/api/admin/login", {

          method: "POST",

          body: JSON.stringify({

            username: fd.get("username"),

            password: fd.get("password"),

          }),

        });

        if (j.needTotp) {

          showLoginTotpStep();

          return;

        }

        loginView.classList.add("hidden");

        appView.classList.remove("hidden");

        await refreshBootstrap();

      } catch (ex) {

        err.textContent = ex.message;

      }

    });



    const totpForm = $("#login-totp-form");

    if (totpForm) {
      totpForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const err = $("#login-totp-err");
        if (err) err.textContent = "";
        const token = (totpForm.elements.namedItem("token") && totpForm.elements.namedItem("token").value) || "";
        try {
          await apiJson("/api/admin/login/totp", {
            method: "POST",
            body: JSON.stringify({ token: String(token).replace(/\s/g, "") }),
          });
          loginView.classList.add("hidden");
          appView.classList.remove("hidden");
          showLoginCredentialStep();
          await refreshBootstrap();
        } catch (ex) {
          if (err) err.textContent = ex.message;
        }
      });
    }

    const totpBack = $("#login-totp-back");

    if (totpBack) {
      totpBack.addEventListener("click", async () => {
        try {
          await fetch("/api/admin/login/cancel", { method: "POST", credentials: "include" });
        } catch {
          /* ignore */
        }
        showLoginCredentialStep();
        const te = $("#login-totp-err");
        if (te) te.textContent = "";
      });
    }



    $("#btn-logout").addEventListener("click", async () => {

      try {

        await apiJson("/api/admin/logout", { method: "POST" });

      } catch {

        /* ignore */

      }

      appView.classList.add("hidden");

      loginView.classList.remove("hidden");

      showLoginCredentialStep();

      $("#login-form").reset();

      const te = $("#login-totp-err");

      if (te) te.textContent = "";

    });



    $("#nav-tabs").addEventListener("click", (e) => {

      const btn = e.target.closest("[data-tab]");

      if (!btn) return;

      switchTab(btn.getAttribute("data-tab"));

    });



    $("#form-site").addEventListener("submit", async (e) => {

      e.preventDefault();

      const f = e.target;

      const keys = [

        "company_name",

        "footer_tagline",

        "hero_title",

        "hero_subtitle",

        "hero_image",

        "hero_cta_primary_text",

        "hero_cta_primary_link",

        "hero_cta_secondary_text",

        "hero_cta_secondary_link",

        "home_about_title",

        "home_about_text",

        "home_about_image",

        "about_page_title",

        "about_page_lead",

        "about_page_body",

        "about_mission",

        "about_values",

        "contact_map_embed_url",

        "default_locale",

        "home_projects_title",

        "home_projects_intro",

        "feature_flags_json",

        "analytics_mock_json",

      ];

      const body = {};

      keys.forEach((k) => {

        body[k] = f.elements.namedItem(k).value;

      });

      try {

        await apiJson("/api/admin/site", { method: "PUT", body: JSON.stringify(body) });

        state.kv = { ...state.kv, ...body };

        setStatus("Homepage content saved.", "ok");

      } catch (ex) {

        setStatus(ex.message, "err");

      }

    });



    $("#banner-add").addEventListener("click", () => {

      if (state.banners.length >= 6) {

        setStatus("Max 6 banners.", "err");

        return;

      }

      state.banners.push({

        image: "",

        title: "",

        subtitle: "",

        link: "",

        linkText: "",

      });

      renderBanners();

    });



    $("#banners-save").addEventListener("click", async () => {

      try {

        await apiJson("/api/admin/site", {

          method: "PUT",

          body: JSON.stringify({ banners_json: JSON.stringify(state.banners) }),

        });

        setStatus("Banners saved.", "ok");

      } catch (ex) {

        setStatus(ex.message, "err");

      }

    });



    $("#service-new").addEventListener("click", () => {

      const root = $("#services-list-admin");

      const temp = {

        title: "",

        slug: "",

        short_desc: "",

        long_desc: "",

        icon: "layers",

        image: "",

        sort_order: 0,

        featured: 1,

      };

      const card = serviceCard(temp);

      root.insertBefore(card, root.firstChild);

      card.querySelector('[name="title"]').focus();

    });



    $("#team-new").addEventListener("click", () => {

      const root = $("#team-list-admin");

      const temp = { name: "", role: "", bio: "", image: "", sort_order: 0 };

      const card = teamCard(temp);

      root.insertBefore(card, root.firstChild);

    });



    const btnTwofaSetup = $("#btn-twofa-setup");

    if (btnTwofaSetup) {
      btnTwofaSetup.addEventListener("click", async () => {
        const sErr = $("#twofa-setup-err");
        if (sErr) sErr.textContent = "";
        try {
          const j = await apiJson("/api/admin/2fa/setup");
          pending2faSecret = j.secret || "";
          const qr = $("#twofa-qr");
          const hint = $("#twofa-setup-hint");
          if (qr && j.qrDataUrl) {
            qr.src = j.qrDataUrl;
            qr.classList.remove("hidden");
          }
          if (hint) hint.classList.remove("hidden");
          setStatus("Scan the QR code with your authenticator app.", "ok");
        } catch (e) {
          if (sErr) sErr.textContent = e.message;
          setStatus(e.message, "err");
        }
      });
    }

    const btnTwofaEnable = $("#btn-twofa-enable");

    if (btnTwofaEnable) {
      btnTwofaEnable.addEventListener("click", async () => {
        const sErr = $("#twofa-setup-err");
        if (sErr) sErr.textContent = "";
        const codeEl = $("#twofa-enable-code");
        const token = (codeEl && codeEl.value) || "";
        if (!pending2faSecret) {
          if (sErr) sErr.textContent = "Generate the QR code first.";
          return;
        }
        try {
          await apiJson("/api/admin/2fa/enable", {
            method: "POST",
            body: JSON.stringify({ token: String(token).replace(/\s/g, ""), secret: pending2faSecret }),
          });
          pending2faSecret = "";
          if (codeEl) codeEl.value = "";
          await loadSecurityPanel();
          setStatus("Two-factor authentication enabled.", "ok");
        } catch (e) {
          if (sErr) sErr.textContent = e.message;
          setStatus(e.message, "err");
        }
      });
    }

    const btnTwofaDisable = $("#btn-twofa-disable");

    if (btnTwofaDisable) {
      btnTwofaDisable.addEventListener("click", async () => {
        const dErr = $("#twofa-disable-err");
        if (dErr) dErr.textContent = "";
        const pwEl = $("#twofa-disable-password");
        const password = (pwEl && pwEl.value) || "";
        try {
          await apiJson("/api/admin/2fa/disable", {
            method: "POST",
            body: JSON.stringify({ password }),
          });
          if (pwEl) pwEl.value = "";
          await loadSecurityPanel();
          setStatus("Two-factor authentication disabled.", "ok");
        } catch (e) {
          if (dErr) dErr.textContent = e.message;
          setStatus(e.message, "err");
        }
      });
    }

    const btnPwChange = $("#btn-password-change");
    if (btnPwChange) {
      btnPwChange.addEventListener("click", async () => {
        const err = $("#pw-change-err");
        if (err) err.textContent = "";
        const cur = $("#pw-current");
        const n1 = $("#pw-new");
        const n2 = $("#pw-new2");
        try {
          if (!n1.value || n1.value !== n2.value) throw new Error("The new passwords do not match.");
          await apiJson("/api/admin/password", {
            method: "POST",
            body: JSON.stringify({ currentPassword: cur.value, newPassword: n1.value }),
          });
          cur.value = "";
          n1.value = "";
          n2.value = "";
          setStatus("Password changed. Other sessions were signed out.", "ok");
        } catch (e) {
          if (err) err.textContent = e.message;
          setStatus(e.message, "err");
        }
      });
    }

    const nflt = $("#newsletter-filter");
    if (nflt) {
      nflt.addEventListener("change", () => {
        newsletterPage = 1;
        renderNewsletterSubscribers();
      });
    }
    const nprev = $("#newsletter-prev");
    if (nprev) {
      nprev.addEventListener("click", () => {
        if (newsletterPage > 1) {
          newsletterPage -= 1;
          renderNewsletterSubscribers();
        }
      });
    }
    const nnext = $("#newsletter-next");
    if (nnext) {
      nnext.addEventListener("click", () => {
        newsletterPage += 1;
        renderNewsletterSubscribers();
      });
    }
    const nex = $("#newsletter-export");
    if (nex) {
      nex.addEventListener("click", () => {
        window.location.href = "/api/admin/newsletter/export.csv";
      });
    }
    const nbody = $("#newsletter-body");
    if (nbody) {
      nbody.addEventListener("click", async (e) => {
        const btn = e.target.closest(".newsletter-del");
        if (!btn) return;
        const id = btn.getAttribute("data-id");
        if (!id || !window.confirm("Delete this subscriber permanently?")) return;
        try {
          await apiJson("/api/admin/newsletter/subscribers/" + id, { method: "DELETE" });
          setStatus("Subscriber deleted.", "ok");
          renderNewsletterSubscribers();
        } catch (ex) {
          setStatus(ex.message, "err");
        }
      });
    }

    const nsPreview = $("#newsletter-send-preview");
    if (nsPreview) {
      nsPreview.addEventListener("click", () => {
        const htmlEl = $("#newsletter-send-html");
        const html = (htmlEl && htmlEl.value) || "";
        const origin = window.location.origin;
        const demoUrl = origin + "/unsubscribe.html?token=preview-example-token";
        const footer =
          '<div style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid #e5e7eb;font-size:13px;line-height:1.5;color:#6b7280;font-family:system-ui,-apple-system,sans-serif;">' +
          '<p style="margin:0 0 0.5rem">You are subscribed to our newsletter.</p>' +
          '<p style="margin:0"><a href="' +
          demoUrl +
          '" style="color:#2563eb">Unsubscribe</a></p></div>';
        const w = window.open("", "_blank");
        if (w) {
          w.document.write(
            "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Newsletter preview</title></head><body>" +
              html +
              footer +
              "</body></html>"
          );
          w.document.close();
        }
      });
    }

    const nsSend = $("#newsletter-send-btn");
    if (nsSend) {
      nsSend.addEventListener("click", async () => {
        const subEl = $("#newsletter-send-subject");
        const htmlEl = $("#newsletter-send-html");
        const st = $("#newsletter-send-status");
        const subject = (subEl && subEl.value) || "";
        const bodyHtml = (htmlEl && htmlEl.value) || "";
        if (!subject.trim()) {
          if (st) {
            st.textContent = "Enter a subject.";
            st.className = "status err";
          }
          return;
        }
        try {
          const countJ = await apiJson("/api/admin/newsletter/subscribers?page=1&limit=1&status=active");
          const n = countJ.total ?? 0;
          if (!window.confirm("Send this newsletter to " + n + " active subscriber(s)?")) return;
          if (st) {
            st.textContent = "";
            st.className = "status";
          }
          const r = await fetch("/api/admin/newsletter/send", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subject: subject.trim(), html: bodyHtml }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || r.statusText || "Send failed");
          // The server sends in the background; poll until it reports the final counts.
          const queuedMsg = "Sending to " + j.queued + " subscriber(s)…";
          if (st) {
            st.textContent = queuedMsg;
            st.className = "status";
          }
          setStatus(queuedMsg, "");
          let final = null;
          for (let i = 0; i < 900 && !final; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const sj = await apiJson("/api/admin/newsletter/send-status");
            if (!sj.sending) final = sj.last || { sent: 0, failed: j.queued };
          }
          if (!final) throw new Error("Still sending. Check the Activity log for the final result.");
          const doneMsg = "Newsletter: " + final.sent + " sent, " + final.failed + " failed.";
          if (st) {
            st.textContent = doneMsg;
            st.className = "status " + (final.failed ? "err" : "ok");
          }
          setStatus(doneMsg, final.failed ? "err" : "ok");
          renderNewsletterSubscribers();
        } catch (e) {
          if (st) {
            st.textContent = e.message;
            st.className = "status err";
          }
          setStatus(e.message, "err");
        }
      });
    }

    switchTab("site");

    const exportCsv = $("#btn-export-csv");
    if (exportCsv) {
      exportCsv.addEventListener("click", async () => {
        try {
          const r = await fetch("/api/admin/messages/export.csv", { credentials: "include" });
          if (!r.ok) throw new Error("Export failed");
          const blob = await r.blob();
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "contact-messages.csv";
          a.click();
          URL.revokeObjectURL(a.href);
        } catch (e) {
          setStatus(e.message, "err");
        }
      });
    }

    const pn = $("#project-new");
    if (pn) {
      pn.addEventListener("click", () => {
        const root = $("#projects-list-admin");
        const card = projectAdminCard({
          kind: "project",
          title: "",
          slug: "",
          short_desc: "",
          long_desc: "",
          image: "",
          link_url: "",
          featured: 1,
          sort_order: 0,
        });
        root.insertBefore(card, root.firstChild);
      });
    }

    const btnPost = $("#blog-post-new");
    if (btnPost) {
      btnPost.addEventListener("click", () => {
        const root = $("#blog-posts-admin");
        const card = blogPostCard({
          category_id: state.blogCategories[0]?.id || 1,
          title: "",
          slug: "",
          excerpt: "",
          body: "",
          published: 1,
          published_at: "",
          meta_title: "",
          meta_description: "",
          meta_keywords: "",
        });
        root.insertBefore(card, root.firstChild);
      });
    }

    const btnCat = $("#blog-cat-new");
    if (btnCat) {
      btnCat.addEventListener("click", async () => {
        const name = window.prompt("Category name");
        if (!name || !name.trim()) return;
        try {
          await apiJson("/api/admin/blog/categories", {
            method: "POST",
            body: JSON.stringify({ name: name.trim(), slug: "", sort_order: 0 }),
          });
          await refreshBootstrap();
          setStatus("Category added.", "ok");
        } catch (e) {
          setStatus(e.message, "err");
        }
      });
    }

    const seoAdd = $("#seo-add-btn");
    if (seoAdd) {
      seoAdd.addEventListener("click", async () => {
        const form = $("#seo-new-form");
        if (!form) return;
        try {
          await apiJson("/api/admin/seo", {
            method: "PUT",
            body: JSON.stringify({
              path: form.querySelector('[name="path"]').value,
              meta_title: form.querySelector('[name="meta_title"]').value,
              meta_description: form.querySelector('[name="meta_description"]').value,
              meta_keywords: form.querySelector('[name="meta_keywords"]').value,
            }),
          });
          await refreshBootstrap();
          setStatus("SEO path saved.", "ok");
        } catch (e) {
          setStatus(e.message, "err");
        }
      });
    }

  }



  document.addEventListener("DOMContentLoaded", init);

})();


