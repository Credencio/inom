// Gestão do portal: editor gráfico da configuração, com gravação no GitHub (token pessoal).
import { S, DATASETS, lerArcGIS, rotuloCampo } from "./data.js";
import { UI, VIRTUAIS_CAMPOS } from "./i18n.js";
import { $, h, tr, clone, toast, b64utf8, fileToB64, slug, download, esc } from "./util.js";
import { renderShell, repoPadrao, recarregarDados, modal } from "./main.js";

const t = k => UI[S.lang][k] || k;
const L = (pt, en) => (S.lang === "en" ? en : pt);
let W = null, sujo = false, seccao = "geral", paginaSel = 0;

/* ---------------- GitHub ---------------- */
async function gh(caminho, opts = {}) {
  const a = S.auth;
  const r = await fetch(`https://api.github.com/repos/${a.owner}/${a.repo}/${caminho}`, {
    ...opts, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${a.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) } });
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
    if (!info || !info.permissions || !(info.permissions.push || info.permissions.admin)) throw new Error(t("login_erro"));
    try { const u = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()); S.auth.login = u.login || ""; } catch { /* opcional */ }
    sessionStorage.setItem("gh_auth", JSON.stringify(S.auth));
    return true;
  } catch (e) { S.auth = null; sessionStorage.removeItem("gh_auth"); throw e; }
}

/* ---------------- Componentes de formulário ---------------- */
function marcar() { sujo = true; S.cfg = W; const b = $("#btn-guardar"); if (b) b.classList.add("pulsar"); }
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
  ["cobertura", L("Registos por província", "Records by province")], ["texto", L("Texto", "Text")]];
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
export function renderGestao(app) {
  app.innerHTML = "";
  if (!S.auth) return renderLogin(app);
  if (!W) W = S.cfg;
  const seccoes = [["geral", L("Geral e logótipos", "General and logos")], ["sobre", t("nav_sobre")], ["documentos", t("nav_documentos")], ["fichas", t("nav_fichas")],
    ["fontes", L("Fontes de dados", "Data sources")], ["dashboard", t("nav_dashboard")], ["tecnica", t("nav_tecnica")], ["validacao", t("tec_validacao")], ["acesso", L("Privacidade e acesso", "Privacy and access")], ["backup", L("Cópia de segurança", "Backup")]];
  const conteudo = h("div", { class: "ges-conteudo" });
  app.append(h("div", { class: "pagina larga gestao" },
    h("div", { class: "ges-topo" },
      h("div", {}, h("h2", {}, t("nav_gestao")), h("small", {}, `${S.auth.login ? "@" + S.auth.login + " · " : ""}${S.auth.owner}/${S.auth.repo} (${S.auth.branch})`)),
      h("div", { class: "linha" },
        h("button", { class: "btn", onclick: descartar }, L("Descartar alterações", "Discard changes")),
        h("button", { id: "btn-guardar", class: "btn primary" + (sujo ? " pulsar" : ""), onclick: guardar }, "💾 " + L("Guardar e publicar", "Save and publish")),
        h("button", { class: "btn link", onclick: sair }, t("login_sair")))),
    h("p", { class: "nota" }, L("As alterações aparecem logo neste navegador. Para ficarem visíveis para todos, clique em “Guardar e publicar”; o site actualiza em 1 a 2 minutos.",
      "Changes show immediately in this browser. To make them visible to everyone, click “Save and publish”; the site updates in 1 to 2 minutes.")),
    h("div", { class: "ges" },
      h("nav", { class: "ges-menu" }, seccoes.map(([k, l]) => h("a", { class: seccao === k ? "active" : "", onclick: () => { seccao = k; renderGestao(app); } }, l))),
      conteudo)));
  ({ geral: secGeral, sobre: secSobre, documentos: secDocumentos, fichas: secFichas, fontes: secFontes, dashboard: secDashboard, tecnica: secTecnica, validacao: secValidacao, acesso: secAcesso, backup: secBackup }[seccao])(conteudo);
}

function renderLogin(app) {
  const def = repoPadrao();
  const st = { owner: def.owner, repo: def.repo, branch: def.branch, token: "" };
  const erro = h("p", { class: "erro-txt" });
  app.append(h("div", { class: "pagina estreita" }, h("h2", {}, t("login_titulo")), h("p", {}, t("login_intro")),
    campo(t("login_owner"), st, "owner"), campo(t("login_repo"), st, "repo"), campo(t("login_branch"), st, "branch"),
    campo(t("login_token"), st, "token", { tipo: "password" }),
    h("p", { class: "nota" }, t("login_ajuda")), erro,
    h("button", { class: "btn primary", onclick: async e => {
      erro.textContent = ""; e.target.disabled = true;
      try { await entrar(st.owner.trim(), st.repo.trim(), st.branch.trim() || "main", st.token.trim()); renderGestao(app); }
      catch (err) { erro.textContent = err.message || t("login_erro"); }
      finally { e.target.disabled = false; }
    } }, t("login_entrar"))));
  sujo = false;
}

async function guardar() {
  try {
    W.versao = (W.versao || 1);
    await gravarFicheiro("config/portal.json", b64utf8(JSON.stringify(W, null, 1)), `Portal: actualização da configuração (${new Date().toISOString().slice(0, 16)})`);
    sujo = false; $("#btn-guardar") && $("#btn-guardar").classList.remove("pulsar");
    toast(L("Guardado no GitHub. O site público actualiza em 1 a 2 minutos.", "Saved to GitHub. The public site updates in 1 to 2 minutes."), "ok", 6000);
  } catch (e) { toast(L("Erro ao guardar: ", "Save error: ") + e.message, "erro", 10000); }
}
async function descartar() {
  if (!confirm(L("Descartar todas as alterações não guardadas?", "Discard all unsaved changes?"))) return;
  const r = await fetch("config/portal.json?v=" + Date.now()); W = await r.json(); S.cfg = W; sujo = false; renderShell(); renderGestao($("#app"));
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

function secSobre(el) {
  titulo(el, "Página Sobre", "About page", L("Escreva em texto simples. Formatação: ## Título, **negrito**, *itálico*, - lista, [texto](https://ligação).", "Write plain text. Formatting: ## Heading, **bold**, *italic*, - list, [text](https://link)."));
  if (typeof W.sobre !== "object") W.sobre = { pt: W.sobre || "", en: "" };
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
  titulo(el, "Fontes de dados", "Data sources", L("Cole o URL de cada Feature Service (termina em /FeatureServer). As camadas têm de estar partilhadas publicamente (de preferência uma vista sem dados pessoais) para o portal as ler.",
    "Paste each Feature Service URL (ends in /FeatureServer). Layers must be shared publicly (ideally a view without personal data) for the portal to read them."));
  el.append(campo(L("Usar dados de demonstração nas fichas sem URL", "Use demo data for forms without a URL"), W.fontes, "modoDemo", { tipo: "checkbox" }),
    h("button", { class: "btn", onclick: async () => { await recarregarDados(); toast(L("Dados recarregados.", "Data reloaded."), "ok"); } }, "↻ " + L("Recarregar dados com estas definições", "Reload data with these settings")));
  for (const ds of DATASETS) {
    const c = W.fontes.datasets[ds];
    const res = h("small", { class: "res" });
    el.append(h("details", { class: "item", open: !c.url }, h("summary", {}, h("strong", {}, tr(c.nome, S.lang)), " ", h("span", { class: "tag " + (c.url ? "ok" : "vazio") }, c.url ? t("fonte_ok") : t("fonte_vazio"))),
      h("div", { class: "item-corpo" },
        bilingue(L("Nome", "Name"), c, "nome"),
        campo(L("URL do Feature Service", "Feature Service URL"), c, "url", { ajuda: "https://services….arcgis.com/…/arcgis/rest/services/…/FeatureServer" }),
        h("div", { class: "linha" }, h("button", { class: "btn", onclick: async () => {
          res.textContent = L("A testar…", "Testing…");
          try { const raw = await lerArcGIS(c); res.textContent = `✓ ${raw.main.length} ${t("registos")} · ${Object.entries(raw.tables).map(([k, v]) => `${k}: ${v.length}`).join(" · ")}`; res.className = "res ok"; }
          catch (e) { res.textContent = "✗ " + e.message; res.className = "res erro-txt"; }
        } }, L("Testar ligação", "Test connection")), res),
        campo(L("ID do formulário Survey123 (para o botão Editar na validação)", "Survey123 form item ID (for the Edit button in validation)"), c, "formItemId"),
        escolha(L("Campo usado no filtro de ano", "Field used for the year filter"), c, "campoAno", datasCampos(ds)),
        campo(L("Cor no mapa", "Map colour"), c, "cor", { tipo: "color" }),
        campoLista(L("Campos com nomes de instituições (separados por vírgula)", "Fields with institution names (comma separated)"), c.camposInstituicao, v => (c.camposInstituicao = v),
          L("Use tabela.campo para tabelas relacionadas, ex.: partes_executoras_rpt.nome_parte_executora", "Use table.field for related tables, e.g. partes_executoras_rpt.nome_parte_executora")),
        campo(L("Token ArcGIS (só se a camada não for pública; fica visível no repositório)", "ArcGIS token (only if the layer is not public; visible in the repository)"), c, "token"))));
  }
}

function secDashboard(el) {
  const D = W.dashboard;
  titulo(el, "Dashboard", "Dashboard", L("Cada página tem indicadores (números em destaque) e gráficos. Altere títulos, tipo de gráfico, campos e ordem. As opções avançadas permitem gráficos com várias séries.",
    "Each page has indicators (headline numbers) and charts. Change titles, chart type, fields and order. Advanced options allow multi-series charts."));
  el.append(h("div", { class: "sub" }, (D.versao || 1) < 2 ? h("p", {}, h("strong", {}, L("Há uma versão nova do dashboard disponível", "A new dashboard version is available")), " — " + L("gráficos novos (mapa maior, fluxo viveiro → restauração, mosaico de espécies, medidores, áreas acumuladas) e indicadores com tendência.", "new charts (larger map, nursery → restoration flow, species treemap, gauges, cumulative areas) and indicators with trends.")) : null,
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
        h("div", { class: "duas" }, campo(L("Identificador (sem espaços, aparece no endereço)", "Identifier (no spaces, used in the address)"), p, "id"), escolha(L("Ícone", "Icon"), p, "icone", ICONES_OPS())));
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
  const simples = !["mapa", "tabela", "cobertura", "texto", "gauge"].includes(g.tipo);
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
  if (g.tipo === "texto") c.append(bilingue(L("Texto", "Text"), g, "texto", { area: true, rows: 8 }));
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
    ligacoes: L("Ligações entre fichas", "Links between forms"), siglas: L("Instituições escritas em sigla", "Institutions written as acronyms"), consistencia: L("Plantas vivas ≤ plantadas", "Live plants ≤ planted") };
  el.append(h("div", { class: "checks" }, Object.keys(nomes).map(k => campo(nomes[k], V.regras, k, { tipo: "checkbox" }))));
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
    try { const o = JSON.parse(await f.text()); if (!o.portal || !o.dashboard) throw new Error(L("Ficheiro não é uma configuração do portal", "Not a portal configuration file")); W = o; S.cfg = W; marcar(); renderShell(); toast(L("Configuração carregada. Clique em Guardar e publicar.", "Configuration loaded. Click Save and publish."), "ok"); }
    catch (err) { toast(err.message, "erro"); }
  } });
  el.append(h("div", { class: "linha" },
    h("button", { class: "btn", onclick: () => download(`configuracao_portal_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(W, null, 1), "application/json") }, "⭳ " + L("Descarregar configuração", "Download configuration")),
    inp, h("button", { class: "btn", onclick: () => inp.click() }, "⭱ " + L("Repor a partir de ficheiro", "Restore from file"))));
}
