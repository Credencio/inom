// Dashboard: cálculo de indicadores, gráficos (ECharts), mapa (Leaflet), tabelas e filtros cruzados.
import { S, DATASETS, ORDEM_PROVINCIAS, vista, linhas, valores, get, rotulo, rotuloCampo, ordemLista, campoSchema,
  temFiltros, invalidar, chaveGlobal, dataDe, descricaoFiltros } from "./data.js";
import { UI, LISTAS_VIRTUAIS } from "./i18n.js";
import { $, $$, h, esc, num, fmt, fmtDate, tr, geomCenter, normName } from "./util.js";

const t = k => UI[S.lang][k] || k;
let instancias = [];
let mapas = [];

/* ================= Cálculo ================= */
function passaFiltroLocal(r, f) {
  if (!f || !f.campo) return true;
  const vs = valores(r, f.campo, true);
  const hit = (f.valores || []).some(v => vs.includes(String(v)));
  return f.nao ? !hit : hit;
}

function somar(rows, campo) { let s = 0, n = 0; for (const r of rows) { const v = num(get(r, campo)); if (v !== null) { s += v; n++; } } return { s, n }; }

function medir(rows, m, total) {
  const med = m.medida || "contagem";
  if (med === "contagem") return rows.length;
  if (med === "soma") return somar(rows, m.campo).s;
  if (med === "media") { const { s, n } = somar(rows, m.campo); return n ? s / n : null; }
  if (med === "razao") { const a = somar(rows, m.campo).s, b = somar(rows, m.campo2).s; return b ? (a / b) * (m.formato === "pct" ? 100 : 1) : null; }
  if (med === "percentagem_registos") return total && total.length ? (rows.length / total.length) * 100 : null;
  if (med === "distintos") { const set = new Set(); rows.forEach(r => valores(r, m.campo).forEach(v => set.add(v))); return set.size; }
  return null;
}

function linhasDe(m, excluir = "") {
  const ds = m.dataset, tab = m.tabela || "main";
  let rows = linhas(ds, tab, excluir);
  return rows;
}

export function kpiValor(k) {
  const ds = k.dataset;
  if (k.medida === "especial") return especial(k.especial);
  let rows = linhasDe(k);
  if (k.medida === "percentagem") {
    const base = rows, sel = rows.filter(r => passaFiltroLocal(r, k.filtro));
    if (!base.length) return null;
    if (k.campo) { const a = somar(sel, k.campo).s, b = somar(base, k.campo).s; return b ? (a / b) * 100 : null; }
    return (sel.length / base.length) * 100;
  }
  rows = rows.filter(r => passaFiltroLocal(r, k.filtro));
  return medir(rows, k, rows);
}

function especial(nome) {
  const plots = linhas("levantamento", "registro_plot");
  const areaHa = plots.length * (Number(S.cfg.dashboard.areaQuadricula_m2 || 100) / 10000);
  const vivas = linhas("levantamento", "Medicoes").filter(r => !["cepo", "MN"].includes(String(get(r, "condicao") || "")));
  if (nome === "lev_densidade") return areaHa ? vivas.length / areaHa : null;
  if (nome === "lev_area_basal") {
    const set = new Set(vivas);
    let ab = 0;
    for (const c of linhas("levantamento", "caules")) {
      if (!set.has(c.parent)) continue;
      const dap = num(get(c, "dap_caule_calc")) ?? num(get(c, "dap_caule"));
      if (dap) ab += Math.PI * Math.pow(dap / 200, 2);
    }
    return areaHa ? ab / areaHa : null;
  }
  return null;
}

function dimsDe(g) { return Array.isArray(g.dimensao) ? g.dimensao : [g.dimensao]; }
function chaveCross(g) {
  const d = g.dimensao;
  if (Array.isArray(d) || !d) return "";
  const gk = chaveGlobal(d);
  if (gk) return "global:" + gk;
  return `${g.dataset}|${g.tabela || "main"}|${d}`;
}

function catsDaLinha(r, g) {
  const dims = dimsDe(g);
  if (dims.length === 1) return valores(r, dims[0], !!g.incluirVazios);
  const out = [];
  for (const d of dims) for (const v of valores(r, d)) out.push(d + "::" + v);
  return out;
}

export function rotuloCat(g, code, ds) {
  const dims = dimsDe(g);
  if (dims.length > 1) { const i = code.indexOf("::"); return rotulo(ds || g.dataset, g.tabela || "main", code.slice(0, i), code.slice(i + 2)); }
  return rotulo(ds || g.dataset, g.tabela || "main", dims[0], code);
}

export function dadosGrafico(g, opts = {}) {
  const excl = opts.completo ? "" : chaveCross(g);
  let defs;
  if (g.series && g.series.length) defs = g.series.map(s => ({ ...g, ...s, series: undefined, nome: s.nome }));
  else defs = [{ ...g, nome: g.titulo }];
  const series = [];
  const allCats = new Map();
  for (const sd of defs) {
    const ds = sd.dataset || g.dataset;
    const m = { ...sd, dataset: ds };
    const rows = linhasDe(m, ds === g.dataset ? excl : (excl.startsWith("global:") ? excl : "")).filter(r => passaFiltroLocal(r, m.filtro));
    const grupos = new Map();
    for (const r of rows) for (const c of catsDaLinha(r, g)) { if (!grupos.has(c)) grupos.set(c, []); grupos.get(c).push(r); }
    if (g.serieDimensao) {
      const sub = new Map();
      for (const r of rows) for (const sv of valores(r, g.serieDimensao, true)) { if (!sub.has(sv)) sub.set(sv, []); sub.get(sv).push(r); }
      let subKeys = [...sub.keys()];
      const ord = ordemLista(ds, m.tabela || "main", g.serieDimensao);
      if (ord) subKeys.sort((a, b) => (ord.indexOf(a) + 1 || 999) - (ord.indexOf(b) + 1 || 999));
      for (const sk of subKeys) {
        const sset = new Set(sub.get(sk));
        const vals = new Map();
        for (const [c, rs] of grupos) { const v = medir(rs.filter(r => sset.has(r)), m, rows); vals.set(c, v); allCats.set(c, (allCats.get(c) || 0) + (v || 0)); }
        series.push({ nome: rotulo(ds, m.tabela || "main", g.serieDimensao, sk), codigo: sk, vals, campoSerie: g.serieDimensao, lista: listaCor(ds, m.tabela || "main", g.serieDimensao) });
      }
    } else {
      const vals = new Map();
      for (const [c, rs] of grupos) { const v = medir(rs, m, rows); vals.set(c, v); allCats.set(c, (allCats.get(c) || 0) + (v || 0)); }
      series.push({ nome: tr(sd.nome, S.lang), vals, cor: sd.cor, ds });
    }
  }
  if (g.comoPercentagem) for (const s of series) { const tot = [...s.vals.values()].reduce((a, b) => a + (b || 0), 0); for (const [k, v] of s.vals) s.vals.set(k, tot ? (v / tot) * 100 : null); }
  let cats = [...allCats.keys()];
  const ordem = g.ordem || "valor";
  if (ordem === "provincias") cats.sort((a, b) => (ORDEM_PROVINCIAS.indexOf(a) + 1 || 99) - (ORDEM_PROVINCIAS.indexOf(b) + 1 || 99));
  else if (ordem === "cronologica") cats.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  else if (ordem === "alfabetica") cats.sort((a, b) => rotuloCat(g, a).localeCompare(rotuloCat(g, b)));
  else if (ordem === "lista") { const ord = ordemLista(g.dataset, g.tabela || "main", dimsDe(g)[0]) || []; cats.sort((a, b) => (ord.indexOf(a) + 1 || 999) - (ord.indexOf(b) + 1 || 999)); }
  else cats.sort((a, b) => (allCats.get(b) || 0) - (allCats.get(a) || 0));
  const lim = g.limite || (g.tipo === "pizza" ? 10 : 20);
  if (cats.length > lim) cats = cats.slice(0, lim);
  return { cats, labels: cats.map(c => rotuloCat(g, c)), series };
}

function listaCor(ds, tab, campo) { const c = campoSchema(ds, tab, campo); return (c && c.list) || campo; }

/* ================= Cores ================= */
const PALETA = ["#2f6fdb", "#e8743b", "#1f9e74", "#4b3fa8", "#d4a017", "#13a3b8", "#c2417a", "#7a8b99", "#8a6d1f", "#5bb35b", "#a04ec2", "#e05c5c"];
const CORES_LISTA = {
  nivel_degradacao: { 1: "#6e2a0c", 2: "#b8501f", 3: "#e8743b", 4: "#f3b48a" },
  _estado_monitoria: { em_recuperacao: "#1f9e74", abaixo_limiar: "#e8743b", sem_dados: "#2f6fdb", sem_monitoria: "#b7bfc7" },
  tipo_material: { muda: "#4b3fa8", propagulo: "#2f6fdb" },
  regeneracao: { RCI: "#a8dcc5", RCII: "#1f9e74", RCIII: "#0b4a3a" },
  escala_dominancia: { minima: "#d6eef2", baixa: "#9fd8e2", moderada: "#4fb6c9", alta: "#13879b", muito_alta: "#0a5562" },
  estado_plantas: { bom: "#1f9e74", razoavel: "#d4a017", mau: "#e05c5c" },
  condicao: { I: "#1f9e74", PC: "#d4a017", SC: "#e8743b", cepo: "#8a3b12", MN: "#7a8b99" }
};
function corSerie(s, i) {
  if (s.cor) return s.cor;
  if (s.lista && CORES_LISTA[s.lista] && CORES_LISTA[s.lista][s.codigo]) return CORES_LISTA[s.lista][s.codigo];
  return PALETA[i % PALETA.length];
}
function corCat(g, code, i) {
  const l = listaCor(g.dataset, g.tabela || "main", dimsDe(g)[0]);
  if (CORES_LISTA[l] && CORES_LISTA[l][code]) return CORES_LISTA[l][code];
  return PALETA[i % PALETA.length];
}

function selecionado(g) {
  const d = g.dimensao; if (Array.isArray(d) || !d) return null;
  const gk = chaveGlobal(d);
  if (gk) return S.filters[gk] || null;
  const cf = S.cross.find(c => c.ds === g.dataset && c.tabela === (g.tabela || "main") && c.campo === d);
  return cf ? cf.valor : null;
}

/* ================= Opções ECharts ================= */
const curto = (s, n = 30) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function opcaoGrafico(g, dados, pdf = false) {
  const fo = { formato: g.formato, decimais: g.decimais };
  const f = v => fmt(v, fo, S.lang);
  const sel = pdf ? null : selecionado(g);
  const op = (code) => (sel === null || sel === undefined || String(code) === String(sel) ? 1 : 0.3);
  const base = { animation: !pdf, textStyle: { fontFamily: "Inter, Segoe UI, Arial, sans-serif" }, color: PALETA,
    tooltip: { confine: true, trigger: g.tipo === "pizza" ? "item" : "axis", axisPointer: { type: "shadow" } } };
  if (!dados.cats.length) return { ...base, title: { text: t("sem_dados"), left: "center", top: "middle", textStyle: { color: "#8a96a3", fontSize: 13, fontWeight: "normal" } } };
  if (g.tipo === "pizza") {
    const s = dados.series[0];
    return { ...base,
      tooltip: { trigger: "item", formatter: p => `${esc(p.name)}<br><b>${f(p.value)}</b> (${p.percent}%)` },
      legend: { type: "scroll", bottom: 0, textStyle: { fontSize: 11 }, formatter: n => curto(n, 34) },
      series: [{ type: "pie", radius: ["42%", "70%"], center: ["50%", "44%"], avoidLabelOverlap: true,
        label: { formatter: p => `${p.percent}%`, fontSize: 11 }, itemStyle: { borderColor: "#fff", borderWidth: 2 },
        data: dados.cats.map((c, i) => ({ name: dados.labels[i], value: s.vals.get(c) ?? 0, itemStyle: { color: corCat(g, c, i), opacity: op(c) } })) }] };
  }
  const horiz = g.tipo === "barrash" || g.tipo === "empilhado";
  const empilhar = g.tipo === "empilhado";
  const multi = dados.series.length > 1;
  const catAxis = { type: "category", data: dados.labels, axisLabel: { fontSize: 11, formatter: v => curto(v, horiz ? 30 : 14), interval: 0, rotate: !horiz && dados.labels.length > 6 ? 30 : 0 }, axisTick: { show: false }, inverse: horiz };
  const valAxis = { type: "value", axisLabel: { fontSize: 10, formatter: v => fmt(v, { formato: g.formato === "pct" ? "pct" : undefined }, S.lang) }, splitLine: { lineStyle: { color: "#eef1f4" } } };
  const series = dados.series.map((s, i) => ({
    name: s.nome, type: g.tipo === "linha" ? "line" : "bar", stack: empilhar && multi ? "total" : undefined, smooth: true,
    barMaxWidth: 26, itemStyle: { color: corSerie(s, i) },
    label: { show: !empilhar || !multi, position: horiz ? "right" : "top", fontSize: 10, formatter: p => (p.value === null ? "" : f(p.value)) },
    emphasis: { focus: "series" },
    data: dados.cats.map(c => ({ value: s.vals.get(c) ?? null, itemStyle: { opacity: op(c) } }))
  }));
  return { ...base,
    legend: multi ? { top: 0, type: "scroll", textStyle: { fontSize: 11 } } : undefined,
    grid: { left: 8, right: horiz ? 46 : 12, top: multi ? 30 : 12, bottom: 8, containLabel: true },
    tooltip: { ...base.tooltip, formatter: ps => { const arr = Array.isArray(ps) ? ps : [ps]; return `<b>${esc(arr[0].name)}</b><br>` + arr.filter(p => p.value !== null && p.value !== undefined).map(p => `${p.marker} ${esc(p.seriesName)}: <b>${f(p.value)}</b>`).join("<br>"); } },
    xAxis: horiz ? valAxis : catAxis, yAxis: horiz ? catAxis : valAxis, series };
}

/* ================= Interacção (filtro cruzado) ================= */
function clicar(g, dados, idx) {
  const code = dados.cats[idx]; if (code === undefined) return;
  let campo = Array.isArray(g.dimensao) ? null : g.dimensao, valor = code;
  if (!campo) { const i = code.indexOf("::"); campo = code.slice(0, i); valor = code.slice(i + 2); }
  const gk = chaveGlobal(campo);
  if (gk && gk !== "inst") {
    S.filters[gk] = S.filters[gk] === valor ? "" : valor;
    if (gk === "provincia") { S.filters.distrito = ""; S.filters.posto = ""; }
    if (gk === "distrito") S.filters.posto = "";
  } else if (gk === "inst") {
    S.filters.inst = S.filters.inst === valor ? "" : valor;
  } else {
    const tab = g.tabela || "main";
    const i = S.cross.findIndex(c => c.ds === g.dataset && c.tabela === tab && c.campo === campo);
    if (i >= 0 && S.cross[i].valor === valor) S.cross.splice(i, 1);
    else {
      if (i >= 0) S.cross.splice(i, 1);
      S.cross.push({ ds: g.dataset, tabela: tab, campo, valor, rotulo: rotulo(g.dataset, tab, campo, valor) });
    }
  }
  invalidar(); actualizar();
}

/* ================= Renderização ================= */
let paginaActual = null, raiz = null;

export function paginaPorId(id) {
  const ps = S.cfg.dashboard.paginas;
  return ps.find(p => p.id === id) || ps[0];
}

export function renderDashboard(el, paginaId) {
  raiz = el; paginaActual = paginaPorId(paginaId);
  el.innerHTML = "";
  const ps = S.cfg.dashboard.paginas;
  el.append(
    h("div", { class: "dash-head" },
      h("div", { class: "subtabs" }, ps.map(p => h("a", { href: `#/dashboard/${p.id}`, class: p.id === paginaActual.id ? "active" : "" }, tr(p.titulo, S.lang)))),
      h("div", { class: "dash-tools" },
        h("span", { id: "dados-ate", class: "nota" }),
        h("button", { class: "btn", onclick: () => import("./exportar.js").then(m => m.abrirDownload(paginaActual)) }, "⭳ " + t("descarregar")),
        h("button", { class: "btn primary", onclick: () => import("./report.js").then(m => m.abrirPDF(paginaActual)) }, "⎙ " + t("exportar_pdf")))),
    h("div", { id: "filtros", class: "filtros" }),
    h("div", { id: "chips", class: "chips" }),
    h("div", { id: "kpis", class: "kpis" }),
    h("div", { id: "grelha", class: "grelha" }),
    h("p", { class: "nota" }, t("clique_filtrar"))
  );
  renderFiltros();
  actualizar();
}

function opt(v, l, sel) { return h("option", { value: v, selected: String(v) === String(sel) }, l); }

function renderFiltros() {
  const box = $("#filtros"); if (!box) return;
  box.innerHTML = "";
  const f = S.filters, lang = S.lang, ch = S.choices;
  const presentes = k => { const s = new Set(); for (const ds of DATASETS) for (const r of (S.data[ds] && S.data[ds].main) || []) if (r.d[k]) s.add(r.d[k]); return s; };
  const provs = presentes("_provincia");
  const provOps = Object.keys(ch.provincia || {}).filter(p => provs.has(p)).sort((a, b) => (ORDEM_PROVINCIAS.indexOf(a) + 1 || 99) - (ORDEM_PROVINCIAS.indexOf(b) + 1 || 99));
  const dists = presentes("_distrito"), postos = presentes("_posto");
  const distOps = Object.entries(ch.distrito || {}).filter(([k, v]) => dists.has(k) && (!f.provincia || v.provincia === f.provincia)).map(([k]) => k);
  const postoOps = Object.entries(ch.posto_adm || {}).filter(([k, v]) => postos.has(k) && (!f.distrito || v.distrito === f.distrito) && (!f.provincia || v.provincia === f.provincia)).map(([k]) => k);
  const anos = [...presentes("_ano")].sort().reverse();
  const insts = new Map();
  for (const ds of DATASETS) for (const r of (S.data[ds] && S.data[ds].main) || []) for (const [k, v] of r.d._inst || []) if (!insts.has(k)) insts.set(k, v);
  const lab = (l, k) => (ch[l] && ch[l][k] ? ch[l][k][lang] || ch[l][k].pt : k);
  const sel = (id, label, ops, val, onch) => h("label", { class: "filtro" }, h("span", {}, label),
    h("select", { id, onchange: e => onch(e.target.value) }, opt("", t("todos"), val), ops));
  box.append(
    sel("f-prov", t("f_provincia"), provOps.map(p => opt(p, lab("provincia", p), f.provincia)), f.provincia, v => { f.provincia = v; f.distrito = ""; f.posto = ""; mudou(); }),
    sel("f-dist", t("f_distrito"), distOps.sort((a, b) => lab("distrito", a).localeCompare(lab("distrito", b))).map(d => opt(d, lab("distrito", d), f.distrito)), f.distrito, v => { f.distrito = v; f.posto = ""; mudou(); }),
    sel("f-posto", t("f_posto"), postoOps.sort((a, b) => lab("posto_adm", a).localeCompare(lab("posto_adm", b))).map(d => opt(d, lab("posto_adm", d), f.posto)), f.posto, v => { f.posto = v; mudou(); }),
    sel("f-ano", t("f_ano"), anos.map(a => opt(a, a, f.ano)), f.ano, v => { f.ano = v; mudou(); }),
    sel("f-inst", t("f_inst"), [...insts.values()].sort((a, b) => a.localeCompare(b)).map(v => opt(v, v, f.inst)), f.inst, v => { f.inst = v; mudou(); })
  );
}

function mudou() { invalidar(); renderFiltros(); actualizar(); }

function renderChips() {
  const box = $("#chips"); if (!box) return;
  box.innerHTML = "";
  if (!temFiltros()) return;
  for (const c of S.cross) {
    box.append(h("span", { class: "chip" }, `${rotuloCampo(c.ds, c.tabela, c.campo)}: ${c.rotulo}`,
      h("button", { title: "×", onclick: () => { S.cross = S.cross.filter(x => x !== c); invalidar(); actualizar(); } }, "×")));
  }
  box.append(h("button", { class: "btn link", onclick: () => { Object.keys(S.filters).forEach(k => (S.filters[k] = "")); S.cross = []; mudou(); } }, t("limpar")));
}

export function actualizar() {
  if (!raiz || !paginaActual) return;
  renderFiltros(); renderChips();
  instancias.forEach(i => i.dispose()); instancias = [];
  mapas.forEach(m => m.remove()); mapas = [];
  const pg = paginaActual, lang = S.lang;
  const kb = $("#kpis"); kb.innerHTML = "";
  for (const k of pg.kpis || []) {
    const v = kpiValor(k);
    kb.append(h("div", { class: "kpi" }, h("div", { class: "kpi-t" }, tr(k.titulo, lang)), h("div", { class: "kpi-s" }, tr(k.subtitulo, lang)),
      h("div", { class: "kpi-v" }, fmt(v, { formato: k.formato, decimais: k.decimais }, lang))));
  }
  kb.style.display = (pg.kpis || []).length ? "" : "none";
  const gr = $("#grelha"); gr.innerHTML = "";
  for (const g of pg.graficos || []) {
    const card = h("div", { class: "card w" + String(g.largura || "1/3").replace("/", "-") },
      h("div", { class: "card-t" }, tr(g.titulo, lang)), g.subtitulo ? h("div", { class: "card-s" }, tr(g.subtitulo, lang)) : null);
    const corpo = h("div", { class: "card-b" });
    card.append(corpo); gr.append(card);
    try { renderGrafico(g, corpo); } catch (e) { console.error(g.id, e); corpo.append(h("div", { class: "vazio" }, "⚠ " + e.message)); }
  }
  const dt = $("#dados-ate");
  if (dt) { let mx = null; for (const ds of DATASETS) for (const r of (S.data[ds] && S.data[ds].main) || []) if (r.d._data && (!mx || r.d._data > mx)) mx = r.d._data; dt.textContent = mx ? `${t("dados_ate")} ${fmtDate(mx, lang)}` : ""; }
}

function renderGrafico(g, corpo) {
  if (g.tipo === "mapa") return renderMapa(g, corpo);
  if (g.tipo === "tabela") return renderTabela(g, corpo);
  if (g.tipo === "cobertura") return renderCobertura(g, corpo);
  if (g.tipo === "texto") { corpo.innerHTML = window.marked ? window.marked.parse(tr(g.texto, S.lang)) : esc(tr(g.texto, S.lang)); corpo.classList.add("texto"); return; }
  const dados = dadosGrafico(g);
  const alt = g.altura || Math.max(240, g.tipo === "barrash" || g.tipo === "empilhado" ? 40 + dados.cats.length * 26 : 280);
  const div = h("div", { class: "echart", style: `height:${alt}px` });
  corpo.append(div);
  if (!window.echarts) { div.textContent = "ECharts não carregou"; return; }
  const inst = window.echarts.init(div, null, { renderer: "canvas" });
  inst.setOption(opcaoGrafico(g, dados));
  inst.on("click", p => { if (p.componentType === "series") clicar(g, dados, p.dataIndex); });
  instancias.push(inst);
}

window.addEventListener("resize", () => { instancias.forEach(i => i.resize()); mapas.forEach(m => m.invalidateSize()); });

function renderMapa(g, corpo) {
  const div = h("div", { class: "mapa", style: `height:${g.altura || 360}px` });
  corpo.append(div);
  if (!window.L) { div.textContent = "Leaflet não carregou"; return; }
  const L = window.L;
  const map = L.map(div, { scrollWheelZoom: false, attributionControl: true }).setView([-18.5, 36.5], 5);
  const pos = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { attribution: "© OpenStreetMap © CARTO", maxZoom: 19 }).addTo(map);
  const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "Esri World Imagery", maxZoom: 19 });
  const over = {}; const bounds = L.latLngBounds([]);
  for (const ds of g.camadas || [g.dataset]) {
    const cfg = S.cfg.fontes.datasets[ds] || {}; const cor = cfg.cor || "#2f6fdb";
    const grp = L.featureGroup();
    const rows = ds === "levantamento" ? linhas(ds, "registro_plot") : vista(ds).main;
    for (const r of rows) {
      let geom = r.g;
      if (!geom) continue;
      const nome = r.d._rotulo || (r.root && r.root.d._rotulo) || "";
      const info = `<b>${esc(tr(cfg.nome, S.lang))}</b><br>${esc(nome)}<br>${esc(rotulo(ds, "main", "_provincia", get(r, "_provincia") || ""))} · ${esc(rotulo(ds, "main", "_distrito", get(r, "_distrito") || ""))}` +
        (r.d._area_ha ? `<br>${fmt(r.d._area_ha, {}, S.lang)} ha` : "");
      let lyr;
      if (geom.type === "Point") lyr = L.circleMarker([geom.coordinates[1], geom.coordinates[0]], { radius: 5, color: "#fff", weight: 1, fillColor: cor, fillOpacity: 0.9 });
      else {
        lyr = L.geoJSON(geom, { style: { color: cor, weight: 1.5, fillColor: cor, fillOpacity: 0.35 } });
        const c = geomCenter(geom);
        if (c) grp.addLayer(L.circleMarker(c, { radius: 4, color: cor, weight: 1, fillColor: cor, fillOpacity: 0.8 }).bindTooltip(esc(nome)).bindPopup(info));
      }
      lyr.bindTooltip(esc(nome)).bindPopup(info);
      grp.addLayer(lyr);
    }
    if (grp.getLayers().length) { grp.addTo(map); bounds.extend(grp.getBounds()); }
    over[`<span class="leg" style="background:${cor}"></span>${esc(tr(cfg.nome, S.lang))}`] = grp;
  }
  L.control.layers({ "Mapa": pos, "Satélite": sat }, over, { collapsed: true }).addTo(map);
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.1), { maxZoom: 9 });
  mapas.push(map);
  setTimeout(() => map.invalidateSize(), 100);
}

export function valorCelula(ds, tab, r, campo) {
  const v = get(r, campo);
  if (v === null || v === undefined || v === "") return "";
  if (campo === "_rotulo") return String(v);
  const f = campoSchema(ds, tab, campo);
  if (f && (f.type === "date" || f.type === "datetime")) return fmtDate(dataDe(v), S.lang);
  if (campo === "_provincia" || campo === "_distrito" || campo === "_posto" || campo === "_estado_monitoria" || campo === "_ativo" || (f && (f.list || f.file))) {
    return valores(r, campo).map(x => rotulo(ds, tab, campo, x)).join(", ");
  }
  if (typeof v === "number") return fmt(v, {}, S.lang);
  return String(v);
}

function renderTabela(g, corpo) {
  const ds = g.dataset, tab = g.tabela || "main";
  const cols = (g.colunas || ["_rotulo"]).map(c => (typeof c === "string" ? { campo: c } : c));
  let rows = linhas(ds, tab);
  let ordem = { i: -1, dir: 1 };
  const wrap = h("div", { class: "tabela-wrap" });
  const contador = h("div", { class: "card-s" });
  const desenhar = () => {
    let rs = rows;
    if (ordem.i >= 0) {
      const c = cols[ordem.i].campo;
      rs = [...rows].sort((a, b) => { const va = get(a, c), vb = get(b, c); const na = num(va), nb = num(vb);
        return (na !== null && nb !== null ? na - nb : String(va ?? "").localeCompare(String(vb ?? ""))) * ordem.dir; });
    }
    const max = 300;
    wrap.innerHTML = "";
    const tbl = h("table", { class: "tabela" },
      h("thead", {}, h("tr", {}, cols.map((c, i) => h("th", { onclick: () => { ordem = { i, dir: ordem.i === i ? -ordem.dir : 1 }; desenhar(); } },
        tr(c.titulo, S.lang) || rotuloCampo(ds, tab, c.campo), ordem.i === i ? (ordem.dir > 0 ? " ▲" : " ▼") : "")))),
      h("tbody", {}, rs.slice(0, max).map(r => h("tr", {}, cols.map(c => h("td", {}, valorCelula(ds, tab, r, c.campo)))))));
    wrap.append(tbl);
    contador.textContent = `${rs.length} ${t("registos")}` + (rs.length > max ? ` (${max} ${S.lang === "en" ? "shown" : "mostrados"})` : "");
  };
  desenhar();
  corpo.append(contador, wrap);
}

function renderCobertura(g, corpo) {
  const dss = DATASETS.filter(d => S.data[d] && S.data[d].main);
  const provs = new Set();
  const cont = {}; const ult = {};
  for (const ds of dss) for (const r of vista(ds).main) {
    const p = r.d._provincia || ""; provs.add(p);
    cont[p] = cont[p] || {}; cont[p][ds] = (cont[p][ds] || 0) + 1;
    if (r.d._data && (!ult[p] || r.d._data > ult[p])) ult[p] = r.d._data;
  }
  const ordem = [...provs].sort((a, b) => (ORDEM_PROVINCIAS.indexOf(a) + 1 || 99) - (ORDEM_PROVINCIAS.indexOf(b) + 1 || 99));
  const tot = {};
  const tbl = h("table", { class: "tabela" },
    h("thead", {}, h("tr", {}, h("th", {}, t("f_provincia")), dss.map(d => h("th", {}, tr(S.cfg.fontes.datasets[d].nome, S.lang))), h("th", {}, t("ultimo_registo")))),
    h("tbody", {}, ordem.map(p => h("tr", {}, h("td", {}, rotulo("restauracao", "main", "_provincia", p)),
      dss.map(d => { const v = (cont[p] && cont[p][d]) || 0; tot[d] = (tot[d] || 0) + v; return h("td", { class: "num" }, v || ""); }),
      h("td", {}, fmtDate(ult[p], S.lang))))),
    h("tfoot", {}, h("tr", {}, h("td", {}, "Total"), dss.map(d => h("td", { class: "num" }, tot[d] || 0)), h("td", {}))));
  corpo.append(h("div", { class: "tabela-wrap" }, tbl));
}

/* Dados analisados (para exportação) */
export function tabelaAnalisada(g) {
  if (["mapa", "texto"].includes(g.tipo)) return null;
  if (g.tipo === "tabela") {
    const ds = g.dataset, tab = g.tabela || "main";
    const cols = (g.colunas || []).map(c => (typeof c === "string" ? c : c.campo));
    return { nome: tr(g.titulo, S.lang), linhas: linhas(ds, tab).map(r => Object.fromEntries(cols.map(c => [rotuloCampo(ds, tab, c), valorCelula(ds, tab, r, c)]))) };
  }
  if (g.tipo === "cobertura") {
    const out = [];
    for (const ds of DATASETS) for (const r of vista(ds).main) out.push({ p: r.d._provincia, ds });
    const m = {};
    out.forEach(o => { const k = rotulo("restauracao", "main", "_provincia", o.p); m[k] = m[k] || {}; const n = tr(S.cfg.fontes.datasets[o.ds].nome, S.lang); m[k][n] = (m[k][n] || 0) + 1; });
    return { nome: tr(g.titulo, S.lang), linhas: Object.entries(m).map(([k, v]) => ({ [t("f_provincia")]: k, ...v })) };
  }
  const d = dadosGrafico(g, { completo: true });
  const catNome = Array.isArray(g.dimensao) ? t("categoria") : rotuloCampo(g.dataset, g.tabela || "main", g.dimensao);
  return { nome: tr(g.titulo, S.lang), linhas: d.cats.map((c, i) => { const o = { [catNome]: d.labels[i] }; d.series.forEach(s => { const v = s.vals.get(c); o[s.nome] = v === null || v === undefined ? null : Math.round(v * 100) / 100; }); return o; }) };
}

export { descricaoFiltros };
