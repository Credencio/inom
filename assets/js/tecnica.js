// Área técnica: validação automática dos dados e estado das fontes.
import { S, DATASETS, get, campoSchema, rotuloCampo, dataDe } from "./data.js";
import { UI } from "./i18n.js";
import { h, tr, num, normName, toCSV, download, fmtDate, esc } from "./util.js";
import { recarregarDados } from "./main.js";

const t = k => UI[S.lang][k] || k;

export function renderTecnica(app, sub) {
  app.innerHTML = "";
  const paineis = ((S.cfg.tecnica || {}).paineis || []).filter(p => p && p.url);
  if (!sub) sub = paineis.length ? "painel-1" : "validacao";
  const pg = h("div", { class: "pagina larga" },
    h("div", { class: "subtabs" },
      paineis.map((p, i) => h("a", { href: `#/tecnica/painel-${i + 1}`, class: sub === `painel-${i + 1}` ? "active" : "" }, tr(p.titulo, S.lang) || `Painel ${i + 1}`)),
      h("a", { href: "#/tecnica/validacao", class: sub === "validacao" ? "active" : "" }, t("tec_validacao")),
      h("a", { href: "#/tecnica/fontes", class: sub === "fontes" ? "active" : "" }, t("tec_fontes"))));
  app.append(pg);
  if (sub.startsWith("painel-")) renderPainel(pg, paineis[Number(sub.slice(7)) - 1]);
  else if (sub === "fontes") renderFontes(pg); else renderValidacao(pg);
}

/* ---------------- Painéis embebidos (ArcGIS Experience, Dashboards, etc.) ---------------- */
function renderPainel(pg, p) {
  if (!p) { pg.append(h("p", { class: "vazio" }, t("painel_vazio"))); return; }
  const url = String(p.url || "").trim();
  if (!/^https:\/\//i.test(url)) { pg.append(h("p", { class: "erro-txt" }, "URL inválido (tem de começar por https://)")); return; }
  pg.append(
    p.descricao && tr(p.descricao, S.lang) ? h("p", { class: "nota" }, tr(p.descricao, S.lang)) : null,
    h("div", { class: "painel-emb" }, h("iframe", { src: url, title: tr(p.titulo, S.lang) || "ArcGIS", loading: "lazy",
      allow: "fullscreen; geolocation", allowfullscreen: true, style: `height:${Number(p.altura) || 800}px` })),
    h("p", { class: "nota" }, h("a", { href: url, target: "_blank", rel: "noopener" }, "↗ " + t("abrir_nova"))));
}

/* ---------------- Regras ---------------- */
const CAMPOS_NOME = { viveiros: "nome_viveiro", restauracao: "nome_do_projecto", ervas: "nome_tapete", entidades: "nome_entidade" };
const LIGACOES = [
  { ds: "restauracao", tabela: "main", campo: "id_area_degradada", alvo: "degradadas", campoAlvo: "id_area_degradada" },
  { ds: "restauracao", tabela: "material_vegetal", campo: "viveiro_origem", alvo: "viveiros", campoAlvo: "id_viveiro" },
  { ds: "monitoria", tabela: "main", campo: "id_area_restauracao", alvo: "restauracao", campoAlvo: "id_area_restauracao" },
  { ds: "levantamento", tabela: "main", campo: "id_area_restauracao", alvo: "restauracao", campoAlvo: "id_area_restauracao" },
  { ds: "levantamento", tabela: "main", campo: "id_area_degradada", alvo: "degradadas", campoAlvo: "id_area_degradada" }
];
const GEOM_PRINCIPAL = { viveiros: true, degradadas: true, restauracao: true, ervas: true, monitoria: false, levantamento: false };

export function validar() {
  const V = S.cfg.validacao || {}, R = V.regras || {}, bbox = V.bbox || [30.2, -26.95, 41, -10.3];
  const out = [];
  const add = (r, campo, regra, valor, grav = "erro") => out.push({ ds: r.ds, tabela: r.tabela, rec: r, campo, regra, valor: valor ?? "", grav });
  const hoje = Date.now();
  for (const ds of DATASETS) {
    const D = S.data[ds]; if (!D || !D.main) continue;
    const sc = S.schema[ds];
    const todas = [["main", D.main], ...Object.entries(D.tables)];
    for (const [tab, rows] of todas) {
      const campos = (sc && sc.tables[tab] && sc.tables[tab].fields) || {};
      for (const r of rows) {
        if (R.obrigatorios) for (const [c, f] of Object.entries(campos)) {
          if (!f.required || ["geoshape", "geopoint", "geotrace", "image", "calculate"].includes(f.type) || c === "codigo_tecnico") continue;
          const v = r.a[c] ?? r.a[c.toLowerCase()];
          if (v === null || v === undefined || v === "") add(r, c, "r_obrigatorio", "");
        }
        if (R.datas) for (const [c, f] of Object.entries(campos)) {
          if (f.type !== "date" && f.type !== "datetime") continue;
          const d = dataDe(r.a[c] ?? r.a[c.toLowerCase()]); if (!d) continue;
          if (d.getTime() > hoje + 864e5) add(r, c, "r_data_futura", d.toISOString().slice(0, 10), "aviso");
          else if (d.getFullYear() < 1950) add(r, c, "r_data_antiga", d.toISOString().slice(0, 10), "aviso");
        }
      }
    }
    if (R.geometria) for (const r of D.main) {
      if (!r.g) { if (GEOM_PRINCIPAL[ds]) add(r, "geometria", "r_sem_geom", "", ds === "monitoria" ? "aviso" : "erro"); continue; }
      const pts = []; const walk = c => (typeof c[0] === "number" ? pts.push(c) : c.forEach(walk)); walk(r.g.coordinates);
      if (pts.some(p => p[0] < bbox[0] || p[0] > bbox[2] || p[1] < bbox[1] || p[1] > bbox[3])) add(r, "geometria", "r_fora_bbox", pts[0].map(x => x.toFixed(4)).join(", "));
    }
    if (R.duplicados && CAMPOS_NOME[ds]) {
      const vistos = new Map();
      for (const r of D.main) {
        const n = normName(get(r, CAMPOS_NOME[ds])); if (!n) continue;
        const k = n + "|" + (r.d._distrito || "");
        if (vistos.has(k)) add(r, CAMPOS_NOME[ds], "r_duplicado", get(r, CAMPOS_NOME[ds]), "aviso"); else vistos.set(k, r);
      }
    }
    if (R.siglas) for (const c of (S.cfg.fontes.datasets[ds] || {}).camposInstituicao || []) {
      const [tb, f] = c.includes(".") ? c.split(".") : ["main", c];
      for (const r of tb === "main" ? D.main : D.tables[tb] || []) { const v = r.a[f]; if (v && /^[A-Z]{2,}$/.test(String(v).trim())) add(r, f, "r_sigla", v, "aviso"); }
    }
  }
  if (R.limites) for (const L of V.limites || []) {
    const D = S.data[L.dataset]; if (!D || !D.main) continue;
    for (const r of L.tabela === "main" ? D.main : D.tables[L.tabela] || []) {
      const v = num(r.a[L.campo] ?? r.a[String(L.campo).toLowerCase()]); if (v === null) continue;
      if ((L.min !== undefined && L.min !== null && v < L.min) || (L.max !== undefined && L.max !== null && v > L.max)) add(r, L.campo, "r_limite", `${v} (${L.min ?? "–"} – ${L.max ?? "–"})`, "aviso");
    }
  }
  if (R.ligacoes) for (const L of LIGACOES) {
    const D = S.data[L.ds], A = S.data[L.alvo]; if (!D || !D.main || !A || !A.main || A.estado === "vazio") continue;
    const ids = new Set(A.main.map(x => String(x.a[L.campoAlvo] ?? "")));
    for (const r of L.tabela === "main" ? D.main : D.tables[L.tabela] || []) { const v = r.a[L.campo]; if (v && !ids.has(String(v))) add(r, L.campo, "r_ligacao", v); }
  }
  if (R.consistencia && S.data.monitoria && S.data.monitoria.tables.parcelas) for (const p of S.data.monitoria.tables.parcelas) {
    const pl = num(p.a.plantas_plantadas), vv = num(p.a.plantas_vivas);
    if (pl !== null && vv !== null && vv > pl) add(p, "plantas_vivas", "r_vivas", `${vv} > ${pl}`);
  }
  // Quem preencheu: código do técnico (fichas com o sistema de entidades e técnicos)
  const FICHAS = ["viveiros", "degradadas", "restauracao", "monitoria", "levantamento", "ervas"];
  const E = S.data.entidades;
  const entOk = E && E.main && E.estado !== "vazio" && E.estado !== "erro";
  const activos = new Set();
  if (entOk) for (const t of (E.tables.tecnicos || [])) {
    const ent = t.parent || t.root;
    if (String(t.a.estado_tecnico || "") === "validado" && ent && String(ent.a.estado_entidade || "") === "validado" && t.a.codigo_tecnico) activos.add(String(t.a.codigo_tecnico));
  }
  for (const ds of FICHAS) {
    const D = S.data[ds]; if (!D || !D.main) continue;
    for (const r of D.main) {
      const c = r.a.codigo_tecnico;
      if (!c) { if (R.sem_tecnico !== false) add(r, "codigo_tecnico", "r_sem_tecnico", "", "aviso"); continue; }
      if (R.tecnico_inactivo !== false && entOk && !activos.has(String(c))) add(r, "codigo_tecnico", "r_tecnico_inactivo", c);
    }
  }
  if (R.entidade_pendente !== false && entOk) {
    const dias = Number(V.diasPendente ?? 15);
    for (const r of E.main) {
      if (String(r.a.estado_entidade || "pendente") !== "pendente") continue;
      const d = dataDe(r.a.CreationDate ?? r.a.creationdate);
      const n = d ? Math.floor((hoje - d.getTime()) / 864e5) : null;
      if (n === null || n >= dias) add(r, "estado_entidade", "r_entidade_pendente", n === null ? "" : `${n} ${S.lang === "en" ? "days" : "dias"}`, "aviso");
    }
  }
  return out;
}

function nomeRegisto(r) {
  const root = r.root || r;
  const base = root.d._rotulo || root.a.objectid || "";
  return r.tabela === "main" ? String(base) : `${base} › ${r.tabela} #${r.a.objectid ?? ""}`;
}

function linkEditar(r) {
  const fid = (S.cfg.fontes.datasets[r.ds] || {}).formItemId;
  const root = r.root || r;
  const gid = String(root.a.globalid || "").replace(/[{}]/g, "");
  return fid && gid ? `https://survey123.arcgis.com/share/${fid}?mode=edit&globalId=${gid}` : null;
}

function renderValidacao(pg) {
  const issues = validar();
  const st = { ds: "", regra: "", grav: "" };
  pg.append(h("p", {}, t("val_intro")));
  const resumo = h("div", { class: "kpis" });
  for (const ds of DATASETS) {
    const D = S.data[ds]; if (!D || !D.main) continue;
    const mine = issues.filter(i => i.ds === ds);
    const recs = new Set(mine.map(i => i.rec.root || i.rec));
    const pct = D.main.length ? Math.round(100 * (1 - recs.size / D.main.length)) : 100;
    resumo.append(h("div", { class: "kpi clicavel" + (st.ds === ds ? " sel" : ""), onclick: () => { st.ds = st.ds === ds ? "" : ds; desenhar(); } },
      h("div", { class: "kpi-t" }, tr(S.cfg.fontes.datasets[ds].nome, S.lang)),
      h("div", { class: "kpi-s" }, `${D.main.length} ${t("registos")} · ${mine.filter(i => i.grav === "erro").length} ${t("val_erros").toLowerCase()} · ${mine.filter(i => i.grav === "aviso").length} ${t("val_avisos").toLowerCase()}`),
      h("div", { class: "kpi-v " + (pct >= 90 ? "ok" : pct >= 70 ? "med" : "mau") }, `${pct}%`)));
  }
  pg.append(resumo, h("p", { class: "nota" }, S.lang === "en" ? "% = share of records with no issues. Click a form to filter the list." : "% = parte dos registos sem problemas. Clique numa ficha para filtrar a lista."));
  const barra = h("div", { class: "barra" });
  const tabela = h("div", { class: "tabela-wrap alta" });
  pg.append(barra, tabela);
  const regras = [...new Set(issues.map(i => i.regra))];
  const desenhar = () => {
    [...resumo.children].forEach((c, i) => c.classList.toggle("sel", DATASETS.filter(d => S.data[d] && S.data[d].main)[i] === st.ds));
    barra.innerHTML = "";
    barra.append(
      h("select", { onchange: e => { st.ds = e.target.value; desenhar(); } }, h("option", { value: "" }, t("val_todas_fichas")), DATASETS.map(d => h("option", { value: d, selected: st.ds === d }, tr(S.cfg.fontes.datasets[d].nome, S.lang)))),
      h("select", { onchange: e => { st.regra = e.target.value; desenhar(); } }, h("option", { value: "" }, t("val_todas_regras")), regras.map(r => h("option", { value: r, selected: st.regra === r }, t(r)))),
      h("select", { onchange: e => { st.grav = e.target.value; desenhar(); } }, h("option", { value: "" }, `${t("val_erros")} + ${t("val_avisos")}`),
        h("option", { value: "erro", selected: st.grav === "erro" }, t("val_erros")), h("option", { value: "aviso", selected: st.grav === "aviso" }, t("val_avisos"))),
      h("button", { class: "btn", onclick: () => exportar(lista()) }, "⭳ " + t("val_exportar")));
    const L = lista();
    tabela.innerHTML = "";
    if (!L.length) { tabela.append(h("p", { class: "vazio ok" }, "✓ " + t("val_ok"))); return; }
    tabela.append(h("div", { class: "card-s" }, `${L.length} ${t("val_problemas").toLowerCase()}`), h("table", { class: "tabela" },
      h("thead", {}, h("tr", {}, [t("val_gravidade"), t("val_ficha"), t("val_registo"), t("val_campo"), t("val_regra"), t("val_valor"), ""].map(x => h("th", {}, x)))),
      h("tbody", {}, L.slice(0, 1000).map(i => h("tr", {},
        h("td", {}, h("span", { class: "tag " + i.grav }, t(i.grav))),
        h("td", {}, tr(S.cfg.fontes.datasets[i.ds].nome, S.lang)),
        h("td", {}, nomeRegisto(i.rec)),
        h("td", { title: i.campo }, i.campo === "geometria" ? (S.lang === "en" ? "Location" : "Localização") : rotuloCampo(i.ds, i.tabela, i.campo)),
        h("td", {}, t(i.regra)), h("td", {}, String(i.valor)),
        h("td", {}, linkEditar(i.rec) ? h("a", { href: linkEditar(i.rec), target: "_blank", rel: "noopener" }, t("val_editar")) : ""))))));
  };
  const lista = () => issues.filter(i => (!st.ds || i.ds === st.ds) && (!st.regra || i.regra === st.regra) && (!st.grav || i.grav === st.grav));
  desenhar();
}

function exportar(L) {
  const rows = L.map(i => ({ gravidade: t(i.grav), ficha: tr(S.cfg.fontes.datasets[i.ds].nome, S.lang), tabela: i.tabela, registo: nomeRegisto(i.rec),
    globalid: (i.rec.a.globalid || ""), objectid: i.rec.a.objectid ?? "", campo: i.campo, regra: t(i.regra), valor: i.valor, editar: linkEditar(i.rec) || "" }));
  download(`validacao_${new Date().toISOString().slice(0, 10)}.csv`, toCSV(rows, Object.keys(rows[0] || { gravidade: 1 })), "text/csv");
}

/* ---------------- Estado das fontes ---------------- */
function renderFontes(pg) {
  pg.append(h("p", {}, t("fontes_intro")), h("button", { class: "btn", onclick: async () => { pg.innerHTML = `<div class="loading">${t("carregando")}</div>`; await recarregarDados(); renderTecnica(document.querySelector("#app"), "fontes"); } }, "↻ " + (S.lang === "en" ? "Reload data" : "Recarregar dados")));
  const grid = h("div", { class: "fontes" });
  for (const ds of DATASETS) {
    const D = S.data[ds] || {}, c = S.cfg.fontes.datasets[ds] || {};
    const est = D.estado || "vazio";
    let ult = null; for (const r of D.main || []) if (r.d._data && (!ult || r.d._data > ult)) ult = r.d._data;
    const esperados = Object.keys((S.schema[ds] && S.schema[ds].tables.main.fields) || {}).filter(f => !(S.schema[ds].tables.main.fields[f].type || "").startsWith("geo"));
    const falta = D.meta && D.meta.campos ? esperados.filter(f => !D.meta.campos.some(x => x.toLowerCase() === f.toLowerCase())) : [];
    grid.append(h("div", { class: "fonte card" },
      h("div", { class: "card-t" }, tr(c.nome, S.lang), h("span", { class: "tag " + est }, t({ ok: "fonte_ok", demo: "fonte_demo", vazio: "fonte_vazio", erro: "fonte_erro" }[est] || est))),
      h("div", { class: "card-s mono" }, c.url || "—"),
      D.msg ? h("p", { class: "erro-txt" }, D.msg) : null,
      h("table", { class: "tabela mini" }, h("tbody", {},
        h("tr", {}, h("td", {}, S.lang === "en" ? "Main table" : "Tabela principal"), h("td", { class: "num" }, (D.main || []).length)),
        Object.entries(D.tables || {}).map(([tb, rows]) => h("tr", {}, h("td", {}, tb), h("td", { class: "num" }, rows.length))),
        h("tr", {}, h("td", {}, t("ultimo_registo")), h("td", {}, fmtDate(ult, S.lang))))),
      falta.length ? h("details", {}, h("summary", {}, `${t("campos_em_falta")} (${falta.length})`), h("p", { class: "mono" }, falta.join(", "))) : null));
  }
  pg.append(grid);
}
