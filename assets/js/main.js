// Arranque do portal, navegação e páginas Sobre, Documentos e Fichas de campo.
import { S, carregarTudo, DATASETS } from "./data.js";
import { UI } from "./i18n.js";
import { $, h, esc, tr, toast, fmt } from "./util.js";

const t = k => UI[S.lang][k] || k;
let dadosPromessa = null;

/* ---------- Modal reutilizável ---------- */
export function modal(titulo, corpo, botoes = [{ texto: "OK" }], opts = {}) {
  const fundo = h("div", { class: "modal-fundo" });
  const fechar = () => { fundo.remove(); if (opts.aoFechar) opts.aoFechar(); };
  const caixa = h("div", { class: "modal" + (opts.largo ? " largo" : "") },
    h("div", { class: "modal-t" }, h("span", {}, titulo), h("button", { class: "x", onclick: fechar, "aria-label": t("fechar") }, "×")),
    h("div", { class: "modal-b" }, corpo),
    h("div", { class: "modal-f" }, botoes.map(b => h("button", { class: "btn" + (b.primario ? " primary" : ""), onclick: async () => { if (b.accao) { const r = await b.accao(); if (r === false) return; } fechar(); } }, b.texto))));
  fundo.append(caixa);
  fundo.addEventListener("click", e => { if (e.target === fundo) fechar(); });
  document.body.append(fundo);
  return { fechar, caixa };
}

/* ---------- Configuração ---------- */
async function lerJSON(p) { const r = await fetch(p + "?v=" + Date.now()); if (!r.ok) throw new Error(p + ": HTTP " + r.status); return r.json(); }

export function repoPadrao() {
  const g = S.cfg.github || {};
  let owner = g.owner, repo = g.repo;
  const host = location.hostname;
  if (!owner && host.endsWith(".github.io")) owner = host.split(".")[0];
  if (!repo && host.endsWith(".github.io")) { const seg = location.pathname.split("/").filter(Boolean)[0]; repo = seg || `${owner}.github.io`; }
  return { owner: owner || "", repo: repo || "", branch: g.branch || "main" };
}

export function aplicarTema() {
  const p = S.cfg.portal, r = document.documentElement.style;
  r.setProperty("--cor1", p.corPrimaria || "#0b4a3a");
  r.setProperty("--cor2", p.corSecundaria || "#1f7a5c");
  r.setProperty("--cor3", p.corDestaque || "#e8743b");
  document.title = tr(p.nome, S.lang);
  document.documentElement.lang = S.lang === "en" ? "en" : "pt";
}

/* ---------- Estrutura ---------- */
export function renderShell() {
  aplicarTema();
  const p = S.cfg.portal, rota = location.hash || "#/sobre";
  const nav = [["#/sobre", "nav_sobre"], ["#/dashboard", "nav_dashboard"], ["#/documentos", "nav_documentos"], ["#/fichas", "nav_fichas"], ["#/tecnica", "nav_tecnica"], ["#/gestao", "nav_gestao"]];
  const topo = $("#topo"); topo.innerHTML = "";
  topo.append(
    h("a", { class: "marca", href: "#/sobre" },
      h("img", { class: "logo-inom", src: p.logoInom, alt: "InOM" }),
      h("span", { class: "marca-txt" }, h("strong", {}, tr(p.nome, S.lang)), h("small", {}, tr(p.subtitulo, S.lang)))),
    h("nav", { class: "menu" }, nav.map(([href, k]) => h("a", { href, class: rota.startsWith(href.split("/").slice(0, 2).join("/")) ? "active" : "" }, t(k)))),
    h("div", { class: "lingua" }, ["pt", "en"].map(l => h("button", { class: S.lang === l ? "active" : "", title: t(l), onclick: () => mudarLingua(l) }, l.toUpperCase()))));
  const rod = $("#rodape"); rod.innerHTML = "";
  rod.append(
    h("div", { class: "apoio" }, h("span", {}, tr(p.textoApoio, S.lang)), h("img", { class: "logo-apoio", src: p.logoApoio, alt: p.nomeApoio || "LIKULU" })),
    h("div", { class: "rodape-txt" }, tr(p.rodape, S.lang), p.contacto ? h("span", {}, " · ", h("a", { href: "mailto:" + p.contacto }, p.contacto)) : null));
  const demo = Object.values(S.data).some(d => d.estado === "demo");
  $("#aviso").innerHTML = demo ? `<div class="banner">${esc(t("demo_banner"))}</div>` : "";
  let barra = $("#barra-preview");
  if (S.preview && S.gestaoSujo && !(location.hash || "").startsWith("#/gestao")) {
    const L = (pt, en) => (S.lang === "en" ? en : pt);
    if (!barra) { barra = h("div", { id: "barra-preview" }); document.body.append(barra); }
    barra.innerHTML = "";
    barra.append(h("span", {}, "👁 " + L("Pré-visualização: as alterações ainda não estão públicas.", "Preview: changes are not public yet.")),
      h("a", { class: "btn claro", href: "#/gestao" }, L("Voltar à gestão", "Back to management")),
      h("button", { class: "btn destaque", onclick: async () => { const m = await import("./gestao.js"); await m.publicarAlteracoes(); renderShell(); } }, L("Publicar alterações", "Publish changes")));
  } else if (barra) barra.remove();
}

function mudarLingua(l) { S.lang = l; localStorage.setItem("lang", l); renderShell(); route(); }

/* ---------- Rotas ---------- */
export async function route() {
  const hash = location.hash || "#/sobre";
  const [, sec, sub] = hash.split("/");
  const app = $("#app");
  document.body.classList.toggle("modo-gestao", sec === "gestao");
  renderShell();
  window.scrollTo(0, 0);
  if (sec === "dashboard") {
    if (!dadosProntos()) { app.innerHTML = `<div class="loading">${t("carregando")}</div>`; await dadosPromessa; renderShell(); }
    const m = await import("./dash.js"); m.renderDashboard(app, sub);
  } else if (sec === "documentos") renderDocumentos(app);
  else if (sec === "fichas") renderFichas(app);
  else if (sec === "tecnica") {
    if (S.cfg.acesso && S.cfg.acesso.tecnicaRequerLogin && !S.auth) return pedirLogin(app);
    if ((sub || "").startsWith("painel") || (!sub && ((S.cfg.tecnica || {}).paineis || []).length)) { const m = await import("./tecnica.js"); return m.renderTecnica(app, sub || ""); }
    if (!dadosProntos()) { app.innerHTML = `<div class="loading">${t("carregando")}</div>`; await dadosPromessa; renderShell(); }
    const m = await import("./tecnica.js"); m.renderTecnica(app, sub || "");
  } else if (sec === "gestao") { const m = await import("./gestao.js"); m.renderGestao(app); }
  else renderSobre(app);
}

function dadosProntos() { return DATASETS.every(d => S.data[d] && S.data[d].estado !== "a_carregar"); }

export function pedirLogin(app) {
  app.innerHTML = "";
  app.append(h("div", { class: "pagina estreita" }, h("p", {}, t("restrito")), h("a", { class: "btn primary", href: "#/gestao" }, t("ir_login"))));
}

export function recarregarDados() { dadosPromessa = carregarTudo(() => {}).then(() => { renderShell(); }); return dadosPromessa; }

/* ---------- Páginas de conteúdo ---------- */
function md(txt) { return window.marked ? window.marked.parse(txt || "") : esc(txt || "").replace(/\n/g, "<br>"); }

function renderSobre(app) {
  app.innerHTML = "";
  const L = (pt, en) => (S.lang === "en" ? en : pt);
  const nums = h("div", { class: "hero-nums" });
  const paginas = h("div", { class: "hero-pags" });
  app.append(
    h("section", { class: "hero" },
      h("div", { class: "hero-txt" },
        h("h1", {}, tr(S.cfg.portal.nome, S.lang)),
        h("p", {}, tr(S.cfg.portal.subtitulo, S.lang)),
        h("div", { class: "hero-acoes" },
          h("a", { class: "btn destaque", href: "#/dashboard" }, "▦ " + L("Explorar o dashboard", "Explore the dashboard")),
          h("a", { class: "btn claro", href: "#/fichas" }, L("Fichas de campo", "Field forms")))),
      nums),
    h("div", { class: "pagina sobre" }, h("div", { class: "md", html: md(tr(S.cfg.sobre, S.lang)) })),
    h("h2", { class: "sec-t" }, L("Temas do dashboard", "Dashboard topics")), paginas);
  import("./dash.js").then(m => {
    for (const p of S.cfg.dashboard.paginas) paginas.append(h("a", { class: "pag-cartao", href: `#/dashboard/${p.id}` }, m.icone(p.icone || "lista", "ic grande"),
      h("div", {}, h("strong", {}, tr(p.titulo, S.lang)), p.descricao ? h("p", {}, tr(p.descricao, S.lang)) : null)));
    const preencher = () => {
      nums.innerHTML = "";
      const ks = ((S.cfg.dashboard.paginas[0] || {}).kpis || []).slice(0, 4);
      for (const k of ks) { const v = m.kpiValor(k); nums.append(h("div", { class: "hero-num" }, h("strong", {}, fmt(v, { formato: k.formato, decimais: k.decimais, sufixo: k.sufixo, compacto: true }, S.lang)), h("span", {}, tr(k.titulo, S.lang)))); }
    };
    nums.append(h("div", { class: "hero-num" }, h("span", {}, t("carregando"))));
    (dadosPromessa || Promise.resolve()).then(() => { if (location.hash === "" || location.hash.startsWith("#/sobre")) preencher(); });
  });
}

function urlFicheiro(f) { return /^https?:\/\//.test(f || "") ? f : f; }

function renderDocumentos(app) {
  app.innerHTML = "";
  const docs = S.cfg.documentos || [];
  let q = "", cat = "";
  const lista = h("div", { class: "docs" });
  const cats = [...new Set(docs.map(d => tr(d.categoria, S.lang)).filter(Boolean))].sort();
  const desenhar = () => {
    lista.innerHTML = "";
    const qs = q.toLowerCase();
    const fs = docs.filter(d => (!cat || tr(d.categoria, S.lang) === cat) && (!qs || (tr(d.titulo, S.lang) + " " + tr(d.descricao, S.lang)).toLowerCase().includes(qs)))
      .sort((a, b) => String(b.ano || "").localeCompare(String(a.ano || "")));
    if (!fs.length) lista.append(h("p", { class: "vazio" }, t("doc_vazio")));
    for (const d of fs) {
      const ext = (String(d.ficheiro || "").split("?")[0].split(".").pop() || "").toUpperCase().slice(0, 4);
      lista.append(h("div", { class: "doc" },
        h("div", { class: "doc-ic" }, ext || "DOC"),
        h("div", { class: "doc-txt" }, h("strong", {}, tr(d.titulo, S.lang)), h("p", {}, tr(d.descricao, S.lang)),
          h("small", {}, [tr(d.categoria, S.lang), d.ano].filter(Boolean).join(" · "))),
        d.ficheiro ? h("a", { class: "btn", href: urlFicheiro(d.ficheiro), target: "_blank", rel: "noopener" }, t("abrir")) : null));
    }
  };
  app.append(h("div", { class: "pagina" }, h("h2", {}, t("nav_documentos")),
    h("div", { class: "barra" },
      h("input", { type: "search", placeholder: t("procurar"), oninput: e => { q = e.target.value; desenhar(); } }),
      cats.length ? h("select", { onchange: e => { cat = e.target.value; desenhar(); } }, h("option", { value: "" }, t("todas")), cats.map(c => h("option", { value: c }, c))) : null),
    lista));
  desenhar();
}

function itemIdSurvey(url) {
  const m = /share\/([0-9a-f]{32})/i.exec(url || "") || /[?&](?:itemID|id)=([0-9a-f]{32})/i.exec(url || "");
  return m ? m[1] : "";
}

function renderFichas(app) {
  app.innerHTML = "";
  app.append(h("div", { class: "pagina" }, h("h2", {}, t("nav_fichas")), h("p", {}, t("fichas_intro")),
    h("div", { class: "fichas" }, (S.cfg.fichas || []).map(f => {
      const id = itemIdSurvey(f.survey123);
      return h("div", { class: "ficha" },
        h("div", { class: "ficha-t" }, tr(f.nome, S.lang)),
        h("p", {}, tr(f.descricao, S.lang)),
        f.versao ? h("small", {}, `${t("versao")} ${f.versao}`) : null,
        h("div", { class: "ficha-b" },
          f.survey123 ? h("a", { class: "btn primary", href: f.survey123, target: "_blank", rel: "noopener" }, "↗ " + t("abrir_survey")) : h("span", { class: "nota" }, t("sem_link")),
          id ? h("a", { class: "btn", href: `arcgis-survey123://?itemID=${id}` }, "📱 " + t("abrir_app")) : null,
          f.ficheiro && f.mostrarFicheiro ? h("a", { class: "btn", href: urlFicheiro(f.ficheiro), download: "" }, "⭳ " + t("ficha_xlsx")) : null));
    })),
    h("p", { class: "nota" }, t("fichas_nota"))));
}

/* ---------- Arranque ---------- */
async function iniciar() {
  try {
    [S.cfg, S.choices, S.schema] = await Promise.all([lerJSON("config/portal.json"), lerJSON("config/choices.json"), lerJSON("config/schema.json")]);
  } catch (e) {
    document.body.innerHTML = `<div class="erro-fatal">Não foi possível ler a configuração do portal.<br><small>${esc(e.message)}</small></div>`;
    return;
  }
  S.lang = localStorage.getItem("lang") || "pt";
  try { const a = JSON.parse(sessionStorage.getItem("gh_auth") || "null"); if (a && a.token) S.auth = a; } catch { /* sem sessão */ }
  renderShell();
  recarregarDados();
  window.addEventListener("hashchange", route);
  route();
}

window.addEventListener("error", e => console.error(e.error || e.message));
iniciar();
