/* global fetch, FormData, document, window */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  let state = {
    kv: {},
    services: [],
    team: [],
    messages: [],
    banners: [],
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
    fillSiteForm();
    renderBanners();
    renderServices();
    renderTeam();
    renderMessages();
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

        await apiJson("/api/admin/login", {

          method: "POST",

          body: JSON.stringify({

            username: fd.get("username"),

            password: fd.get("password"),

          }),

        });

        loginView.classList.add("hidden");

        appView.classList.remove("hidden");

        await refreshBootstrap();

      } catch (ex) {

        err.textContent = ex.message;

      }

    });



    $("#btn-logout").addEventListener("click", async () => {

      try {

        await apiJson("/api/admin/logout", { method: "POST" });

      } catch {

        /* ignore */

      }

      appView.classList.add("hidden");

      loginView.classList.remove("hidden");

      $("#login-form").reset();

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



    switchTab("site");

  }



  document.addEventListener("DOMContentLoaded", init);

})();


