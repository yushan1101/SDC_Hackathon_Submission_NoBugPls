// Public application page for one opening (no account). Consent first; the resume is screened by AI agents, blind.
import { api, upload, h, $, icon, reveal, RISE } from "./lib.js";
import { Owl } from "./owl.js";

const app = $("#app");
const token = decodeURIComponent(location.hash.slice(1)) || location.pathname.split("/").pop();  // apply.html#<token>

async function boot() {
  let info;
  try { info = await api(`/api/apply/${encodeURIComponent(token)}`); } catch (e) {
    app.replaceChildren(h("main", { class: "pub-main apply" }, new Owl({ size: 96, state: "confused" }).el,
      h("h1", { class: "page-title" }, "This link is closed"), h("p", { class: "lede" }, e.message)));
    return;
  }
  const owl = new Owl({ size: 112, state: "greeting" });
  const err = h("p", { class: "error", role: "alert" });
  const name = h("input", { class: "input", name: "name", required: true, maxlength: 80, autocomplete: "name" });
  const email = h("input", { class: "input", name: "email", type: "email", required: true, maxlength: 120, autocomplete: "email" });
  const fileName = h("span", { class: "note" }, "PDF, Word (.docx), .txt or .md · up to 2 MB");
  const file = h("input", { type: "file", name: "file", accept: ".pdf,.docx,.txt,.md", required: true, class: "sr-only", id: "apply-file",
    onchange: () => { fileName.textContent = file.files[0]?.name || ""; owl.set("listening"); } });
  const consent = h("input", { type: "checkbox", name: "consent", required: true });
  const btn = h("button", { class: "btn primary", type: "submit" }, "Submit application", icon("send"));
  const form = h("form", { class: "apply-form", onsubmit: async (e) => {
    e.preventDefault(); err.textContent = "";
    if (!file.files[0]) { err.textContent = "Attach your resume."; return; }
    if (file.files[0].size > 2_000_000) { err.textContent = "That file is over 2 MB."; return; }
    btn.disabled = true; owl.set("analyzing");
    const fd = new FormData();
    fd.append("name", name.value.trim()); fd.append("email", email.value.trim());
    fd.append("consent", consent.checked ? "true" : "false"); fd.append("file", file.files[0]);
    fd.append("website", form.querySelector("[name=website]").value);
    try {
      const r = await upload(`/api/apply/${encodeURIComponent(token)}`, fd);
      owl.set("celebrating");
      form.replaceWith(reveal(h("div", { class: "apply-done", role: "status" },
        h("h2", {}, r.message), h("p", {}, "Reference ", h("b", { class: "mono" }, r.reference),
          ". The hiring team will review your application and email you if you're shortlisted.")), RISE));
    } catch (ex) { err.textContent = ex.message; owl.set("confused"); btn.disabled = false; }
  } },
    h("label", { class: "field" }, h("span", {}, "Full name"), name),
    h("label", { class: "field" }, h("span", {}, "Email"), email),
    h("div", { class: "field" }, h("span", {}, "Resume"),
      h("label", { class: "cv-drop", for: "apply-file" }, file, icon("upload"), h("b", {}, "Choose your resume"), fileName)),
    h("label", { class: "hp", "aria-hidden": "true" }, "Website", h("input", { name: "website", tabindex: "-1", autocomplete: "off" })),
    h("label", { class: "check" }, consent, "I agree that my resume is processed to assess this application, as described under “How your resume is handled”."),
    err, btn);
  app.replaceChildren(h("main", { class: "pub-main apply" },
    h("div", { class: "start-head" }, h("div", {},
      h("p", { class: "wordmark-sm" }, "AiversePulse · application"),
      h("h1", { class: "page-title" }, info.title),
      info.occupation && info.occupation !== info.title ? h("p", { class: "muted" }, `Role type: ${info.occupation}`) : null),
      owl.el),
    h("div", { class: "apply-grid" }, form,
      h("aside", { class: "apply-aside" },
        h("h2", {}, "About this role"), h("p", {}, info.description),
        h("h2", {}, "How your resume is handled"), h("p", {}, info.privacy)))));
}

boot();
