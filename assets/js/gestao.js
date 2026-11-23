// Gestão do portal: editor gráfico da configuração, com gravação no GitHub (token pessoal).
import { S, DATASETS, lerArcGIS, rotuloCampo, completarConfig } from "./data.js";
import { UI, VIRTUAIS_CAMPOS } from "./i18n.js";
import { $, h, tr, clone, toast, b64utf8, fileToB64, slug, download, esc, imagem, IMAGENS_PADRAO, IMAGENS_SLOTS } from "./util.js";
import { renderShell, repoPadrao, recarregarDados, modal } from "./main.js";
export { guardar as publicarAlteracoes };

const t = k => UI[S.lang][k] || k;
const L = (pt, en) => (S.lang === "en" ? en : pt);
let W = null, sujo = false, seccao = "geral", paginaSel = 0;

/* ---------------- GitHub ---------------- */
async function gh(caminho, opts = {}) {
  const a = S.auth;
  const base = `https://api.github.com/repos/${encodeURIComponent(a.owner)}/${encodeURIComponent(a.repo)}`;
  let r;
  try {
    r = await fetch(caminho ? `${base}/${caminho}` : base, { ...opts, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${a.token}`, ...(opts.headers || {}) } });
  } catch (e) { throw new Error(L("Não foi possível contactar o GitHub. Verifique a ligação à internet e se algum bloqueador de anúncios ou firewall impede o acesso a api.github.com.", "Could not reach GitHub. Check the internet connection and whether an ad blocker or firewall blocks api.github.com.")); }
  if (r.status === 401) throw new Error(L("Token inválido ou expirado.", "Invalid or expired token."));
  if (!r.ok && r.status !== 404) { let m = "HTTP " + r.status; try { m = (await r.json()).message || m; } catch { /* */ } throw new Error(m); }
  return r.status === 404 ? null : r.json();
}

async function gravarFicheiro(caminho, base64, mensagem) {
  const a = S.auth;
  const atual = await gh(`contents/${encodeURI(caminho)}?ref=${encodeURIComponent(a.branch)}`);
  return gh(`contents/${encodeURI(caminho)}`, { method: "PUT", body: JSON.stringify({ message: mensagem, content: base64, branch: a.branch, ...(atual && atual.sha ? { sha: atual.sha } : {}) }) });
}

async function entrar(owner, repo, branch, token) {
  S.auth = { owner, repo, branch, token };
  try {
    const info = await gh("");
    if (!info) throw new Error(L("Repositório não encontrado. Confirme a conta e o nome do repositório (o token tem de ter acesso a ele).", "Repository not found. Check the account and repository name (the token must have access to it)."));
    if (!info.permissions || !(info.permissions.push || info.permissions.admin)) throw new Error(t("login_erro"));
    try { const u = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()); S.auth.login = u.login || ""; } catch { /* opcional */ }
    sessionStorage.setItem("gh_auth", JSON.stringify(S.auth));
    return true;
  } catch (e) { S.auth = null; sessionStorage.removeItem("gh_auth"); throw e; }
}

/* ---------------- Componentes de formulário ---------------- */
function marcar() {
  if (!W || !S.auth) return;
  sujo = true; S.gestaoSujo = true; S.cfg = W;
  const b = $("#btn-guardar"); if (b) b.classList.add("pulsar");
  const c = $(".adm-cab .linha"); if (c && !$(".adm-pend")) c.prepend(h("span", { class: "adm-pend" }, "● " + L("Alterações por publicar", "Unpublished changes")));
}
function campo(label, obj, chave, opts = {}) {
  const tipo = opts.tipo || "text";
  const inp = opts.area ? h("textarea", { rows: opts.rows || 3 }, obj[chave] ?? "") : h("input", { type: tipo, value: obj[chave] ?? "", step: opts.step });
  if (tipo === "checkbox") { inp.checked = !!obj[chave]; inp.addEventListener("change", () => { obj[chave] = inp.checked; marcar(); opts.depois && opts.depois(); }); }
  else inp.addEventListener("input", () => { obj[chave] = tipo === "number" ? (inp.value === "" ? null : Number(inp.value)) : inp.value; marcar(); opts.depois && opts.depois(); });
  return h("label", { class: "campo" + (tipo === "checkbox" ? " chk" : "") }, tipo === "checkbox" ? [inp, " ", label] : [h("span", {}, label), inp], opts.ajuda ? h("small", {}, opts.ajuda) : null);
}
function bilingue(label, obj, chave, opts = {}) {
  if (!obj[chave] || typeof obj[chave] !== "object") obj[chave] = { pt: obj[chave] || "", en: "" };
  return h("div", { class: "bilingue" }, h("div", { class: "bl" }, label),
    h("div", { class: "duas" }, campo("PT", obj[chave], "pt", opts), campo("EN", obj[chave], "en", opts)));
}
function escolha(label, obj, chave, opcoes, opts = {}) {
  const sel = h("select", { onchange: e => { obj[chave] = e.target.value === "" ? undefined : e.target.value; if (obj[chave] === undefined) delete obj[chave]; marcar(); opts.depois && opts.depois(); } },
    opcoes.map(([v, l]) => h("option", { value: v, selected: String(obj[chave] ?? "") === String(v) }, l)));
  return h("label", { class: "campo" }, h("span", {}, label), sel, opts.ajuda ? h("small", {}, opts.ajuda) : null);
}
function carregar(label, obj, chave, pasta, opts = {}) {
  const prev = opts.imagem ? h("img", { class: "prev-img", src: obj[chave] || "" }) : null;
  const inpUrl = h("input", { type: "text", value: obj[chave] || "", oninput: e => { obj[chave] = e.target.value; marcar(); if (prev) prev.src = e.target.value; } });
  const ficheiro = h("input", { type: "file", accept: opts.accept || "", style: "display:none", onchange: async e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 25 * 1024 * 1024) { toast(L("Ficheiro maior que 25 MB.", "File larger than 25 MB."), "erro"); return; }
    const ext = f.name.includes(".") ? f.name.split(".").pop().toLowerCase() : "";
    const nome = `${pasta}/${slug(f.name.replace(/\.[^.]+$/, ""))}${ext ? "." + ext : ""}`;
    try {
      toast(L("A enviar ", "Uploading ") + f.name + "…");
      await gravarFicheiro(nome, await fileToB64(f), `Portal: carregar ${nome}`);
      obj[chave] = nome; inpUrl.value = nome; if (prev) prev.src = URL.createObjectURL(f); marcar();
      toast(L("Ficheiro enviado. Grave as alterações para o publicar.", "File uploaded. Save the changes to publish it."), "ok");
    } catch (err) { toast(err.message, "erro", 8000); }
  } });
  return h("div", { class: "campo" }, h("span", {}, label), prev, h("div", { class: "linha" }, inpUrl, ficheiro,
    h("button", { class: "btn", type: "button", onclick: () => ficheiro.click() }, "⭱ " + L("Carregar ficheiro", "Upload file"))),
    h("small", {}, opts.ajuda || L("Carregue um ficheiro ou cole uma ligação (https://…).", "Upload a file or paste a link (https://…).")));
}
function campoLista(label, arr, definir, ajuda) {
  const inp = h("input", { type: "text", value: (arr || []).map(x => (typeof x === "string" ? x : x.campo)).join(", "),
    oninput: e => { definir(e.target.value.split(",").map(x => x.trim()).filter(Boolean)); marcar(); } });
  return h("label", { class: "campo" }, h("span", {}, label), inp, ajuda ? h("small", {}, ajuda) : null);
}
function editorLista(arr, novo, desenharItem, titulo) {
  const box = h("div", { class: "lista-ed" });
  const desenhar = () => {
    box.innerHTML = "";
    arr.forEach((it, i) => {
      const cab = h("div", { class: "item-cab" }, h("strong", {}, `${i + 1}. ${titulo(it) || "—"}`),
        h("span", {},
          h("button", { class: "btn mini", title: "↑", disabled: i === 0, onclick: () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; marcar(); desenhar(); } }, "↑"),
          h("button", { class: "btn mini", title: "↓", disabled: i === arr.length - 1, onclick: () => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; marcar(); desenhar(); } }, "↓"),
          h("button", { class: "btn mini perigo", onclick: () => { if (confirm(L("Remover este item?", "Remove this item?"))) { arr.splice(i, 1); marcar(); desenhar(); } } }, "✕")));
      const corpo = h("div", { class: "item-corpo" });
      const det = h("details", { class: "item" }, h("summary", {}, cab), corpo);
      det.addEventListener("toggle", () => { if (det.open && !corpo.childNodes.length) desenharItem(it, corpo); });
      box.append(det);
    });
    box.append(h("button", { class: "btn", onclick: () => { arr.push(novo()); marcar(); desenhar(); box.lastElementChild.previousElementSibling.open = true; } }, "+ " + t("adicionar")));
  };
  desenhar();
  return box;
}

/* ---------------- Opções de campos ---------------- */
const MEDIDAS = () => [["contagem", L("Contagem de registos", "Record count")], ["soma", L("Soma de um campo", "Sum of a field")], ["media", L("Média de um campo", "Average of a field")],
  ["razao", L("Razão campo ÷ campo 2", "Ratio field ÷ field 2")], ["percentagem", L("Percentagem que cumpre o filtro (indicadores)", "Share meeting the filter (indicators)")],
  ["percentagem_registos", L("% dos registos com cada categoria (gráficos)", "% of records with each category (charts)")], ["distintos", L("Nº de valores diferentes", "Number of distinct values")],
  ["especial", L("Especial (levantamento ecológico)", "Special (ecological survey)")]];
const TIPOS = () => [["barras", L("Barras verticais", "Vertical bars")], ["barrash", L("Barras horizontais", "Horizontal bars")], ["empilhado", L("Barras empilhadas", "Stacked bars")],
  ["pizza", L("Anel (pizza)", "Donut")], ["linha", L("Linha", "Line")], ["area", L("Área (linha preenchida)", "Area (filled line)")],
  ["treemap", L("Mosaico (treemap)", "Treemap")], ["sankey", L("Fluxo (sankey): categorias → divisão", "Flow (sankey): categories → split")], ["gauge", L("Medidor (um só valor)", "Gauge (single value)")], ["mapa", L("Mapa", "Map")], ["tabela", L("Tabela de registos", "Record table")],
  ["cobertura", L("Registos por província", "Records by province")], ["texto", L("Texto", "Text")], ["imagem", L("Imagem", "Image")]];
const ICONES_OPS = () => [["lista", L("Lista", "List")], ["mapa", L("Mapa", "Map")], ["alerta", L("Alerta", "Alert")], ["folha", L("Folha", "Leaf")], ["muda", L("Muda", "Seedling")],
  ["viveiro", L("Viveiro", "Nursery")], ["grelha", L("Grelha", "Grid")], ["onda", L("Onda", "Wave")], ["pessoas", L("Pessoas", "People")], ["dinheiro", L("Dinheiro", "Money")], ["pct", "%"], ["arvore", L("Árvore", "Tree")]];
const LARGURAS = [["1/3", "1/3"], ["1/2", "1/2"], ["2/3", "2/3"], ["1", L("Linha inteira", "Full row")]];
const ORDENS = () => [["valor", L("Pelo valor (maior primeiro)", "By value (largest first)")], ["lista", L("Ordem da lista da ficha", "Form list order")],
  ["provincias", L("Províncias de norte para sul", "Provinces north to south")], ["cronologica", L("Cronológica", "Chronological")], ["alfabetica", L("Alfabética", "Alphabetical")]];
const dsOps = () => DATASETS.map(d => [d, tr(W.fontes.datasets[d].nome, S.lang)]);
function tabOps(ds) { return Object.keys((S.schema[ds] || { tables: { main: {} } }).tables).map(tb => [tb, tb === "main" ? L("Principal", "Main") : tb]); }
function campoOps(ds, tab, vazio = true) {
  const sc = S.schema[ds]; const ops = vazio ? [["", "—"]] : [];
  if (!sc) return ops;
  let t2 = tab || "main"; const vistos = new Set();
  while (t2 && sc.tables[t2]) {
    for (const [c, f] of Object.entries(sc.tables[t2].fields)) if (!vistos.has(c)) { vistos.add(c); ops.push([c, `${f.label} (${c})${t2 !== tab ? " ↑" : ""}`]); }
    t2 = sc.tables[t2].parent || (t2 !== "main" ? "main" : null);
  }
  for (const [c, v] of Object.entries(VIRTUAIS_CAMPOS)) ops.push([c, `★ ${tr(v, S.lang)} (${c})`]);
  return ops;
}
function datasCampos(ds) {
  const sc = S.schema[ds]; const ops = [["", L("Data de criação do registo", "Record creation date")]];
  if (!sc) return ops;
  for (const [tb, T] of Object.entries(sc.tables)) for (const [c, f] of Object.entries(T.fields)) if (f.type === "date" || f.type === "datetime") ops.push([tb === "main" ? c : `${tb}.${c}`, `${f.label} (${tb === "main" ? c : tb + "." + c})`]);
  return ops;
}

/* ---------------- Ecrãs ---------------- */
const MENU = () => [
  ["resumo", L("Resumo", "Overview"), "mapa"], ["geral", L("Geral e logótipos", "General and logos"), "folha"], ["sobre", t("nav_sobre"), "lista"], ["imagens", L("Imagens de fundo", "Background images"), "onda"],
  ["documentos", t("nav_documentos"), "lista", () => (W.documentos || []).length], ["fichas", t("nav_fichas"), "muda", () => (W.fichas || []).length],
  ["fontes", L("Fontes de dados", "Data sources"), "grelha", () => `${DATASETS.filter(d => W.fontes.datasets[d] && W.fontes.datasets[d].url).length}/${DATASETS.length}`],
  ["dashboard", t("nav_dashboard"), "pct", () => (W.dashboard.paginas || []).length], ["tecnica", t("nav_tecnica"), "arvore", () => ((W.tecnica || {}).paineis || []).length],
  ["validacao", t("tec_validacao"), "alerta"], ["acesso", L("Privacidade e acesso", "Privacy and access"), "pessoas"], ["backup", L("Cópia de segurança", "Backup"), "dinheiro"]
];
const TITULOS = () => ({ resumo: [L("Bem-vindo à gestão do portal", "Welcome to portal management"), L("Escolha o que quer alterar. Nada fica público até carregar em “Publicar alterações”.", "Choose what to change. Nothing goes public until you click “Publish changes”.")],
  publicar: [L("Publicar", "Publish"), L("Torne públicas as alterações feitas nesta sessão.", "Make the changes from this session public.")],
  github: [L("Ligação GitHub", "GitHub connection"), L("Repositório onde o portal está guardado.", "Repository where the portal is stored.")] });

let iconeFn = null;
function ic(nome) { return iconeFn ? iconeFn(nome, "ic") : h("span"); }

export async function renderGestao(app) {
  if (!iconeFn) { try { iconeFn = (await import("./dash.js")).icone; } catch { /* sem ícones */ } }
  app.innerHTML = "";
  document.body.classList.add("modo-gestao");
  if (!S.auth) return renderLogin(app);
  if (!W) W = S.cfg;
  S.gestaoSujo = sujo;
  const menu = MENU();
  const tit = TITULOS()[seccao] || [ (menu.find(m => m[0] === seccao) || [, ""])[1], "" ];
  const conteudo = h("div", { class: "adm-conteudo" });
  const item = (k, label, icn, cont) => h("a", { class: "adm-item" + (seccao === k ? " active" : ""), onclick: () => { seccao = k; renderGestao(app); } },
    ic(icn), h("span", {}, label), cont !== undefined && cont !== null ? h("b", { class: "adm-cont" }, String(cont)) : null);
  app.append(h("div", { class: "adm" },
    h("aside", { class: "adm-lado" },
      h("div", { class: "adm-marca" }, h("img", { src: W.portal.logoInom, alt: "InOM" }), h("span", {}, L("GESTÃO DO PORTAL", "PORTAL MANAGEMENT"))),
      h("nav", { class: "adm-menu" }, menu.map(([k, l, icn, c]) => item(k, l, icn, c ? c() : null)),
        h("hr"), item("publicar", L("Publicar", "Publish"), "folha", sujo ? "•" : null), item("github", L("Ligação GitHub", "GitHub connection"), "pessoas")),
      h("div", { class: "adm-rodape" },
        h("div", { class: "adm-estado" }, L("Ligado a ", "Connected to "), h("strong", {}, `${S.auth.owner}/${S.auth.repo}`), ` (${S.auth.branch})`),
        h("a", { href: "#/sobre", class: "adm-site", onclick: () => document.body.classList.remove("modo-gestao") }, L("Abrir o site ↗", "Open the site ↗")))),
    h("section", { class: "adm-main" },
      h("header", { class: "adm-cab" },
        h("div", {}, h("h1", {}, tit[0]), tit[1] ? h("p", {}, tit[1]) : null),
        h("div", { class: "linha" },
          sujo ? h("span", { class: "adm-pend" }, "● " + L("Alterações por publicar", "Unpublished changes")) : null,
          h("button", { class: "btn adm-btn", onclick: preVisualizar }, L("Pré-visualizar", "Preview")),
          h("button", { id: "btn-guardar", class: "btn adm-pub" + (sujo ? " pulsar" : ""), onclick: guardar }, L("Publicar alterações", "Publish changes")))),
      conteudo)));
  const secs = { resumo: secResumo, publicar: secPublicar, github: secGithub, geral: secGeral, sobre: secSobre, imagens: secImagens, documentos: secDocumentos, fichas: secFichas, fontes: secFontes, dashboard: secDashboard, tecnica: secTecnica, validacao: secValidacao, acesso: secAcesso, backup: secBackup };
  (secs[seccao] || secResumo)(conteudo);
}

function preVisualizar() { S.preview = true; S.cfg = W; document.body.classList.remove("modo-gestao"); location.hash = "#/sobre"; }

function secResumo(el) {
  const fontes = DATASETS.filter(d => W.fontes.datasets[d] && W.fontes.datasets[d].url).length;
  const cartoes = [[(W.dashboard.paginas || []).length, L("páginas do dashboard", "dashboard pages"), "dashboard"], [(W.documentos || []).length, L("documentos", "documents"), "documentos"],
    [(W.fichas || []).length, L("fichas de campo", "field forms"), "fichas"], [`${fontes}/${DATASETS.length}`, L("fontes de dados ligadas", "data sources connected"), "fontes"]];
  el.append(h("div", { class: "adm-cartoes" }, cartoes.map(([n, l, k]) => h("a", { class: "adm-cartao", onclick: () => { seccao = k; renderGestao($("#app")); } }, h("strong", {}, String(n)), h("span", {}, l)))));
  const passos = [L("Faça as alterações nas secções do menu à esquerda: textos (em português e inglês), logótipos, documentos, fichas, fontes de dados e gráficos.", "Make changes in the sections of the left menu: texts (Portuguese and English), logos, documents, forms, data sources and charts."),
    L("Use “Pré-visualizar” para ver o portal com as alterações antes de as tornar públicas.", "Use “Preview” to see the portal with your changes before making them public."),
    L("Carregue em “Publicar alterações”. O site é actualizado em 1 a 2 minutos.", "Click “Publish changes”. The site updates in 1 to 2 minutes."),
    L(`Está ligado ao GitHub (${S.auth.owner}/${S.auth.repo}). Pode publicar.`, `Connected to GitHub (${S.auth.owner}/${S.auth.repo}). You can publish.`)];
  el.append(h("div", { class: "adm-caixa" }, h("h3", {}, L("Como funciona", "How it works")), h("ol", { class: "adm-passos" }, passos.map(p => h("li", {}, p)))));
  if (fontes < DATASETS.length && W.fontes.modoDemo) el.append(h("div", { class: "adm-caixa aviso" }, h("strong", {}, L("Dados de demonstração activos. ", "Demo data active. ")),
    L("Ligue os Feature Services em ", "Connect the Feature Services in "), h("a", { onclick: () => { seccao = "fontes"; renderGestao($("#app")); } }, L("Fontes de dados", "Data sources")), "."));
}

function secPublicar(el) {
  el.append(h("div", { class: "adm-caixa" },
    h("h3", {}, sujo ? L("Há alterações por publicar", "There are unpublished changes") : L("Tudo publicado", "Everything is published")),
    h("p", {}, sujo ? L("As alterações só estão neste navegador. Publique para as tornar visíveis a todos.", "Changes are only in this browser. Publish to make them visible to everyone.") : L("Não há alterações pendentes nesta sessão.", "No pending changes in this session.")),
    h("div", { class: "linha" }, h("button", { class: "btn adm-pub", disabled: !sujo, onclick: guardar }, L("Publicar alterações", "Publish changes")),
      h("button", { class: "btn", disabled: !sujo, onclick: descartar }, L("Descartar alterações", "Discard changes")))));
  const hist = h("div", { class: "adm-caixa" }, h("h3", {}, L("Últimas publicações", "Latest publications")), h("p", { class: "nota" }, t("carregando")));
  el.append(hist);
  gh(`commits?path=config/portal.json&sha=${encodeURIComponent(S.auth.branch)}&per_page=10`).then(cs => {
    hist.lastChild.remove();
    hist.append(h("table", { class: "tabela" }, h("tbody", {}, (cs || []).map(c => h("tr", {}, h("td", {}, new Date(c.commit.author.date).toLocaleString(S.lang === "en" ? "en-GB" : "pt-PT")),
      h("td", {}, c.commit.author.name), h("td", {}, c.commit.message.split("\n")[0]), h("td", {}, h("a", { href: c.html_url, target: "_blank", rel: "noopener" }, c.sha.slice(0, 7))))))),
      h("p", { class: "nota" }, L("Para reverter uma publicação, abra-a no GitHub e use “Revert”, ou reponha uma cópia em Cópia de segurança.", "To undo a publication, open it on GitHub and use “Revert”, or restore a copy in Backup.")));
  }).catch(e => { hist.lastChild.textContent = e.message; });
}

function secGithub(el) {
  const a = S.auth;
  el.append(h("div", { class: "adm-caixa" },
    h("table", { class: "tabela mini" }, h("tbody", {},
      [[L("Conta", "Account"), a.login ? "@" + a.login : "—"], [L("Repositório", "Repository"), `${a.owner}/${a.repo}`], [L("Ramo", "Branch"), a.branch]].map(([k, v]) => h("tr", {}, h("td", {}, k), h("td", {}, h("strong", {}, v)))))),
    h("div", { class: "linha", style: "margin-top:.8rem" },
      h("a", { class: "btn", href: `https://github.com/${a.owner}/${a.repo}`, target: "_blank", rel: "noopener" }, L("Abrir o repositório ↗", "Open the repository ↗")),
      h("button", { class: "btn perigo", onclick: sair }, t("login_sair"))),
    h("p", { class: "nota" }, L("O token fica só neste separador do navegador e é apagado quando o fecha. Quando expirar, crie um novo no GitHub.", "The token stays only in this browser tab and is removed when you close it. When it expires, create a new one on GitHub."))));
}

function renderLogin(app) {
  const def = repoPadrao();
  const st = { owner: def.owner, repo: def.repo, branch: def.branch, token: "" };
  const erro = h("p", { class: "erro-txt" });
  const btn = h("button", { class: "btn adm-pub largo", onclick: async () => {
    erro.textContent = ""; btn.disabled = true; btn.textContent = L("A verificar…", "Checking…");
    try { await entrar(st.owner.trim(), st.repo.trim(), st.branch.trim() || "main", st.token.replace(/\s+/g, "")); seccao = "resumo"; renderGestao(app); }
    catch (err) { erro.textContent = err.message || t("login_erro"); }
    finally { btn.disabled = false; btn.textContent = t("login_entrar"); }
  } }, t("login_entrar"));
  const imL = imagem(S.cfg, "hero");
  app.append(h("div", { class: "adm-login" + (imL ? " com-img" : ""), style: imL ? `--img:url("${String(imL.url).replace(/"/g, "%22")}")` : undefined }, h("div", { class: "adm-login-caixa" },
    h("div", { class: "adm-marca" }, h("img", { src: S.cfg.portal.logoInom, alt: "InOM" }), h("span", {}, L("GESTÃO DO PORTAL", "PORTAL MANAGEMENT"))),
    h("h1", {}, t("login_titulo")), h("p", {}, t("login_intro")),
    h("div", { class: "duas" }, campo(t("login_owner"), st, "owner"), campo(t("login_repo"), st, "repo")),
    campo(t("login_branch"), st, "branch"),
    campo(t("login_token"), st, "token", { tipo: "password" }),
    h("p", { class: "nota" }, t("login_ajuda")), erro, btn,
    h("a", { class: "adm-site", href: "#/sobre", onclick: () => document.body.classList.remove("modo-gestao") }, "← " + L("Voltar ao portal", "Back to the portal")))));
  sujo = false;
}

async function guardar() {
  try {
    W.versao = (W.versao || 1);
    await gravarFicheiro("config/portal.json", b64utf8(JSON.stringify(W, null, 1)), `Portal: actualização da configuração (${new Date().toISOString().slice(0, 16)})`);
    sujo = false; S.gestaoSujo = false; S.preview = false; if (location.hash.startsWith("#/gestao")) renderGestao($("#app"));
    toast(L("Guardado no GitHub. O site público actualiza em 1 a 2 minutos.", "Saved to GitHub. The public site updates in 1 to 2 minutes."), "ok", 6000);
  } catch (e) { toast(L("Erro ao guardar: ", "Save error: ") + e.message, "erro", 10000); }
}
async function descartar() {
  if (!confirm(L("Descartar todas as alterações não guardadas?", "Discard all unsaved changes?"))) return;
  const r = await fetch("config/portal.json?v=" + Date.now()); W = completarConfig(await r.json()); S.cfg = W; sujo = false; S.gestaoSujo = false; S.preview = false; renderShell(); renderGestao($("#app"));
}
function sair() { if (sujo && !confirm(L("Há alterações não guardadas. Sair mesmo assim?", "There are unsaved changes. Sign out anyway?"))) return; S.auth = null; sessionStorage.removeItem("gh_auth"); W = null; sujo = false; renderGestao($("#app")); }
window.addEventListener("beforeunload", e => { if (sujo) { e.preventDefault(); e.returnValue = ""; } });

/* ---------------- Secções ---------------- */
function titulo(el, pt, en, ajuda) { el.append(h("h3", {}, L(pt, en)), ajuda ? h("p", { class: "nota" }, ajuda) : null); }

function secGeral(el) {
  const p = W.portal, actualizar = () => renderShell();
  titulo(el, "Geral e logótipos", "General and logos");
  el.append(bilingue(L("Nome do portal", "Portal name"), p, "nome", { depois: actualizar }), bilingue(L("Subtítulo", "Subtitle"), p, "subtitulo", { depois: actualizar }),
    h("div", { class: "tres" }, campo(L("Cor principal", "Main colour"), p, "corPrimaria", { tipo: "color", depois: actualizar }),
      campo(L("Cor secundária", "Secondary colour"), p, "corSecundaria", { tipo: "color", depois: actualizar }), campo(L("Cor de destaque", "Accent colour"), p, "corDestaque", { tipo: "color", depois: actualizar })),
    carregar(L("Logótipo do InOM (cabeçalho e relatório PDF)", "InOM logo (header and PDF report)"), p, "logoInom", "assets/img", { imagem: true, accept: "image/*", ajuda: L("PNG ou SVG com fundo transparente. Aparece à esquerda no cabeçalho.", "PNG or SVG with transparent background. Shown on the left of the header.") }),
    carregar(L("Logótipo de apoio (rodapé)", "Support logo (footer)"), p, "logoApoio", "assets/img", { imagem: true, accept: "image/*" }),
    campo(L("Nome da entidade de apoio", "Supporting entity name"), p, "nomeApoio", { depois: actualizar }),
    bilingue(L("Texto junto ao logótipo de apoio", "Text next to support logo"), p, "textoApoio", { depois: actualizar }),
    bilingue(L("Texto do rodapé", "Footer text"), p, "rodape", { depois: actualizar }),
    campo(L("E-mail de contacto (opcional)", "Contact e-mail (optional)"), p, "contacto", { tipo: "email", depois: actualizar }));
}

/* Reduz a foto no navegador (máx. 1920 px, JPEG) para o site carregar depressa. */
function reduzirImagem(f, max = 1920) {
  return new Promise((ok, falha) => {
    const img = new Image(); const u = URL.createObjectURL(f);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas"); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(u);
      ok(cv.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => falha(new Error(L("Não foi possível ler a imagem.", "Could not read the image.")));
    img.src = u;
  });
}

function secImagens(el) {
  const p = W.portal; p.imagens = p.imagens || {};
  const I = p.imagens;
  titulo(el, "Imagens de fundo", "Background images", L("Fotografias de mangal e ervas marinhas usadas no topo da página Sobre, nos cartões dos ecossistemas, no cabeçalho de cada página do dashboard e no ecrã de entrada da gestão. Por omissão usam-se fotos livres do Wikimedia Commons; pode carregar fotos próprias (são reduzidas automaticamente).",
    "Mangrove and seagrass photos used at the top of the About page, on the ecosystem cards, in each dashboard page header and on the management sign-in screen. By default free photos from Wikimedia Commons are used; you can upload your own (they are resized automatically)."));
  el.append(campo(L("Mostrar imagens de fundo", "Show background images"), { get v() { return I.mostrar !== false; }, set v(x) { I.mostrar = x; } }, "v", { tipo: "checkbox", depois: () => renderShell() }));
  const NOMES = { hero: [L("Principal (topo da página Sobre e entrada da gestão)", "Main (top of the About page and sign-in)"), L("Visão geral, Sobre os dados", "Overview, About the data")],
    mangal: [L("Mangal", "Mangroves"), L("Cartão Mangal e páginas de mangal do dashboard", "Mangrove card and mangrove dashboard pages")],
    ervas: [L("Ervas marinhas", "Seagrasses"), L("Cartão Ervas marinhas e página de ervas do dashboard", "Seagrass card and seagrass dashboard page")] };
  for (const k of IMAGENS_SLOTS) {
    const caixa = h("div", { class: "adm-caixa img-slot" });
    const desenhar = () => {
      caixa.innerHTML = "";
      const atual = { ...IMAGENS_PADRAO[k], ...(I[k] || {}) };
      const proprio = !!(I[k] && I[k].url);
      const prev = h("div", { class: "img-prev", style: `background-image:url("${String(atual.url || "").replace(/"/g, "%22")}")` }, h("span", {}, proprio ? L("Foto própria", "Own photo") : L("Foto padrão", "Default photo")));
      const ficheiro = h("input", { type: "file", accept: "image/*", style: "display:none", onchange: async e => {
        const f = e.target.files[0]; if (!f) return;
        try {
          toast(L("A preparar e enviar a foto…", "Preparing and uploading the photo…"));
          const dataUrl = await reduzirImagem(f);
          const nome = `assets/img/fundo-${k}-${Date.now().toString(36)}.jpg`;
          await gravarFicheiro(nome, dataUrl.split(",")[1], `Portal: imagem de fundo ${k}`);
          I[k] = { url: nome, credito: { pt: "", en: "" }, link: "" }; marcar(); desenhar();
          caixa.querySelector(".img-prev").style.backgroundImage = `url("${dataUrl}")`; // o site só mostra o ficheiro novo após publicar
          toast(L("Foto enviada. Escreva o crédito e clique em Publicar alterações.", "Photo uploaded. Add the credit and click Publish changes."), "ok", 6000);
        } catch (err) { toast(err.message, "erro", 8000); }
      } });
      I[k] = I[k] || {};
      caixa.append(h("div", { class: "img-cab" }, h("div", {}, h("strong", {}, NOMES[k][0]), h("small", {}, NOMES[k][1]))), prev,
        h("div", { class: "linha" }, ficheiro, h("button", { class: "btn", onclick: () => ficheiro.click() }, "⭱ " + L("Carregar foto", "Upload photo")),
          proprio ? h("button", { class: "btn claro", onclick: () => { delete I[k]; marcar(); desenhar(); } }, "↺ " + L("Voltar à foto padrão", "Back to default photo")) : null),
        proprio ? h("div", {}, campo(L("Endereço da imagem", "Image address"), I[k], "url", { depois: () => { prev.style.backgroundImage = `url("${I[k].url}")`; } }),
          bilingue(L("Crédito (autor da foto, local)", "Credit (photographer, place)"), I[k], "credito")) : h("p", { class: "nota" }, "📷 " + tr(atual.credito, S.lang)));
    };
    desenhar(); el.append(caixa);
  }
}

/* Carrega uma imagem e acrescenta-a ao fim do texto (PT e EN) em Markdown. */
function inserirImagem(obj, chave, depois) {
  const ficheiro = h("input", { type: "file", accept: "image/*", style: "display:none", onchange: async e => {
    const f = e.target.files[0]; if (!f) return;
    const ext = f.name.includes(".") ? f.name.split(".").pop().toLowerCase() : "jpg";
    const nome = `assets/img/${slug(f.name.replace(/\.[^.]+$/, ""))}.${ext}`;
    try {
      toast(L("A enviar ", "Uploading ") + f.name + "…");
      await gravarFicheiro(nome, await fileToB64(f), `Portal: imagem ${nome}`);
      if (typeof obj[chave] !== "object" || obj[chave] === null) obj[chave] = { pt: obj[chave] || "", en: "" };
      for (const l of ["pt", "en"]) obj[chave][l] = `${obj[chave][l] || ""}\n\n![${f.name.replace(/\.[^.]+$/, "")}](${nome})\n`;
      marcar(); if (depois) depois(); else renderGestao($("#app"));
      toast(L("Imagem inserida no fim do texto. Pode mover a linha ![…](…) para onde quiser.", "Image added at the end of the text. You can move the ![…](…) line anywhere."), "ok", 7000);
    } catch (err) { toast(err.message, "erro", 8000); }
  } });
  return h("div", { class: "linha" }, ficheiro, h("button", { class: "btn", type: "button", onclick: () => ficheiro.click() }, "🖼 " + L("Inserir imagem no texto", "Insert image in the text")));
}

function secSobre(el) {
  titulo(el, "Página Sobre", "About page", L("Escreva em texto simples. Formatação: ## Título, **negrito**, *itálico*, - lista, [texto](https://ligação).", "Write plain text. Formatting: ## Heading, **bold**, *italic*, - list, [text](https://link)."));
  if (typeof W.sobre !== "object") W.sobre = { pt: W.sobre || "", en: "" };
  el.append(inserirImagem(W, "sobre"));
  for (const l of ["pt", "en"]) {
    const prev = h("div", { class: "md preview", html: window.marked ? window.marked.parse(W.sobre[l] || "") : "" });
    const ta = h("textarea", { rows: 18, oninput: e => { W.sobre[l] = e.target.value; marcar(); prev.innerHTML = window.marked ? window.marked.parse(e.target.value) : esc(e.target.value); } }, W.sobre[l] || "");
    el.append(h("h4", {}, l === "pt" ? "Português" : "English"), h("div", { class: "duas" }, ta, prev));
  }
}

function secDocumentos(el) {
  titulo(el, "Documentos", "Documents", L("Relatórios, guias e outros ficheiros de referência. Pode carregar o ficheiro (fica no repositório, pasta docs) ou colar uma ligação externa.", "Reports, guides and other reference files. Upload the file (stored in the repository, docs folder) or paste an external link."));
  W.documentos = W.documentos || [];
  el.append(editorLista(W.documentos, () => ({ titulo: { pt: L("Novo documento", "New document"), en: "" }, descricao: { pt: "", en: "" }, categoria: { pt: "", en: "" }, ano: String(new Date().getFullYear()), ficheiro: "" }),
    (d, c) => c.append(bilingue(L("Título", "Title"), d, "titulo"), bilingue(L("Descrição", "Description"), d, "descricao", { area: true }),
      h("div", { class: "duas" }, bilingue(t("categoria"), d, "categoria"), campo(t("ano"), d, "ano")),
      carregar(L("Ficheiro", "File"), d, "ficheiro", "docs")), d => tr(d.titulo, S.lang)));
}

function secFichas(el) {
  titulo(el, "Fichas de campo", "Field forms", L("Cole a ligação de cada formulário Survey123. O ficheiro XLSForm fica guardado como referência e só aparece para descarregar se marcar a opção.", "Paste each Survey123 form link. The XLSForm file is kept for reference and is only shown for download if you tick the option."));
  W.fichas = W.fichas || [];
  el.append(editorLista(W.fichas, () => ({ id: "", nome: { pt: L("Nova ficha", "New form"), en: "" }, descricao: { pt: "", en: "" }, versao: "1.0", ficheiro: "", survey123: "" }),
    (f, c) => c.append(bilingue(L("Nome", "Name"), f, "nome"), bilingue(L("Descrição", "Description"), f, "descricao", { area: true }), campo(t("versao"), f, "versao"),
      campo(L("Ligação do formulário Survey123", "Survey123 form link"), f, "survey123", { ajuda: L("No Survey123, abra o formulário › Colaborar › copie a ligação (https://survey123.arcgis.com/share/…). O botão da app aparece automaticamente.", "In Survey123, open the form › Collaborate › copy the link (https://survey123.arcgis.com/share/…). The app button appears automatically.") }),
      carregar(L("Ficheiro XLSForm (.xlsx)", "XLSForm file (.xlsx)"), f, "ficheiro", "fichas", { accept: ".xlsx,.xls" }),
      campo(L("Mostrar também o botão para descarregar o ficheiro XLSForm", "Also show the button to download the XLSForm file"), f, "mostrarFicheiro", { tipo: "checkbox" })), f => tr(f.nome, S.lang)));
}

function secFontes(el) {
  titulo(el, "Fontes de dados", "Data sources", L("Para cada ficha, cole o URL do Feature Service (termina em /FeatureServer). O portal lê sozinho a camada principal e TODAS as tabelas das repetições da ficha. Enquanto uma ficha não tiver URL, o portal mostra dados de demonstração. As camadas têm de estar partilhadas publicamente (de preferência uma vista sem dados pessoais).",
    "For each form, paste the Feature Service URL (ends in /FeatureServer). The portal reads the main layer and ALL the repeat tables by itself. Until a form has a URL, the portal shows demo data. Layers must be shared publicly (ideally a view without personal data)."));
  el.append(campo(L("Usar dados de demonstração nas fichas sem URL", "Use demo data for forms without a URL"), W.fontes, "modoDemo", { tipo: "checkbox" }),
    h("button", { class: "btn", onclick: async () => { await recarregarDados(); toast(L("Dados recarregados.", "Data reloaded."), "ok"); } }, "↻ " + L("Recarregar dados com estas definições", "Reload data with these settings")));
  for (const ds of DATASETS) {
    const c = W.fontes.datasets[ds]; if (!c) continue;
    c.tabelas = c.tabelas || {};
    const sc = S.schema[ds];
    const esperadas = sc ? Object.keys(sc.tables) : ["main"];
    const res = h("div", { class: "res" });
    const quadro = h("div", { class: "sub" });
    const desenharQuadro = (raw, erro) => {
      quadro.innerHTML = "";
      const nomesServ = raw ? raw.meta.servico.map(i => i.nome) : [];
      quadro.append(h("small", {}, L("Tabelas da ficha e onde o portal as encontrou. Só precisa de mexer numa linha se ela aparecer com ✗ (tabela com outro nome ou noutro serviço).",
        "Form tables and where the portal found them. Only change a row if it shows ✗ (table with another name or in another service).")));
      const tb = h("table", { class: "tabela mapa-tabelas" }, h("thead", {}, h("tr", {}, h("th", {}, L("Tabela da ficha", "Form table")), h("th", {}, L("Registos", "Records")),
        h("th", {}, L("Nome no serviço (se for diferente)", "Name in the service (if different)")), h("th", {}, L("Ou URL próprio (outro serviço)", "Or its own URL (another service)")))));
      const corpo = h("tbody");
      for (const t of esperadas) {
        const m = c.tabelas[t] = c.tabelas[t] || {};
        const n = raw ? (t === "main" ? raw.main.length : (raw.tables[t] ? raw.tables[t].length : null)) : null;
        const rot = t === "main" ? L("Principal", "Main") + (raw && raw.meta.principal ? ` (${raw.meta.principal.nome})` : "") : (sc.tables[t].label ? `${t} · ${sc.tables[t].label}` : t);
        const estado = !raw ? "—" : n === null ? h("span", { class: "erro-txt" }, "✗ " + L("não encontrada", "not found")) : h("span", { class: "ok-txt" }, `✓ ${n}`);
        const sel = t === "main"
          ? escolha("", c, "camadaPrincipal", [["", L("Automática (camada 0)", "Automatic (layer 0)")], ...(raw ? raw.meta.servico.map(i => [String(i.id), `${i.id} · ${i.nome}`]) : (c.camadaPrincipal !== undefined && c.camadaPrincipal !== "" ? [[String(c.camadaPrincipal), String(c.camadaPrincipal)]] : []))])
          : h("select", { onchange: e => { m.nome = e.target.value || undefined; if (!m.nome) delete m.nome; marcar(); } },
              h("option", { value: "" }, L("Automático (mesmo nome)", "Automatic (same name)")),
              [...new Set([...(nomesServ || []), ...(m.nome ? [m.nome] : [])])].map(x => h("option", { value: x, selected: m.nome === x }, x)));
        const url = t === "main" ? h("span", { class: "nota" }, "—") : h("input", { type: "text", placeholder: "https://…/FeatureServer/1", value: m.url || "", oninput: e => { m.url = e.target.value.trim() || undefined; if (!m.url) delete m.url; marcar(); } });
        corpo.append(h("tr", {}, h("td", {}, rot), h("td", {}, estado), h("td", {}, sel), h("td", {}, url)));
      }
      tb.append(corpo); quadro.append(tb);
      if (raw) {
        const sobra = Object.keys(raw.tables).filter(k => !esperadas.includes(k));
        if (sobra.length) quadro.append(h("small", {}, L("No serviço mas não na ficha (ignoradas): ", "In the service but not in the form (ignored): ") + sobra.join(", ")));
      }
      if (erro) quadro.append(h("p", { class: "erro-txt" }, "✗ " + erro));
    };
    const testar = async () => {
      if (!c.url) { res.textContent = L("Cole primeiro o URL.", "Paste the URL first."); return; }
      res.textContent = L("A ler o serviço…", "Reading the service…"); res.className = "res";
      try { const raw = await lerArcGIS(c, ds); res.textContent = "✓ " + L("Ligação a funcionar", "Connection working"); res.className = "res ok"; desenharQuadro(raw); }
      catch (e) { res.textContent = ""; desenharQuadro(null, e.message); }
    };
    desenharQuadro(null);
    el.append(h("details", { class: "item", open: !c.url && ds !== "poligonos" }, h("summary", {}, h("strong", {}, tr(c.nome, S.lang)), " ", h("span", { class: "tag " + (c.url ? "ok" : "vazio") }, c.url ? t("fonte_ok") : L("dados de demonstração", "demo data"))),
      h("div", { class: "item-corpo" },
        ds === "poligonos" ? h("p", { class: "nota" }, L("Tabela criada pelo notebook «Restauração em polígonos de mangal degradado». Cole o URL da tabela publicada (partilhada publicamente).", "Table created by the “Restoration on degraded mangrove polygons” notebook. Paste the URL of the published table (shared publicly).")) : null,
        ds === "entidades" ? h("p", { class: "nota" }, L("Use uma VISTA pública da ficha de entidades só com os campos da entidade e o estado (sem telefones, e-mails nem nomes dos técnicos).", "Use a public VIEW of the organisations form with only organisation fields and status (no phones, e-mails or staff names).")) : null,
        bilingue(L("Nome", "Name"), c, "nome"),
        campo(L("URL do Feature Service", "Feature Service URL"), c, "url", { ajuda: "https://services….arcgis.com/…/arcgis/rest/services/…/FeatureServer" }),
        h("div", { class: "linha" }, h("button", { class: "btn", onclick: testar }, L("Testar ligação e ver as tabelas", "Test connection and show tables")), res),
        quadro,
        campo(L("ID do formulário Survey123 (para o botão Editar na validação)", "Survey123 form item ID (for the Edit button in validation)"), c, "formItemId"),
        escolha(L("Campo usado no filtro de ano", "Field used for the year filter"), c, "campoAno", datasCampos(ds)),
        campo(L("Cor no mapa", "Map colour"), c, "cor", { tipo: "color" }),
        campoLista(L("Campos com o nome da instituição (separados por vírgula)", "Fields with the institution name (comma separated)"), c.camposInstituicao, v => (c.camposInstituicao = v),
          L("Por omissão: nome_entidade (entidade validada do técnico). Use tabela.campo para tabelas relacionadas.", "Default: nome_entidade (the staff member's validated organisation). Use table.field for related tables.")),
        campoLista(L("Alternativa para registos antigos sem entidade", "Fallback for older records without an organisation"), c.camposInstituicaoAlternativos, v => (c.camposInstituicaoAlternativos = v)),
        campo(L("Token ArcGIS (só se a camada não for pública; fica visível no repositório)", "ArcGIS token (only if the layer is not public; visible in the repository)"), c, "token"))));
  }
}

function secDashboard(el) {
  const D = W.dashboard;
  titulo(el, "Dashboard", "Dashboard", L("Cada página tem indicadores (números em destaque) e gráficos. Altere títulos, tipo de gráfico, campos e ordem. As opções avançadas permitem gráficos com várias séries.",
    "Each page has indicators (headline numbers) and charts. Change titles, chart type, fields and order. Advanced options allow multi-series charts."));
  el.append(h("div", { class: "sub" }, (D.versao || 1) < 4 ? h("p", {}, h("strong", {}, L("Há uma versão nova do dashboard disponível", "A new dashboard version is available")), " — " + L("página «Entidades e contribuições», sobrevivência e regeneração por espécie, crescimento, sinais de stress, fauna associada e restauração sobre mangal degradado mapeado.", "“Organisations and contributions” page, survival and regeneration by species, growth, stress signs, associated fauna and restoration on mapped degraded mangrove.")) : null,
    h("button", { class: "btn", onclick: async () => {
      if (!confirm(L("Substituir as páginas, indicadores e gráficos do dashboard pela versão padrão? As outras definições do portal não mudam.", "Replace the dashboard pages, indicators and charts with the default version? Other portal settings stay the same."))) return;
      try { const r = await fetch("config/dashboard_padrao.json?v=" + Date.now()); const novo = await r.json();
        novo.limiarSobrevivencia = D.limiarSobrevivencia ?? novo.limiarSobrevivencia; novo.areaQuadricula_m2 = D.areaQuadricula_m2 ?? novo.areaQuadricula_m2;
        W.dashboard = novo; marcar(); renderGestao($("#app")); toast(L("Dashboard padrão aplicado. Clique em Guardar e publicar.", "Default dashboard applied. Click Save and publish."), "ok", 6000); }
      catch (e) { toast(e.message, "erro"); }
    } }, "↺ " + L("Aplicar o dashboard padrão (versão mais recente)", "Apply the default dashboard (latest version)"))));
  el.append(h("div", { class: "duas" },
    campo(L("Limiar de sobrevivência para “em recuperação” (%)", "Survival threshold for “recovering” (%)"), D, "limiarSobrevivencia", { tipo: "number" }),
    campo(L("Área de cada quadrícula do levantamento (m²)", "Survey plot area (m²)"), D, "areaQuadricula_m2", { tipo: "number" })));
  el.append(h("h4", {}, L("Páginas", "Pages")));
  el.append(editorLista(D.paginas, () => ({ id: "pagina-" + (D.paginas.length + 1), titulo: { pt: L("Nova página", "New page"), en: "New page" }, kpis: [], graficos: [] }),
    (p, c) => {
      c.append(bilingue(L("Título da página", "Page title"), p, "titulo"), bilingue(L("Descrição (aparece no cabeçalho da página)", "Description (shown in the page header)"), p, "descricao", { area: true, rows: 2 }),
        h("div", { class: "duas" }, campo(L("Identificador (sem espaços, aparece no endereço)", "Identifier (no spaces, used in the address)"), p, "id"), escolha(L("Ícone", "Icon"), p, "icone", ICONES_OPS())),
        escolha(L("Imagem de fundo do cabeçalho", "Header background image"), p, "imagem", [["", L("Automática (pelo tema da página)", "Automatic (by page topic)")], ["hero", L("Principal", "Main")], ["mangal", L("Mangal", "Mangroves")], ["ervas", L("Ervas marinhas", "Seagrasses")], ["nenhuma", L("Sem imagem", "No image")]]));
      c.append(h("h4", {}, L("Indicadores", "Indicators")), editorLista(p.kpis = p.kpis || [], () => ({ id: "k" + Date.now(), titulo: { pt: L("Novo indicador", "New indicator"), en: "" }, dataset: "restauracao", tabela: "main", medida: "contagem" }), editarKPI, k => tr(k.titulo, S.lang)));
      c.append(h("h4", {}, L("Gráficos", "Charts")), editorLista(p.graficos = p.graficos || [], () => ({ id: "g" + Date.now(), titulo: { pt: L("Novo gráfico", "New chart"), en: "" }, tipo: "barrash", dataset: "restauracao", tabela: "main", dimensao: "_provincia", medida: "contagem", largura: "1/3" }), editarGrafico, g => `${tr(g.titulo, S.lang)} · ${g.tipo}`));
    }, p => tr(p.titulo, S.lang)));
}

function editarKPI(k, c) {
  const redesenhar = () => { c.innerHTML = ""; editarKPI(k, c); };
  k.filtro = k.filtro || null;
  c.append(bilingue(L("Título", "Title"), k, "titulo"), bilingue(L("Nota por baixo", "Note below"), k, "subtitulo"),
    h("div", { class: "tres" }, escolha(L("Ficha", "Form"), k, "dataset", dsOps(), { depois: redesenhar }), escolha(L("Tabela", "Table"), k, "tabela", tabOps(k.dataset), { depois: redesenhar }),
      escolha(L("Cálculo", "Calculation"), k, "medida", MEDIDAS(), { depois: redesenhar })),
    k.medida === "especial" ? escolha(L("Indicador especial", "Special indicator"), k, "especial", [["lev_densidade", L("Densidade de árvores vivas (árv./ha)", "Live tree density (trees/ha)")], ["lev_area_basal", L("Área basal (m²/ha)", "Basal area (m²/ha)")]])
      : h("div", { class: "duas" }, escolha(L("Campo", "Field"), k, "campo", campoOps(k.dataset, k.tabela)), k.medida === "razao" ? escolha(L("Campo 2 (divisor)", "Field 2 (divisor)"), k, "campo2", campoOps(k.dataset, k.tabela)) : h("span")),
    h("div", { class: "tres" }, escolha(L("Formato", "Format"), k, "formato", [["", L("Número", "Number")], ["pct", "%"]]), campo(L("Casas decimais", "Decimals"), k, "decimais", { tipo: "number" }),
      campo(L("Unidade depois do número (ex.: ha)", "Unit after the number (e.g. ha)"), k, "sufixo")),
    h("div", { class: "tres" }, escolha(L("Ícone", "Icon"), k, "icone", ICONES_OPS()),
      campo(L("Números grandes abreviados (ex.: 36,8 M)", "Abbreviate large numbers (e.g. 36.8 M)"), k, "compacto", { tipo: "checkbox" }),
      campo(L("Esconder a mini-tendência por ano", "Hide the yearly mini-trend"), { get v() { return k.tendencia === false; }, set v(x) { k.tendencia = x ? false : undefined; } }, "v", { tipo: "checkbox" })),
    editorFiltro(k));
}

function editorFiltro(obj) {
  const f = obj.filtro || { campo: "", valores: [], nao: false };
  const box = h("div", { class: "sub" }, h("small", {}, L("Filtro (opcional): contar só os registos em que o campo tem estes valores (códigos separados por vírgula).", "Filter (optional): count only records where the field has these values (comma-separated codes).")));
  const aplicar = () => { obj.filtro = f.campo ? f : undefined; if (!obj.filtro) delete obj.filtro; marcar(); };
  const sel = h("select", { onchange: e => { f.campo = e.target.value; aplicar(); } }, campoOps(obj.dataset, obj.tabela).map(([v, l]) => h("option", { value: v, selected: f.campo === v }, l)));
  const vals = h("input", { type: "text", value: (f.valores || []).join(", "), oninput: e => { f.valores = e.target.value.split(",").map(s => s.trim()).filter(Boolean); aplicar(); } });
  const nao = h("input", { type: "checkbox", checked: !!f.nao, onchange: e => { f.nao = e.target.checked; aplicar(); } });
  box.append(h("div", { class: "tres" }, h("label", { class: "campo" }, h("span", {}, L("Campo", "Field")), sel), h("label", { class: "campo" }, h("span", {}, L("Valores", "Values")), vals),
    h("label", { class: "campo chk" }, nao, " ", L("Excluir estes valores", "Exclude these values"))));
  return box;
}

function editarGrafico(g, c) {
  const redesenhar = () => { c.innerHTML = ""; editarGrafico(g, c); };
  const simples = !["mapa", "tabela", "cobertura", "texto", "gauge", "imagem"].includes(g.tipo);
  c.append(bilingue(L("Título", "Title"), g, "titulo"), bilingue(L("Subtítulo", "Subtitle"), g, "subtitulo"),
    h("div", { class: "tres" }, escolha(L("Tipo", "Type"), g, "tipo", TIPOS(), { depois: redesenhar }), escolha(L("Largura", "Width"), g, "largura", LARGURAS), campo(L("Altura (px, opcional)", "Height (px, optional)"), g, "altura", { tipo: "number" })),
    h("div", { class: "duas" }, escolha(L("Ficha", "Form"), g, "dataset", dsOps(), { depois: redesenhar }), escolha(L("Tabela", "Table"), g, "tabela", tabOps(g.dataset), { depois: redesenhar })));
  if (simples) {
    c.append(
      h("div", { class: "duas" }, Array.isArray(g.dimensao) ? h("p", { class: "nota" }, L("Categorias: vários campos (editar em Avançado).", "Categories: several fields (edit in Advanced)."))
        : escolha(L("Categorias (eixo / fatias)", "Categories (axis / slices)"), g, "dimensao", campoOps(g.dataset, g.tabela)),
        escolha(L("Dividir as barras por (opcional)", "Split bars by (optional)"), g, "serieDimensao", campoOps(g.dataset, g.tabela))),
      h("div", { class: "tres" }, escolha(L("Cálculo", "Calculation"), g, "medida", MEDIDAS().filter(m => m[0] !== "especial" && m[0] !== "percentagem"), { depois: redesenhar }),
        escolha(L("Campo", "Field"), g, "campo", campoOps(g.dataset, g.tabela)), g.medida === "razao" ? escolha(L("Campo 2 (divisor)", "Field 2 (divisor)"), g, "campo2", campoOps(g.dataset, g.tabela)) : h("span")),
      h("div", { class: "tres" }, escolha(L("Ordem", "Order"), g, "ordem", ORDENS()), campo(L("Máximo de categorias", "Max categories"), g, "limite", { tipo: "number" }),
        escolha(L("Formato", "Format"), g, "formato", [["", L("Número", "Number")], ["pct", "%"]])),
      h("div", { class: "tres" }, campo(L("Mostrar como % do total", "Show as % of total"), g, "comoPercentagem", { tipo: "checkbox" }),
        campo(L("Valores acumulados (linha/área)", "Cumulative values (line/area)"), g, "acumulado", { tipo: "checkbox" }),
        campo(L("Cor (uma só série)", "Colour (single series)"), g, "cor", { tipo: "color" })),
      editorFiltro(g));
  }
  if (g.tipo === "gauge") c.append(
    h("div", { class: "tres" }, escolha(L("Cálculo", "Calculation"), g, "medida", MEDIDAS().filter(m => m[0] !== "percentagem_registos"), { depois: redesenhar }),
      escolha(L("Campo", "Field"), g, "campo", campoOps(g.dataset, g.tabela)), escolha(L("Campo 2 (divisor)", "Field 2 (divisor)"), g, "campo2", campoOps(g.dataset, g.tabela))),
    h("div", { class: "tres" }, campo(L("Valor máximo do medidor", "Gauge maximum"), g, "max", { tipo: "number" }), escolha(L("Formato", "Format"), g, "formato", [["", L("Número", "Number")], ["pct", "%"]]),
      campo(L("Marcar o limiar de sobrevivência", "Show the survival threshold"), g, "usarLimiar", { tipo: "checkbox" })),
    editorFiltro(g));
  if (g.tipo === "mapa") c.append(h("div", { class: "checks" }, DATASETS.map(d => h("label", { class: "check" }, h("input", { type: "checkbox", checked: (g.camadas || []).includes(d),
    onchange: e => { g.camadas = (g.camadas || []).filter(x => x !== d); if (e.target.checked) g.camadas.push(d); marcar(); } }), " " + tr(W.fontes.datasets[d].nome, S.lang)))));
  if (g.tipo === "tabela") c.append(campoLista(L("Colunas (campos separados por vírgula)", "Columns (comma-separated fields)"), g.colunas, v => (g.colunas = v),
    L("Campos disponíveis: ", "Available fields: ") + campoOps(g.dataset, g.tabela, false).map(o => o[0]).join(", ")));
  if (g.tipo === "texto") c.append(bilingue(L("Texto", "Text"), g, "texto", { area: true, rows: 8 }), inserirImagem(g, "texto"));
  if (g.tipo === "imagem") c.append(carregar(L("Imagem", "Image"), g, "imagem", "assets/img", { accept: "image/*", imagem: true }),
    bilingue(L("Legenda (opcional)", "Caption (optional)"), g, "legenda"), campo(L("Ligação ao clicar (opcional)", "Link on click (optional)"), g, "ligacao"));
  // Avançado: JSON do gráfico
  const ta = h("textarea", { rows: 10, class: "mono" }, JSON.stringify(g, null, 1));
  const msg = h("small", {});
  c.append(h("details", { class: "sub" }, h("summary", {}, L("Avançado (JSON)", "Advanced (JSON)")), ta, h("div", { class: "linha" },
    h("button", { class: "btn", onclick: () => { try { const o = JSON.parse(ta.value); Object.keys(g).forEach(k => delete g[k]); Object.assign(g, o); marcar(); redesenhar(); } catch (e) { msg.textContent = "JSON: " + e.message; } } }, L("Aplicar JSON", "Apply JSON")), msg)));
}

function secTecnica(el) {
  titulo(el, "Área técnica: painéis embebidos", "Technical area: embedded panels", L("Cada painel aparece como uma sub-aba da Área técnica, antes da Validação de dados. Cole a ligação da aplicação ArcGIS Experience (ou de um ArcGIS Dashboard). A aplicação tem de estar partilhada com quem a vai ver; se não for pública, a pessoa terá de entrar com a conta ArcGIS dentro do painel.",
    "Each panel appears as a sub-tab of the Technical area, before Data validation. Paste the ArcGIS Experience app link (or an ArcGIS Dashboard). The app must be shared with its viewers; if it is not public, they will need to sign in to ArcGIS inside the panel."));
  W.tecnica = W.tecnica || {}; W.tecnica.paineis = W.tecnica.paineis || [];
  el.append(editorLista(W.tecnica.paineis, () => ({ titulo: { pt: L("Painel técnico", "Technical panel"), en: "Technical panel" }, url: "", altura: 800, descricao: { pt: "", en: "" } }),
    (p, c) => c.append(bilingue(L("Nome da sub-aba", "Sub-tab name"), p, "titulo"),
      campo(L("Ligação (URL) da aplicação", "App link (URL)"), p, "url", { ajuda: "https://experience.arcgis.com/experience/…" }),
      campo(L("Altura (px)", "Height (px)"), p, "altura", { tipo: "number" }),
      bilingue(L("Nota por cima do painel (opcional)", "Note above the panel (optional)"), p, "descricao")), p => tr(p.titulo, S.lang)));
}

function secValidacao(el) {
  const V = W.validacao;
  titulo(el, "Validação de dados", "Data validation", L("Regras usadas na Área técnica › Validação de dados.", "Rules used in Technical area › Data validation."));
  const nomes = { obrigatorios: L("Campos obrigatórios", "Required fields"), geometria: L("Localização (existe e está dentro de Moçambique)", "Location (exists and is inside Mozambique)"),
    datas: L("Datas plausíveis", "Plausible dates"), limites: L("Valores dentro dos limites", "Values within limits"), duplicados: L("Possíveis duplicados", "Possible duplicates"),
    ligacoes: L("Ligações entre fichas", "Links between forms"), siglas: L("Instituições escritas em sigla", "Institutions written as acronyms"), consistencia: L("Plantas vivas ≤ plantadas", "Live plants ≤ planted"),
    sem_tecnico: L("Registos sem código de técnico (registos antigos)", "Records without a staff code (older records)"),
    tecnico_inactivo: L("Código de técnico não validado ou suspenso", "Staff code not validated or suspended"),
    entidade_pendente: L("Entidades à espera de validação", "Organisations awaiting validation") };
  el.append(h("div", { class: "checks" }, Object.keys(nomes).map(k => campo(nomes[k], V.regras, k, { tipo: "checkbox" }))));
  el.append(campo(L("Avisar sobre entidades pendentes há mais de (dias)", "Warn about organisations pending for more than (days)"), V, "diasPendente", { tipo: "number" }));
  const bb = { a: V.bbox[0], b: V.bbox[1], c: V.bbox[2], d: V.bbox[3] };
  const upd = () => { V.bbox = [bb.a, bb.b, bb.c, bb.d].map(Number); };
  el.append(h("h4", {}, L("Rectângulo de Moçambique (graus)", "Mozambique bounding box (degrees)")),
    h("div", { class: "tres" }, campo(L("Longitude mín.", "Min longitude"), bb, "a", { tipo: "number", step: "0.01", depois: upd }), campo(L("Latitude mín.", "Min latitude"), bb, "b", { tipo: "number", step: "0.01", depois: upd }),
      campo(L("Longitude máx.", "Max longitude"), bb, "c", { tipo: "number", step: "0.01", depois: upd }), campo(L("Latitude máx.", "Max latitude"), bb, "d", { tipo: "number", step: "0.01", depois: upd })));
  el.append(h("h4", {}, L("Limites de valores", "Value limits")), editorLista(V.limites, () => ({ dataset: "restauracao", tabela: "main", campo: "", min: 0, max: 100 }),
    (x, c) => { const red = () => { c.innerHTML = ""; c.append(...corpo()); }; const corpo = () => [h("div", { class: "tres" }, escolha(L("Ficha", "Form"), x, "dataset", dsOps(), { depois: red }), escolha(L("Tabela", "Table"), x, "tabela", tabOps(x.dataset), { depois: red }), escolha(L("Campo", "Field"), x, "campo", campoOps(x.dataset, x.tabela))),
      h("div", { class: "duas" }, campo("Mín.", x, "min", { tipo: "number", step: "any" }), campo("Máx.", x, "max", { tipo: "number", step: "any" }))]; c.append(...corpo()); },
    x => `${tr(W.fontes.datasets[x.dataset].nome, S.lang)} · ${x.campo ? rotuloCampo(x.dataset, x.tabela, x.campo) : "—"} (${x.min ?? "–"} a ${x.max ?? "–"})`));
}

function secAcesso(el) {
  titulo(el, "Privacidade e acesso", "Privacy and access");
  const ex = { v: (W.privacidade.camposExcluidos || []).join(", ") };
  el.append(campo(L("Campos nunca incluídos nos descarregamentos (separados por vírgula)", "Fields never included in downloads (comma separated)"), ex, "v", { area: true,
    depois: () => { W.privacidade.camposExcluidos = ex.v.split(",").map(s => s.trim()).filter(Boolean); } }),
    campo(L("Área técnica só para quem entra com token do GitHub", "Technical area only for users signed in with a GitHub token"), W.acesso, "tecnicaRequerLogin", { tipo: "checkbox" }),
    h("p", { class: "nota" }, L("Atenção: o portal é um site estático. Esconder a Área técnica não protege os dados; os dados ficam protegidos pela partilha das camadas no ArcGIS Online.",
      "Note: the portal is a static site. Hiding the Technical area does not protect the data; data is protected by how layers are shared in ArcGIS Online.")),
    h("h4", {}, L("Repositório GitHub (opcional, detectado automaticamente)", "GitHub repository (optional, auto-detected)")),
    h("div", { class: "tres" }, campo(t("login_owner"), W.github, "owner"), campo(t("login_repo"), W.github, "repo"), campo(t("login_branch"), W.github, "branch")));
}

function secBackup(el) {
  titulo(el, "Cópia de segurança", "Backup", L("Guarde uma cópia da configuração antes de grandes alterações. Pode repô-la mais tarde.", "Keep a copy of the configuration before big changes. You can restore it later."));
  const inp = h("input", { type: "file", accept: ".json", style: "display:none", onchange: async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const o = JSON.parse(await f.text()); if (!o.portal || !o.dashboard) throw new Error(L("Ficheiro não é uma configuração do portal", "Not a portal configuration file")); W = completarConfig(o); S.cfg = W; marcar(); renderShell(); toast(L("Configuração carregada. Clique em Guardar e publicar.", "Configuration loaded. Click Save and publish."), "ok"); }
    catch (err) { toast(err.message, "erro"); }
  } });
  el.append(h("div", { class: "linha" },
    h("button", { class: "btn", onclick: () => download(`configuracao_portal_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(W, null, 1), "application/json") }, "⭳ " + L("Descarregar configuração", "Download configuration")),
    inp, h("button", { class: "btn", onclick: () => inp.click() }, "⭱ " + L("Repor a partir de ficheiro", "Restore from file"))));
}
