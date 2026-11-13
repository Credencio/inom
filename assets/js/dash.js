// Dashboard: cálculo de indicadores, gráficos (ECharts), mapa (Leaflet), tabelas e filtros cruzados.
import { S, DATASETS, ORDEM_PROVINCIAS, vista, linhas, valores, get, rotulo, rotuloCampo, ordemLista, campoSchema,
  temFiltros, invalidar, chaveGlobal, dataDe, descricaoFiltros } from "./data.js";
import { UI, LISTAS_VIRTUAIS } from "./i18n.js";
import { $, h, esc, num, fmt, fmtDate, tr, geomCenter, toCSV, download, imagem, comImagem } from "./util.js";
import { modal } from "./main.js";

const t = k => UI[S.lang][k] || k;
const L = (pt, en) => (S.lang === "en" ? en : pt);

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
function linhasDe(m, excluir = "") { return linhas(m.dataset, m.tabela || "main", excluir); }

export function kpiValor(k) {
  if (k.medida === "especial") return especial(k.especial);
  let rows = linhasDe(k);
  if (k.medida === "percentagem") {
    const sel = rows.filter(r => passaFiltroLocal(r, k.filtro));
    if (!rows.length) return null;
    if (k.campo) { const a = somar(sel, k.campo).s, b = somar(rows, k.campo).s; return b ? (a / b) * 100 : null; }
    return (sel.length / rows.length) * 100;
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
    const set = new Set(vivas); let ab = 0;
    for (const c of linhas("levantamento", "caules")) {
      if (!set.has(c.parent)) continue;
      const dap = num(get(c, "dap_caule_calc")) ?? num(get(c, "dap_caule"));
      if (dap) ab += Math.PI * Math.pow(dap / 200, 2);
    }
    return areaHa ? ab / areaHa : null;
  }
  return null;
}

// Valor de cada indicador por ano (para a mini-tendência)
function tendencias(kpis) {
  const anos = new Set();
  for (const ds of DATASETS) for (const r of (S.data[ds] && S.data[ds].main) || []) if (r.d._ano) anos.add(r.d._ano);
  const lista = [...anos].sort().slice(-6);
  if (lista.length < 2) return null;
  const guarda = S.filters.ano, out = kpis.map(() => []);
  for (const a of lista) { S.filters.ano = a; invalidar(); kpis.forEach((k, i) => out[i].push(kpiValor(k))); }
  S.filters.ano = guarda; invalidar();
  return { anos: lista, valores: out };
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
  const defs = g.series && g.series.length ? g.series.map(s => ({ ...g, ...s, series: undefined, nome: s.nome })) : [{ ...g, nome: g.titulo }];
  const series = [], allCats = new Map();
  for (const sd of defs) {
    const ds = sd.dataset || g.dataset, m = { ...sd, dataset: ds };
    const rows = linhasDe(m, ds === g.dataset ? excl : (excl.startsWith("global:") ? excl : "")).filter(r => passaFiltroLocal(r, m.filtro));
    const grupos = new Map();
    for (const r of rows) for (const c of catsDaLinha(r, g)) { if (!grupos.has(c)) grupos.set(c, []); grupos.get(c).push(r); }
    if (g.serieDimensao) {
      const sub = new Map();
      for (const r of rows) for (const sv of valores(r, g.serieDimensao, true)) { if (!sub.has(sv)) sub.set(sv, []); sub.get(sv).push(r); }
      let subKeys = [...sub.keys()];
      const ord = ordemLista(ds, m.tabela || "main", g.serieDimensao);
      if (ord) subKeys.sort((a, b) => (ord.indexOf(a) + 1 || 999) - (ord.indexOf(b) + 1 || 999));
      if (g.serieDimensao === "_provincia") subKeys.sort((a, b) => (ORDEM_PROVINCIAS.indexOf(a) + 1 || 99) - (ORDEM_PROVINCIAS.indexOf(b) + 1 || 99));
      for (const sk of subKeys) {
        const sset = new Set(sub.get(sk)), vals = new Map();
        for (const [c, rs] of grupos) { const v = medir(rs.filter(r => sset.has(r)), m, rows); vals.set(c, v); allCats.set(c, (allCats.get(c) || 0) + (v || 0)); }
        series.push({ nome: rotulo(ds, m.tabela || "main", g.serieDimensao, sk), codigo: sk, vals, lista: listaCor(ds, m.tabela || "main", g.serieDimensao) });
      }
    } else {
      const vals = new Map();
      for (const [c, rs] of grupos) { const v = medir(rs, m, rows); vals.set(c, v); allCats.set(c, (allCats.get(c) || 0) + (v || 0)); }
      const nome = sd.nome && tr(sd.nome, S.lang) ? tr(sd.nome, S.lang) : tr(LISTAS_VIRTUAIS._dataset[ds], S.lang) || ds;
      series.push({ nome, vals, cor: sd.cor || (defs.length === 1 ? g.cor : undefined), ds });
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
  if (g.acumulado) for (const s of series) { let acc = 0; for (const c of cats) { acc += s.vals.get(c) || 0; s.vals.set(c, acc); } }
  const lim = g.limite || ({ pizza: 10, sankey: 12, treemap: 30, area: 80, linha: 80 }[g.tipo] || 20);
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
  condicao: { I: "#1f9e74", PC: "#d4a017", SC: "#e8743b", cepo: "#8a3b12", MN: "#7a8b99" },
  _dataset: { degradadas: "#e8743b", restauracao: "#2f6fdb", monitoria: "#1f9e74", viveiros: "#4b3fa8", levantamento: "#8a6d1f", ervas: "#13a3b8" }
};
function corSerie(s, i) {
  if (s.cor) return s.cor;
  if (s.lista && CORES_LISTA[s.lista] && CORES_LISTA[s.lista][s.codigo]) return CORES_LISTA[s.lista][s.codigo];
  if (s.ds && CORES_LISTA._dataset[s.ds] && s.multiDs) return CORES_LISTA._dataset[s.ds];
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
const rgba = (hex, a) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return hex; const n = parseInt(m[1], 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
const curto = (s, n = 30) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
const FONTE = "Inter, Segoe UI, Arial, sans-serif";

export function opcaoGrafico(g, dados, pdf = false) {
  const fo = { formato: g.formato, decimais: g.decimais, compacto: g.compacto };
  const f = v => fmt(v, fo, S.lang);
  const sel = pdf ? null : selecionado(g);
  const op = code => (sel === null || sel === undefined || String(code) === String(sel) ? 1 : 0.28);
  const base = { animation: !pdf, animationDuration: 700, animationEasing: "cubicOut", animationDurationUpdate: 500,
    textStyle: { fontFamily: FONTE }, color: PALETA, tooltip: { confine: true, backgroundColor: "rgba(20,30,38,.92)", borderWidth: 0, textStyle: { color: "#fff", fontSize: 12 } } };
  if (g.tipo === "gauge") return opcaoGauge(g, base, pdf);
  if (!dados.cats.length) return { ...base, title: { text: t("sem_dados"), left: "center", top: "middle", textStyle: { color: "#8a96a3", fontSize: 13, fontWeight: "normal" } } };
  if (g.tipo === "pizza") {
    const valor = c => dados.series.reduce((a, s) => a + (s.vals.get(c) || 0), 0);
    const total = dados.cats.reduce((a, c) => a + valor(c), 0);
    return { ...base,
      tooltip: { ...base.tooltip, trigger: "item", formatter: p => `${esc(p.name)}<br><b>${f(p.value)}</b> (${p.percent}%)` },
      legend: { type: "scroll", bottom: 0, icon: "circle", itemWidth: 9, textStyle: { fontSize: 11 }, formatter: n => curto(n, 34) },
      graphic: [{ type: "text", left: "center", top: "37%", style: { text: f(total), fontSize: 20, fontWeight: 700, fill: "#1d2a33", fontFamily: FONTE, textAlign: "center" } },
                { type: "text", left: "center", top: "48%", style: { text: L("total", "total"), fontSize: 11, fill: "#7a8792", fontFamily: FONTE, textAlign: "center" } }],
      series: [{ id: "s0", type: "pie", radius: ["46%", "72%"], center: ["50%", "44%"], avoidLabelOverlap: true, padAngle: 1.5,
        itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 5 },
        label: { formatter: p => (p.percent >= 4 ? `${Math.round(p.percent)}%` : ""), fontSize: 11, color: "#3d4a55" }, labelLine: { length: 6, length2: 6 },
        emphasis: { scale: true, scaleSize: 6, label: { fontWeight: 700 } },
        data: dados.cats.map((c, i) => ({ name: dados.labels[i], value: valor(c), itemStyle: { color: g.dimensao === "_dataset" ? CORES_LISTA._dataset[c] : corCat(g, c, i), opacity: op(c) } })) }] };
  }
  if (g.tipo === "treemap") {
    const s = dados.series[0];
    return { ...base,
      tooltip: { ...base.tooltip, formatter: p => `${esc(p.name)}<br><b>${f(p.value)}</b>` },
      series: [{ id: "s0", type: "treemap", roam: false, nodeClick: false, breadcrumb: { show: false }, width: "100%", height: "100%", top: 0, left: 0,
        itemStyle: { borderColor: "#fff", borderWidth: 2, gapWidth: 2, borderRadius: 4 },
        label: { show: true, formatter: p => `{n|${curto(p.name, 26)}}\n{v|${f(p.value)}}`, rich: { n: { fontSize: 12, color: "#fff", fontWeight: 600 }, v: { fontSize: 11, color: "rgba(255,255,255,.85)", padding: [3, 0, 0, 0] } } },
        data: dados.cats.map((c, i) => ({ name: dados.labels[i], value: s.vals.get(c) || 0, itemStyle: { color: corCat(g, c, i), opacity: op(c) } })) }] };
  }
  if (g.tipo === "sankey") {
    const nos = new Map(), links = [];
    const no = (nome, lado) => { let n = nome; while (nos.has(n) && nos.get(n) !== lado) n += " "; nos.set(n, lado); return n; };
    const seriesTop = [...dados.series].sort((a, b) => [...b.vals.values()].reduce((x, y) => x + (y || 0), 0) - [...a.vals.values()].reduce((x, y) => x + (y || 0), 0)).slice(0, g.limiteSeries || 12);
    dados.cats.forEach((c, i) => { for (const s of seriesTop) { const v = s.vals.get(c); if (v > 0) links.push({ source: no(dados.labels[i], "a"), target: no(s.nome, "b"), value: v }); } });
    const cores = {}; let k = 0; for (const [n, lado] of nos) cores[n] = lado === "a" ? PALETA[k++ % PALETA.length] : "#9aa5b1";
    return { ...base,
      tooltip: { ...base.tooltip, trigger: "item", formatter: p => p.dataType === "edge" ? `${esc(p.data.source)} → ${esc(p.data.target)}<br><b>${f(p.value)}</b>` : `${esc(p.name)}<br><b>${f(p.value)}</b>` },
      series: [{ id: "s0", type: "sankey", left: 8, right: 130, top: 8, bottom: 8, nodeGap: 9, nodeWidth: 12, draggable: false, layoutIterations: 32,
        emphasis: { focus: "adjacency" }, lineStyle: { color: "gradient", curveness: 0.5, opacity: 0.35 },
        label: { fontSize: 11, color: "#33414e", formatter: p => curto(p.name.trim(), 28) },
        data: [...nos.keys()].map(n => ({ name: n, itemStyle: { color: cores[n], borderWidth: 0 } })), links }] };
  }
  const horiz = g.tipo === "barrash" || g.tipo === "empilhado";
  const empilhar = g.tipo === "empilhado";
  const linha = g.tipo === "linha" || g.tipo === "area";
  const multi = dados.series.length > 1;
  const catAxis = { type: "category", data: dados.labels, boundaryGap: !linha, inverse: horiz, axisTick: { show: false }, axisLine: { lineStyle: { color: "#d5dce1" } },
    axisLabel: { fontSize: 11, color: "#4a5865", formatter: v => curto(v, horiz ? 30 : 14), interval: linha ? "auto" : 0, rotate: !horiz && !linha && dados.labels.length > 6 ? 30 : 0 } };
  const valAxis = { type: "value", axisLabel: { fontSize: 10, color: "#7a8792", formatter: v => fmt(v, { formato: g.formato === "pct" ? "pct" : undefined, compacto: true }, S.lang) }, splitLine: { lineStyle: { color: "#eef1f4" } } };
  const series = dados.series.map((s, i) => {
    const cor = corSerie({ ...s, multiDs: multi }, i);
    const comum = { id: "s" + i, name: s.nome, data: dados.cats.map(c => ({ value: s.vals.get(c) ?? null, itemStyle: { opacity: op(c) } })) };
    if (linha) return { ...comum, type: "line", smooth: true, symbol: "circle", symbolSize: 6, showSymbol: dados.cats.length < 30, lineStyle: { width: 2.5, color: cor }, itemStyle: { color: cor },
      areaStyle: g.tipo === "area" && window.echarts ? { opacity: 1, color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: rgba(cor, 0.35) }, { offset: 1, color: rgba(cor, 0.02) }]) } : undefined,
      label: { show: !multi && dados.cats.length <= 12, position: "top", fontSize: 10, color: "#4a5865", formatter: p => (p.value === null ? "" : f(p.value)) }, emphasis: { focus: "series" } };
    return { ...comum, type: "bar", stack: empilhar && multi ? "total" : undefined, barMaxWidth: 24, barGap: "15%",
      itemStyle: { color: cor, borderRadius: empilhar && multi ? 0 : horiz ? [0, 4, 4, 0] : [4, 4, 0, 0] },
      label: { show: !empilhar || !multi, position: horiz ? "right" : "top", fontSize: 10, color: "#4a5865", formatter: p => (p.value === null ? "" : f(p.value)) },
      emphasis: { focus: multi ? "series" : "none", itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,.18)" } } };
  });
  return { ...base,
    legend: multi ? { top: 0, type: "scroll", icon: "roundRect", itemWidth: 12, itemHeight: 8, textStyle: { fontSize: 11 } } : undefined,
    grid: { left: 8, right: horiz ? 50 : 14, top: multi ? 32 : 16, bottom: 8, containLabel: true },
    tooltip: { ...base.tooltip, trigger: "axis", axisPointer: { type: linha ? "line" : "shadow", shadowStyle: { color: "rgba(31,122,92,.06)" } },
      formatter: ps => { const arr = Array.isArray(ps) ? ps : [ps]; return `<b>${esc(arr[0].name)}</b><br>` + arr.filter(p => p.value !== null && p.value !== undefined).map(p => `${p.marker} ${esc(p.seriesName)}: <b>${f(p.value)}</b>`).join("<br>") + (pdf ? "" : `<br><span style="opacity:.7;font-size:11px">${L("Clique para filtrar", "Click to filter")}</span>`); } },
    xAxis: horiz ? valAxis : catAxis, yAxis: horiz ? catAxis : valAxis, series };
}

function opcaoGauge(g, base, pdf) {
  const v = kpiValor(g);
  const max = g.max || 100, lim = g.usarLimiar ? Number(S.cfg.dashboard.limiarSobrevivencia ?? 50) : null;
  const cor = g.cor || (lim !== null && v !== null ? (v >= lim ? "#1f9e74" : "#e8743b") : "#2f6fdb");
  const seg = lim !== null ? [[lim / max, "#f6d2bd"], [1, "#cdebdc"]] : [[1, "#e7edf1"]];
  return { ...base, tooltip: { show: false },
    series: [{ id: "s0", type: "gauge", min: 0, max, startAngle: 210, endAngle: -30, radius: "92%", center: ["50%", "58%"],
      progress: { show: true, width: 16, roundCap: true, itemStyle: { color: cor } },
      axisLine: { roundCap: true, lineStyle: { width: 16, color: seg } },
      pointer: { show: false },
      axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
      anchor: { show: false }, title: { show: true, offsetCenter: [0, "34%"], fontSize: 11, color: "#7a8792" },
      detail: { valueAnimation: !pdf, offsetCenter: [0, "4%"], fontSize: 30, fontWeight: 700, color: "#1d2a33", fontFamily: FONTE, formatter: x => fmt(x, { formato: g.formato, decimais: g.decimais }, S.lang) },
      data: [{ value: v === null ? 0 : Math.round(v * 10) / 10, name: lim !== null ? `${L("Limiar", "Threshold")}: ${lim}%` : "" }] }] };
}

/* ================= Interacção (filtro cruzado) ================= */
function aplicarClique(g, campo, valor, tab) {
  if (!campo || campo === "_dataset") return;
  const gk = chaveGlobal(campo);
  if (gk) {
    S.filters[gk] = S.filters[gk] === valor ? "" : valor;
    if (gk === "provincia") { S.filters.distrito = ""; S.filters.posto = ""; }
    if (gk === "distrito") S.filters.posto = "";
  } else {
    const i = S.cross.findIndex(c => c.ds === g.dataset && c.tabela === tab && c.campo === campo);
    if (i >= 0 && S.cross[i].valor === valor) S.cross.splice(i, 1);
    else { if (i >= 0) S.cross.splice(i, 1); S.cross.push({ ds: g.dataset, tabela: tab, campo, valor, rotulo: rotulo(g.dataset, tab, campo, valor) }); }
  }
  invalidar(); actualizar();
}
function clicar(g, dados, p) {
  const tab = g.tabela || "main";
  if (g.tipo === "sankey") {
    if (p.dataType !== "node") return;
    const nome = p.name.trim();
    const i = dados.labels.indexOf(nome);
    if (i >= 0) return aplicarClique(g, g.dimensao, dados.cats[i], tab);
    const s = dados.series.find(x => x.nome === nome);
    if (s && s.codigo !== undefined) return aplicarClique(g, g.serieDimensao, s.codigo, tab);
    return;
  }
  const code = dados.cats[p.dataIndex]; if (code === undefined) return;
  let campo = Array.isArray(g.dimensao) ? null : g.dimensao, valor = code;
  if (!campo) { const i = code.indexOf("::"); campo = code.slice(0, i); valor = code.slice(i + 2); }
  aplicarClique(g, campo, valor, tab);
}

/* ================= Ícones ================= */
const ICONES = {
  mapa: "M12 21s-6-5.4-6-10a6 6 0 1 1 12 0c0 4.6-6 10-6 10zm0-8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  alerta: "M12 3 2 20h20L12 3zm0 6v5m0 3v.5",
  folha: "M5 19C5 10 11 5 20 4c-1 9-6 15-15 15zm0 0 7-7",
  muda: "M12 21v-8m0 0c0-4-3-6-7-6 0 4 3 6 7 6zm0-2c0-4 3-7 7-7 0 4-3 7-7 7z",
  viveiro: "M3 21h18M5 21V11l7-5 7 5v10M9 21v-5h6v5",
  grelha: "M4 4h16v16H4zM4 12h16M12 4v16",
  onda: "M2 12c3-3 5-3 8 0s5 3 8 0 3-2 4-1M2 17c3-3 5-3 8 0s5 3 8 0 3-2 4-1M2 7c3-3 5-3 8 0s5 3 8 0 3-2 4-1",
  pessoas: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-6 9c0-3.3 2.7-6 6-6s6 2.7 6 6M17 11a2.5 2.5 0 1 0 0-5M17 14c2.2.4 4 2.6 4 5",
  dinheiro: "M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 10v4m12-4v4",
  pct: "M5 19 19 5M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm10 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  arvore: "M12 22v-6m0 0c-4 0-7-2.5-7-6a7 7 0 0 1 14 0c0 3.5-3 6-7 6z",
  lista: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"
};
export function icone(nome, cls = "ic") {
  const d = ICONES[nome] || ICONES.lista;
  const s = h("span", { class: cls, "aria-hidden": "true" });
  s.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  return s;
}

function sparkSVG(vals) {
  const v = vals.map(x => (x === null || x === undefined ? 0 : x));
  const max = Math.max(...v, 1e-9), min = Math.min(...v, 0), W = 92, H = 26;
  const pts = v.map((x, i) => [(i / (v.length - 1)) * W, H - 3 - ((x - min) / (max - min || 1)) * (H - 6)]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><path d="${d} L${W} ${H} L0 ${H} Z" fill="currentColor" opacity=".12"/><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="2.6" fill="currentColor"/></svg>`;
}

const anteriores = new Map();
function animarNumero(el, de, para, opts) {
  if (para === null || para === undefined || !isFinite(para)) { el.textContent = fmt(para, opts, S.lang); return; }
  if (de === null || de === undefined || !isFinite(de) || matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = fmt(para, opts, S.lang); return; }
  const t0 = performance.now(), dur = 650;
  const passo = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(de + (para - de) * e, { ...opts, decimais: opts.decimais ?? (Math.abs(para) < 10 && !Number.isInteger(para) ? 1 : 0) }, S.lang); if (k < 1) requestAnimationFrame(passo); };
  requestAnimationFrame(passo);
}

/* ================= Renderização ================= */
let paginaActual = null, raiz = null;
const graficos = new Map(); // id -> {g, inst, div, corpo, card, dados}
let mapas = [];

export function paginaPorId(id) { const ps = S.cfg.dashboard.paginas; return ps.find(p => p.id === id) || ps[0]; }

/** Imagem de fundo do cabeçalho da página: escolhida na Gestão ou, por omissão, pelo tema da página. */
export function imagemPagina(p) {
  if (p.imagem) return p.imagem;
  if (/erva/.test(p.id)) return "ervas";
  if (p.id === "visao-geral" || p.id === "sobre-dados") return "hero";
  return "mangal";
}

export function renderDashboard(el, paginaId) {
  raiz = el; paginaActual = paginaPorId(paginaId);
  graficos.forEach(x => x.inst && x.inst.dispose()); graficos.clear();
  mapas.forEach(m => m.remove()); mapas = [];
  el.innerHTML = "";
  const ps = S.cfg.dashboard.paginas, pg = paginaActual, lang = S.lang;
  el.append(
    h("nav", { class: "pag-nav" }, ps.map(p => h("a", { href: `#/dashboard/${p.id}`, class: p.id === pg.id ? "active" : "" }, icone(p.icone || "lista"), h("span", {}, tr(p.titulo, lang))))),
    comImagem(h("section", { class: "pag-cab" },
      h("div", { class: "pag-tit" }, icone(pg.icone || "lista", "ic grande"), h("div", {}, h("h1", {}, tr(pg.titulo, lang)), pg.descricao ? h("p", {}, tr(pg.descricao, lang)) : null)),
      h("div", { class: "dash-tools" },
        h("span", { id: "dados-ate", class: "dados-ate" }),
        h("button", { class: "btn claro", onclick: () => import("./exportar.js").then(m => m.abrirDownload(paginaActual)) }, "⭳ " + t("descarregar")),
        h("button", { class: "btn destaque", onclick: () => import("./report.js").then(m => m.abrirPDF(paginaActual)) }, "⎙ " + t("exportar_pdf")))), imagem(S.cfg, imagemPagina(pg)), lang),
    h("div", { id: "filtros", class: "filtros" }),
    h("div", { id: "chips", class: "chips" }),
    h("div", { id: "kpis", class: "kpis" }),
    h("div", { id: "grelha", class: "grelha" }),
    h("p", { class: "nota" }, t("clique_filtrar")));
  const gr = $("#grelha");
  for (const g of pg.graficos || []) {
    const card = h("div", { class: "card w" + String(g.largura || "1/3").replace("/", "-") + " tipo-" + g.tipo });
    const corpo = h("div", { class: "card-b" });
    const ferramentas = h("div", { class: "card-ferr" });
    card.append(h("div", { class: "card-cab" }, h("div", {}, h("div", { class: "card-t" }, tr(g.titulo, lang)), g.subtitulo ? h("div", { class: "card-s" }, tr(g.subtitulo, lang)) : null), ferramentas), corpo);
    gr.append(card);
    graficos.set(g.id + "#" + (pg.graficos.indexOf(g)), { g, corpo, card, ferramentas });
  }
  actualizar();
}

function opt(v, l, sel) { return h("option", { value: v, selected: String(v) === String(sel) }, l); }

function renderFiltros() {
  const box = $("#filtros"); if (!box) return;
  box.innerHTML = "";
  const f = S.filters, lang = S.lang, ch = S.choices;
  const presentes = k => { const s = new Set(); for (const ds of DATASETS) for (const r of (S.data[ds] && S.data[ds].main) || []) if (r.d[k]) s.add(r.d[k]); return s; };
  const provs = presentes("_provincia"), dists = presentes("_distrito"), postos = presentes("_posto");
  const provOps = Object.keys(ch.provincia || {}).filter(p => provs.has(p)).sort((a, b) => (ORDEM_PROVINCIAS.indexOf(a) + 1 || 99) - (ORDEM_PROVINCIAS.indexOf(b) + 1 || 99));
  const distOps = Object.entries(ch.distrito || {}).filter(([k, v]) => dists.has(k) && (!f.provincia || v.provincia === f.provincia)).map(([k]) => k);
  const postoOps = Object.entries(ch.posto_adm || {}).filter(([k, v]) => postos.has(k) && (!f.distrito || v.distrito === f.distrito) && (!f.provincia || v.provincia === f.provincia)).map(([k]) => k);
  const anos = [...presentes("_ano")].sort().reverse();
  const insts = new Map();
  for (const ds of DATASETS) for (const r of (S.data[ds] && S.data[ds].main) || []) for (const [k, v] of r.d._inst || []) if (!insts.has(k)) insts.set(k, v);
  const lab = (l, k) => (ch[l] && ch[l][k] ? ch[l][k][lang] || ch[l][k].pt : k);
  const sel = (id, label, ops, val, onch) => h("label", { class: "filtro" + (val ? " activo" : "") }, h("span", {}, label),
    h("select", { id, onchange: e => onch(e.target.value) }, opt("", t("todos"), val), ops));
  box.append(
    h("div", { class: "filtros-t" }, icone("lista"), t("filtros")),
    sel("f-prov", t("f_provincia"), provOps.map(p => opt(p, lab("provincia", p), f.provincia)), f.provincia, v => { f.provincia = v; f.distrito = ""; f.posto = ""; mudou(); }),
    sel("f-dist", t("f_distrito"), distOps.sort((a, b) => lab("distrito", a).localeCompare(lab("distrito", b))).map(d => opt(d, lab("distrito", d), f.distrito)), f.distrito, v => { f.distrito = v; f.posto = ""; mudou(); }),
    sel("f-posto", t("f_posto"), postoOps.sort((a, b) => lab("posto_adm", a).localeCompare(lab("posto_adm", b))).map(d => opt(d, lab("posto_adm", d), f.posto)), f.posto, v => { f.posto = v; mudou(); }),
    sel("f-ano", t("f_ano"), anos.map(a => opt(a, a, f.ano)), f.ano, v => { f.ano = v; mudou(); }),
    sel("f-inst", t("f_inst"), [...insts.values()].sort((a, b) => a.localeCompare(b)).map(v => opt(v, v, f.inst)), f.inst, v => { f.inst = v; mudou(); }));
}
function mudou() { invalidar(); actualizar(); }

function renderChips() {
  const box = $("#chips"); if (!box) return;
  box.innerHTML = "";
  if (!temFiltros()) return;
  for (const c of S.cross) box.append(h("span", { class: "chip" }, `${rotuloCampo(c.ds, c.tabela, c.campo)}: ${c.rotulo}`,
    h("button", { title: "×", onclick: () => { S.cross = S.cross.filter(x => x !== c); invalidar(); actualizar(); } }, "×")));
  box.append(h("button", { class: "btn link", onclick: () => { Object.keys(S.filters).forEach(k => (S.filters[k] = "")); S.cross = []; mudou(); } }, "✕ " + t("limpar")));
}

function renderKPIs() {
  const pg = paginaActual, lang = S.lang, kb = $("#kpis");
  const ks = pg.kpis || [];
  kb.style.display = ks.length ? "" : "none";
  if (!ks.length) return;
  const tend = tendencias(ks);
  if (kb.children.length !== ks.length) {
    kb.innerHTML = "";
    ks.forEach(k => kb.append(h("div", { class: "kpi" },
      h("div", { class: "kpi-cab" }, icone(k.icone || "lista", "ic kpi-ic"), h("div", { class: "kpi-t" }, tr(k.titulo, lang))),
      h("div", { class: "kpi-v" }), h("div", { class: "kpi-s" }, tr(k.subtitulo, lang)), h("div", { class: "kpi-tend" }))));
  }
  ks.forEach((k, i) => {
    const card = kb.children[i], v = kpiValor(k), key = pg.id + k.id;
    const opts = { formato: k.formato, decimais: k.decimais, sufixo: k.sufixo, compacto: k.compacto };
    animarNumero(card.querySelector(".kpi-v"), anteriores.has(key) ? anteriores.get(key) : 0, v, opts);
    anteriores.set(key, v);
    const td = card.querySelector(".kpi-tend"); td.innerHTML = "";
    if (tend && k.tendencia !== false) {
      const vs = tend.valores[i], n = vs.length;
      if (vs.some(x => x)) {
        const sp = h("span", { class: "spark", title: tend.anos.map((y, j) => `${y}: ${fmt(vs[j], opts, lang)}`).join("\n") }); sp.innerHTML = sparkSVG(vs);
        const ia = S.filters.ano ? tend.anos.indexOf(S.filters.ano) : -1;
        let txt;
        if (ia > 0 && vs[ia] !== null && vs[ia - 1]) {
          const delta = ((vs[ia] - vs[ia - 1]) / Math.abs(vs[ia - 1])) * 100;
          txt = h("span", { class: "tend-txt" }, h("span", { class: "delta " + (delta >= 0 ? "sobe" : "desce") }, `${delta >= 0 ? "▲" : "▼"} ${fmt(Math.abs(delta), { decimais: 0 }, lang)}%`), ` vs ${tend.anos[ia - 1]}`);
        } else txt = h("span", { class: "tend-txt" }, `${tend.anos[0]}–${tend.anos[n - 1]} · ${L("por ano", "per year")}`);
        td.append(sp, txt);
      }
    }
  });
}

export function actualizar() {
  if (!raiz || !paginaActual) return;
  renderFiltros(); renderChips(); renderKPIs();
  mapas.forEach(m => m.remove()); mapas = [];
  for (const x of graficos.values()) {
    try { renderGrafico(x); } catch (e) { console.error(x.g.id, e); x.corpo.innerHTML = ""; x.corpo.append(h("div", { class: "vazio" }, "⚠ " + e.message)); }
  }
  const dt = $("#dados-ate");
  if (dt) { let mx = null; for (const ds of DATASETS) for (const r of (S.data[ds] && S.data[ds].main) || []) if (r.d._data && (!mx || r.d._data > mx)) mx = r.d._data; dt.textContent = mx ? `${t("dados_ate")} ${fmtDate(mx, S.lang)}` : ""; }
}

const ECHART = ["barras", "barrash", "empilhado", "pizza", "linha", "area", "treemap", "sankey", "gauge"];

function alturaDe(g, dados) {
  if (g.altura) return g.altura;
  if (g.tipo === "gauge") return 250;
  if (g.tipo === "barrash" || g.tipo === "empilhado") return Math.max(240, 48 + (dados ? dados.cats.length : 6) * 27);
  if (g.tipo === "sankey") return 340;
  return 290;
}

function renderGrafico(x) {
  const g = x.g, corpo = x.corpo;
  if (!ECHART.includes(g.tipo)) {
    corpo.innerHTML = "";
    if (g.tipo === "mapa") return renderMapa(g, corpo);
    if (g.tipo === "tabela") return renderTabela(g, corpo, x);
    if (g.tipo === "cobertura") return renderCobertura(g, corpo);
    if (g.tipo === "texto") { corpo.innerHTML = window.marked ? window.marked.parse(tr(g.texto, S.lang)) : esc(tr(g.texto, S.lang)); corpo.classList.add("texto"); }
    return;
  }
  const dados = g.tipo === "gauge" ? { cats: [1], labels: [""], series: [] } : dadosGrafico(g);
  x.dados = dados;
  if (!window.echarts) { corpo.textContent = "ECharts não carregou"; return; }
  if (!x.div) {
    x.div = h("div", { class: "echart" }); corpo.innerHTML = ""; corpo.append(x.div);
    x.div.style.height = alturaDe(g, dados) + "px";
    x.inst = window.echarts.init(x.div, null, { renderer: "canvas" });
    x.inst.on("click", p => { if (p.componentType === "series") clicar(g, x.dados, p); });
    x.ferramentas.append(
      h("button", { class: "fer", title: L("Ampliar", "Enlarge"), onclick: () => ampliar(g) }, "⤢"),
      h("button", { class: "fer", title: L("Descarregar imagem (PNG)", "Download image (PNG)"), onclick: () => png(x) }, "⭳"),
      h("button", { class: "fer", title: L("Ver os dados", "View data"), onclick: () => verDados(g) }, "☷"));
    x.inst.setOption(opcaoGrafico(g, dados));
    return;
  }
  const alt = alturaDe(g, dados);
  if (parseInt(x.div.style.height) !== alt) { x.div.style.height = alt + "px"; x.inst.resize(); }
  x.inst.setOption(opcaoGrafico(g, dados), { replaceMerge: ["series", "xAxis", "yAxis", "legend", "graphic", "title"] });
}

window.addEventListener("resize", () => { graficos.forEach(x => x.inst && x.inst.resize()); mapas.forEach(m => m.invalidateSize()); });

function ampliar(g) {
  const div = h("div", { class: "echart", style: "height:560px" });
  const m = modal(tr(g.titulo, S.lang), div, [{ texto: t("fechar") }], { largo: true, aoFechar: () => inst && inst.dispose() });
  let inst = null;
  setTimeout(() => { inst = window.echarts.init(div); const d = g.tipo === "gauge" ? { cats: [1], labels: [""], series: [] } : dadosGrafico(g); inst.setOption(opcaoGrafico(g, d)); inst.on("click", p => { if (p.componentType === "series") { clicar(g, d, p); m.fechar(); } }); }, 30);
}
async function png(x) {
  const url = x.inst.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#ffffff" });
  const blob = await (await fetch(url)).blob();
  download(`${(tr(x.g.titulo, S.lang) || "grafico").replace(/[^\p{L}\p{N}]+/gu, "_")}.png`, blob);
}
function verDados(g) {
  const ta = tabelaAnalisada(g);
  if (!ta || !ta.linhas.length) { modal(tr(g.titulo, S.lang), h("p", { class: "vazio" }, t("sem_dados"))); return; }
  const cols = Object.keys(ta.linhas[0]);
  const tbl = h("div", { class: "tabela-wrap alta" }, h("table", { class: "tabela" }, h("thead", {}, h("tr", {}, cols.map(c => h("th", {}, c)))),
    h("tbody", {}, ta.linhas.map(r => h("tr", {}, cols.map(c => h("td", { class: typeof r[c] === "number" ? "num" : "" }, typeof r[c] === "number" ? fmt(r[c], { decimais: 2 }, S.lang) : r[c] ?? "")))))));
  modal(tr(g.titulo, S.lang), tbl, [{ texto: "⭳ CSV", accao: () => download(`${ta.nome.replace(/[^\p{L}\p{N}]+/gu, "_")}.csv`, toCSV(ta.linhas, cols), "text/csv") }, { texto: t("fechar"), primario: true }], { largo: true });
}

function renderMapa(g, corpo) {
  const div = h("div", { class: "mapa", style: `height:${g.altura || 380}px` });
  corpo.append(div);
  if (!window.L) { div.textContent = "Leaflet não carregou"; return; }
  const Lf = window.L;
  const map = Lf.map(div, { scrollWheelZoom: false, attributionControl: true }).setView([-18.5, 36.5], 5);
  const pos = Lf.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", { attribution: "Esri, HERE, Garmin, © OpenStreetMap", maxZoom: 16 }).addTo(map);
  const pr = map.createPane("rotulos"); pr.style.zIndex = 450; pr.style.pointerEvents = "none";
  Lf.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, pane: "rotulos" }).addTo(map);
  const sat = Lf.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "Esri World Imagery", maxZoom: 19 });
  const over = {}; const bounds = Lf.latLngBounds([]); const legenda = [];
  const ZOOM_POL = g.zoomPoligonos || 12; // a partir deste zoom mostram-se só os contornos (sem o ponto central)
  const centrais = []; let temPol = false;
  const verArea = (b) => {
    const z0 = map.getZoom();
    map.flyToBounds(b, { maxZoom: 17, padding: [30, 30], duration: 1.2 });
    setTimeout(() => { if (map.getZoom() === z0) map.fitBounds(b, { maxZoom: 17, padding: [30, 30], animate: false }); }, 1600); // sem animação (ex.: separador em segundo plano)
    if (map.hasLayer(pos)) { map.removeLayer(pos); sat.addTo(map); }
  };
  for (const ds of g.camadas || [g.dataset]) {
    const cfg = S.cfg.fontes.datasets[ds] || {}; const cor = cfg.cor || "#2f6fdb";
    const grp = Lf.featureGroup(); const pts = Lf.featureGroup();
    const rows = ds === "levantamento" ? linhas(ds, "registro_plot") : vista(ds).main;
    let n = 0;
    for (const r of rows) {
      const geom = r.g; if (!geom) continue;
      n++;
      const nome = r.d._rotulo || (r.root && r.root.d._rotulo) || "";
      const info = `<div class="pop"><div class="pop-t" style="border-color:${cor}">${esc(tr(cfg.nome, S.lang))}</div><b>${esc(nome)}</b><br>${esc(rotulo(ds, "main", "_provincia", get(r, "_provincia") || ""))} · ${esc(rotulo(ds, "main", "_distrito", get(r, "_distrito") || ""))}` +
        (r.d._area_ha ? `<br>${fmt(r.d._area_ha, {}, S.lang)} ha` : "") + (r.d._estado_monitoria ? `<br>${esc(rotulo(ds, "main", "_estado_monitoria", r.d._estado_monitoria))}` : "") + `</div>`;
      if (geom.type === "Point") {
        const lyr = Lf.circleMarker([geom.coordinates[1], geom.coordinates[0]], { radius: 6, color: "#fff", weight: 1.5, fillColor: cor, fillOpacity: 0.9 });
        lyr.bindTooltip(esc(nome)).bindPopup(info); grp.addLayer(lyr);
        continue;
      }
      temPol = true;
      const pol = Lf.geoJSON(geom, { style: { color: cor, weight: 2.2, opacity: 1, fillColor: cor, fillOpacity: 0.32 } });
      const b = pol.getBounds();
      const popup = () => {
        const d = document.createElement("div"); d.innerHTML = info;
        const bt = document.createElement("button"); bt.className = "btn mini pop-btn"; bt.textContent = "⌖ " + (S.lang === "en" ? "Zoom to area" : "Ver a área");
        bt.onclick = () => { map.closePopup(); verArea(b); }; d.firstChild.append(bt); return d;
      };
      pol.bindTooltip(esc(nome), { sticky: true }).bindPopup(popup);
      pol.on("mouseover", e => e.layer.setStyle && e.layer.setStyle({ weight: 3.5, fillOpacity: 0.5 }));
      pol.on("mouseout", e => e.layer.setStyle && e.layer.setStyle({ weight: 2.2, fillOpacity: 0.32 }));
      grp.addLayer(pol);
      const c = geomCenter(geom);
      if (c) pts.addLayer(Lf.circleMarker(c, { radius: 5.5, color: "#fff", weight: 1.3, fillColor: cor, fillOpacity: 0.95 }).bindTooltip(esc(nome)).bindPopup(popup));
    }
    if (pts.getLayers().length) { grp.addLayer(pts); centrais.push([grp, pts]); }
    if (n) { grp.addTo(map); bounds.extend(grp.getBounds()); legenda.push([cor, tr(cfg.nome, S.lang), n]); }
    over[`<span class="leg" style="background:${cor}"></span>${esc(tr(cfg.nome, S.lang))}`] = grp;
  }
  Lf.control.layers({ [L("Mapa", "Map")]: pos, [L("Satélite", "Satellite")]: sat }, over, { collapsed: true }).addTo(map);
  if (legenda.length) {
    const ctl = Lf.control({ position: "bottomleft" });
    ctl.onAdd = () => { const d = document.createElement("div"); d.className = "legenda-mapa"; d.innerHTML = legenda.map(([c, n, k]) => `<div><span class="leg" style="background:${c}"></span>${esc(n)} <small>(${k})</small></div>`).join(""); return d; };
    ctl.addTo(map);
  }
  if (temPol) {
    const dica = Lf.control({ position: "topright" });
    let el;
    dica.onAdd = () => { el = document.createElement("div"); el.className = "dica-mapa"; return el; };
    dica.addTo(map);
    const zoomOk = () => {
      const z = map.getZoom(), perto = z >= ZOOM_POL;
      for (const [grp, pts] of centrais) { if (perto && grp.hasLayer(pts)) grp.removeLayer(pts); else if (!perto && !grp.hasLayer(pts)) grp.addLayer(pts); }
      el.textContent = perto ? L("A mostrar os contornos das áreas", "Showing area outlines") : L("Aproxime (ou clique num ponto › Ver a área) para ver o contorno das áreas", "Zoom in (or click a point › Zoom to area) to see area outlines");
      el.classList.toggle("ok", perto);
    };
    map.on("zoomend", zoomOk); zoomOk();
  }
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.1), { maxZoom: 9 });
  mapas.push(map);
  setTimeout(() => map.invalidateSize(), 120);
}

export function valorCelula(ds, tab, r, campo) {
  const v = get(r, campo);
  if (v === null || v === undefined || v === "") return "";
  if (campo === "_rotulo") return String(v);
  const f = campoSchema(ds, tab, campo);
  if (f && (f.type === "date" || f.type === "datetime")) return fmtDate(dataDe(v), S.lang);
  if (["_provincia", "_distrito", "_posto", "_estado_monitoria", "_ativo"].includes(campo) || (f && (f.list || f.file))) return valores(r, campo).map(x => rotulo(ds, tab, campo, x)).join(", ");
  if (typeof v === "number") return fmt(v, {}, S.lang);
  return String(v);
}

function renderTabela(g, corpo, x) {
  const ds = g.dataset, tab = g.tabela || "main";
  const cols = (g.colunas || ["_rotulo"]).map(c => (typeof c === "string" ? { campo: c } : c));
  const rows = linhas(ds, tab);
  let ordem = { i: -1, dir: 1 }, q = "";
  const wrap = h("div", { class: "tabela-wrap" }), contador = h("span", { class: "card-s" });
  const desenhar = () => {
    const qs = q.toLowerCase();
    let rs = qs ? rows.filter(r => cols.some(c => String(valorCelula(ds, tab, r, c.campo)).toLowerCase().includes(qs))) : rows;
    if (ordem.i >= 0) {
      const c = cols[ordem.i].campo;
      rs = [...rs].sort((a, b) => { const va = get(a, c), vb = get(b, c); const na = num(va), nb = num(vb);
        return (na !== null && nb !== null ? na - nb : String(va ?? "").localeCompare(String(vb ?? ""))) * ordem.dir; });
    }
    const max = 300;
    wrap.innerHTML = "";
    wrap.append(h("table", { class: "tabela" },
      h("thead", {}, h("tr", {}, cols.map((c, i) => h("th", { onclick: () => { ordem = { i, dir: ordem.i === i ? -ordem.dir : 1 }; desenhar(); } },
        tr(c.titulo, S.lang) || rotuloCampo(ds, tab, c.campo), ordem.i === i ? (ordem.dir > 0 ? " ▲" : " ▼") : "")))),
      h("tbody", {}, rs.slice(0, max).map(r => h("tr", {}, cols.map(c => { const v = valorCelula(ds, tab, r, c.campo); return h("td", { class: /^[\d\s.,%-]+$/.test(v) && v ? "num" : "" }, v); }))))));
    contador.textContent = `${rs.length} ${t("registos")}` + (rs.length > max ? ` (${max} ${L("mostrados", "shown")})` : "");
  };
  if (x && !x.ferramentas.childNodes.length) x.ferramentas.append(h("button", { class: "fer", title: L("Descarregar CSV", "Download CSV"), onclick: () => { const ta = tabelaAnalisada(g); download(`${ta.nome.replace(/[^\p{L}\p{N}]+/gu, "_")}.csv`, toCSV(ta.linhas, Object.keys(ta.linhas[0] || {})), "text/csv"); } }, "⭳"));
  corpo.append(h("div", { class: "tabela-barra" }, h("input", { type: "search", placeholder: t("procurar"), oninput: e => { q = e.target.value; desenhar(); } }), contador), wrap);
  desenhar();
}

function renderCobertura(g, corpo) {
  const dss = DATASETS.filter(d => S.data[d] && S.data[d].main);
  const provs = new Set(), cont = {}, ult = {};
  for (const ds of dss) for (const r of vista(ds).main) {
    const p = r.d._provincia || ""; provs.add(p);
    cont[p] = cont[p] || {}; cont[p][ds] = (cont[p][ds] || 0) + 1;
    if (r.d._data && (!ult[p] || r.d._data > ult[p])) ult[p] = r.d._data;
  }
  const ordem = [...provs].sort((a, b) => (ORDEM_PROVINCIAS.indexOf(a) + 1 || 99) - (ORDEM_PROVINCIAS.indexOf(b) + 1 || 99));
  let max = 1; for (const p of ordem) for (const d of dss) max = Math.max(max, (cont[p] && cont[p][d]) || 0);
  const tot = {};
  corpo.append(h("div", { class: "tabela-wrap" }, h("table", { class: "tabela calor" },
    h("thead", {}, h("tr", {}, h("th", {}, t("f_provincia")), dss.map(d => h("th", {}, tr(S.cfg.fontes.datasets[d].nome, S.lang))), h("th", {}, t("ultimo_registo")))),
    h("tbody", {}, ordem.map(p => h("tr", {}, h("td", {}, rotulo("restauracao", "main", "_provincia", p)),
      dss.map(d => { const v = (cont[p] && cont[p][d]) || 0; tot[d] = (tot[d] || 0) + v; return h("td", { class: "num", style: v ? `background:rgba(31,122,92,${(0.08 + 0.5 * v / max).toFixed(2)})` : "" }, v || ""); }),
      h("td", {}, fmtDate(ult[p], S.lang))))),
    h("tfoot", {}, h("tr", {}, h("td", {}, "Total"), dss.map(d => h("td", { class: "num" }, tot[d] || 0)), h("td", {}))))));
}

/* Dados analisados (exportação, "ver dados") */
export function tabelaAnalisada(g) {
  if (["mapa", "texto"].includes(g.tipo)) return null;
  if (g.tipo === "tabela") {
    const ds = g.dataset, tab = g.tabela || "main";
    const cols = (g.colunas || []).map(c => (typeof c === "string" ? c : c.campo));
    return { nome: tr(g.titulo, S.lang), linhas: linhas(ds, tab).map(r => Object.fromEntries(cols.map(c => [rotuloCampo(ds, tab, c), valorCelula(ds, tab, r, c)]))) };
  }
  if (g.tipo === "cobertura") {
    const m = {};
    for (const ds of DATASETS) for (const r of vista(ds).main) { const k = rotulo("restauracao", "main", "_provincia", r.d._provincia); m[k] = m[k] || {}; const n = tr(S.cfg.fontes.datasets[ds].nome, S.lang); m[k][n] = (m[k][n] || 0) + 1; }
    return { nome: tr(g.titulo, S.lang), linhas: Object.entries(m).map(([k, v]) => ({ [t("f_provincia")]: k, ...v })) };
  }
  if (g.tipo === "gauge") { const v = kpiValor(g); return { nome: tr(g.titulo, S.lang), linhas: [{ [L("Indicador", "Indicator")]: tr(g.titulo, S.lang), [L("Valor", "Value")]: v === null ? null : Math.round(v * 100) / 100 }] }; }
  const d = dadosGrafico(g, { completo: true });
  if (g.tipo === "sankey") {
    const out = [];
    d.cats.forEach((c, i) => d.series.forEach(s => { const v = s.vals.get(c); if (v > 0) out.push({ [rotuloCampo(g.dataset, g.tabela || "main", g.dimensao)]: d.labels[i], [rotuloCampo(g.dataset, g.tabela || "main", g.serieDimensao)]: s.nome, [L("Valor", "Value")]: Math.round(v * 100) / 100 }); }));
    return { nome: tr(g.titulo, S.lang), linhas: out };
  }
  const catNome = Array.isArray(g.dimensao) ? t("categoria") : rotuloCampo(g.dataset, g.tabela || "main", g.dimensao);
  return { nome: tr(g.titulo, S.lang), linhas: d.cats.map((c, i) => { const o = { [catNome]: d.labels[i] }; d.series.forEach(s => { const v = s.vals.get(c); o[s.nome] = v === null || v === undefined ? null : Math.round(v * 100) / 100; }); return o; }) };
}

export { descricaoFiltros };
