// Leitura dos Feature Services do ArcGIS (ou dos dados de demonstração), normalização e motor de filtros.
import { areaHa, normName, num, tr } from "./util.js";
import { LISTAS_VIRTUAIS, VIRTUAIS_CAMPOS } from "./i18n.js";
import { gerarDemo } from "./demo.js";

export const S = {
  cfg: null, schema: null, choices: null, lang: "pt",
  data: {},            // chave -> { estado, msg, main:[], tables:{}, meta }
  filters: { provincia: "", distrito: "", posto: "", ano: "", inst: "" },
  cross: [],           // [{ds, tabela, campo, valor, rotulo}]
  versao: 0,
  auth: null
};

export const DATASETS = ["viveiros", "degradadas", "restauracao", "monitoria", "levantamento", "ervas"];
export const ORDEM_PROVINCIAS = ["cabo_delgado", "nampula", "zambézia", "sofala", "inhambane", "gaza", "maputo_província", "maputo_cidade"];

/* ---------------- Leitura ---------------- */
async function getJSON(url, params = {}, token) {
  const u = new URL(url);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  if (token) u.searchParams.set("token", token);
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "Erro do serviço");
  return j;
}

function serviceRoot(url) {
  return String(url).trim().replace(/\/+$/, "").replace(/\/\d+$/, "").replace(/\?.*$/, "");
}

async function queryAll(base, id, isLayer, token) {
  const out = []; const page = 1000; let offset = 0;
  for (let guard = 0; guard < 200; guard++) {
    const params = { where: "1=1", outFields: "*", returnGeometry: isLayer ? "true" : "false", outSR: "4326",
      f: isLayer ? "geojson" : "json", resultOffset: offset, resultRecordCount: page };
    const j = await getJSON(`${base}/${id}/query`, params, token);
    const feats = isLayer ? (j.features || []).map(f => ({ attributes: f.properties || {}, geometry: f.geometry || null }))
                          : (j.features || []).map(f => ({ attributes: f.attributes || {}, geometry: null }));
    out.push(...feats);
    const more = isLayer ? (j.properties && j.properties.exceededTransferLimit) || feats.length === page : j.exceededTransferLimit || feats.length === page;
    if (!more || !feats.length) break;
    offset += feats.length;
  }
  return out;
}

export async function lerArcGIS(cfgDs) {
  const base = serviceRoot(cfgDs.url);
  const token = cfgDs.token || "";
  const meta = await getJSON(base, { f: "json" }, token);
  const items = [...(meta.layers || []).map(l => ({ ...l, isLayer: true })), ...(meta.tables || []).map(t => ({ ...t, isLayer: false }))]
    .sort((a, b) => a.id - b.id);
  if (!items.length) throw new Error("O serviço não tem camadas nem tabelas");
  const mainItem = items.find(i => i.id === 0) || items[0];
  const raw = { main: await queryAll(base, mainItem.id, mainItem.isLayer, token), tables: {}, meta: { nomes: {} } };
  for (const it of items) {
    if (it === mainItem) continue;
    raw.tables[it.name] = await queryAll(base, it.id, it.isLayer, token);
  }
  // campos existentes (para a área técnica)
  try {
    const info = await getJSON(`${base}/${mainItem.id}`, { f: "json" }, token);
    raw.meta.campos = (info.fields || []).map(f => f.name);
    raw.meta.editInfo = info.editingInfo || null;
  } catch { /* opcional */ }
  return raw;
}

/* ---------------- Normalização ---------------- */
function lowerize(attrs) {
  const a = {};
  for (const [k, v] of Object.entries(attrs || {})) { a[k] = v; const l = k.toLowerCase(); if (!(l in a)) a[l] = v; }
  return a;
}

function mkRec(ds, tabela, raw) {
  const a = lowerize(raw.attributes);
  return { ds, tabela, a, k: Object.keys(raw.attributes || {}), g: raw.geometry || null, id: a.globalid || a.GlobalID || a.objectid, pid: a.parentglobalid || null, parent: null, root: null, d: {}, kids: {} };
}

export function campoAno(ds) { return (S.cfg.fontes.datasets[ds] || {}).campoAno || ""; }

function anoDe(v) {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "number" ? new Date(v) : new Date(String(v));
  return isNaN(d) ? null : d.getFullYear();
}
export function dataDe(v) {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "number" ? new Date(v) : new Date(String(v));
  return isNaN(d) ? null : d;
}

export function normalizar(ds, raw) {
  const main = raw.main.map(r => mkRec(ds, "main", r));
  const tables = {};
  const byId = new Map(main.map(r => [String(r.id).toLowerCase(), r]));
  for (const [t, rows] of Object.entries(raw.tables || {})) {
    tables[t] = rows.map(r => mkRec(ds, t, r));
    tables[t].forEach(r => byId.set(String(r.id).toLowerCase(), r));
  }
  for (const rows of Object.values(tables)) for (const r of rows) {
    const p = r.pid ? byId.get(String(r.pid).toLowerCase()) : null;
    r.parent = p || null;
    if (p) (p.kids[r.tabela] = p.kids[r.tabela] || []).push(r);
  }
  for (const rows of Object.values(tables)) for (const r of rows) {
    let x = r; for (let i = 0; i < 10 && x.parent; i++) x = x.parent;
    r.root = x.tabela === "main" ? x : null;
  }
  for (const rows of Object.values(tables)) for (let i = rows.length - 1; i >= 0; i--) if (!rows[i].root) rows.splice(i, 1);
  main.forEach(r => (r.root = r));
  const cfgDs = S.cfg.fontes.datasets[ds] || {};
  for (const r of main) derivar(ds, r, cfgDs);
  return { main, tables, meta: raw.meta || {} };
}

function valorBruto(r, campo) {
  if (campo in r.a) return r.a[campo];
  const l = campo.toLowerCase();
  return l in r.a ? r.a[l] : undefined;
}

function derivar(ds, r, cfgDs) {
  const d = r.d;
  d._provincia = valorBruto(r, "provincia") || "";
  d._distrito = valorBruto(r, "distrito") || "";
  d._posto = valorBruto(r, "posto_adm") || "";
  // ano
  let ano = null; const ca = cfgDs.campoAno || "";
  if (ca.includes(".")) {
    const [t, c] = ca.split(".");
    const anos = (r.kids[t] || []).map(k => anoDe(valorBruto(k, c))).filter(Boolean);
    ano = anos.length ? Math.min(...anos) : null;
  } else if (ca) ano = anoDe(valorBruto(r, ca));
  if (!ano) ano = anoDe(valorBruto(r, "CreationDate")) || anoDe(valorBruto(r, "creationdate"));
  d._ano = ano ? String(ano) : "";
  d._data = dataDe(valorBruto(r, "EditDate") ?? valorBruto(r, "CreationDate"));
  // instituições
  const inst = new Map();
  const add = v => { if (v === null || v === undefined) return; const s = String(v).trim(); if (s && !/^sem informa/i.test(s)) inst.set(normName(s), s); };
  for (const c of cfgDs.camposInstituicao || []) {
    if (c.includes(".")) { const [t, f] = c.split("."); (r.kids[t] || []).forEach(k => add(valorBruto(k, f))); }
    else add(valorBruto(r, c));
  }
  d._inst = inst;
  d._area_ha = r.g ? areaHa(r.g) : null;
  if (d._area_ha !== null) d._area_ha = Math.round(d._area_ha * 100) / 100;
  // específicos
  if (ds === "viveiros") {
    const fim = dataDe(valorBruto(r, "ano_enceramento"));
    d._ativo = (valorBruto(r, "tempo") === "Temporario" && fim && fim < new Date()) ? "nao" : "sim";
    d._rotulo = valorBruto(r, "nome_viveiro") || "";
    d._pessoas = (num(valorBruto(r, "num_homens")) || 0) + (num(valorBruto(r, "num_mulheres")) || 0);
  } else if (ds === "degradadas") {
    const hum = ["causa_degradacao_actividades_de_producao_e_extraccao", "causa_degradacao_infraestruturas_e_uso_do_solo", "causa_degradacao_poluicao_e_impactos_ambientais"]
      .some(c => String(valorBruto(r, c) || "").trim());
    d._causa_humana = hum ? "sim" : "nao";
    d._rotulo = [valorBruto(r, "nome_floresta") || "Floresta sem nome", valorBruto(r, "nome_comunidade") || ""].filter(Boolean).join(" · ");
  } else if (ds === "restauracao") {
    d._pessoas = (num(valorBruto(r, "num_homens")) || 0) + (num(valorBruto(r, "num_mulheres")) || 0);
    d._rotulo = valorBruto(r, "nome_do_projecto") || "";
  } else if (ds === "monitoria") {
    d._rotulo = [valorBruto(r, "nome_projecto") || "", isoLocal(valorBruto(r, "data1"))].filter(Boolean).join(" · ");
    d._pessoas = (num(valorBruto(r, "participantes_homens")) || 0) + (num(valorBruto(r, "participantes_mulheres")) || 0);
  } else if (ds === "levantamento") {
    d._rotulo = valorBruto(r, "nome_comunidade") || valorBruto(r, "id_levantamento_ecologico") || "";
  } else if (ds === "ervas") {
    d._rotulo = valorBruto(r, "nome_tapete") || valorBruto(r, "nome_comunidade") || "";
  }
}
function isoLocal(v) { const d = dataDe(v); return d ? d.toISOString().slice(0, 10) : ""; }

// Ligações entre fichas (depois de todas lidas)
export function ligar() {
  for (const ds of DATASETS) {
    const c = S.cfg.fontes.datasets[ds] || {};
    const D = S.data[ds]; if (!D || !D.main) continue;
    if (c.pai && S.data[c.pai.dataset] && S.data[c.pai.dataset].main) {
      const P = new Map(S.data[c.pai.dataset].main.map(p => [String(valorBruto(p, c.pai.campoPai) ?? ""), p]));
      for (const r of D.main) {
        const p = P.get(String(valorBruto(r, c.pai.campo) ?? "")) || null;
        r.link = p;
        if (p) {
          for (const k of ["_provincia", "_distrito", "_posto"]) if (!r.d[k]) r.d[k] = p.d[k];
          if (!r.d._inst.size) r.d._inst = new Map(p.d._inst);
          if (r.d._area_ha === null) r.d._area_pai = p.d._area_ha;
        }
      }
    }
  }
  // estado de monitoria de cada área de restauração (última visita)
  const R = S.data.restauracao, M = S.data.monitoria;
  if (R && R.main) {
    const lim = Number(S.cfg.dashboard.limiarSobrevivencia ?? 50);
    const ult = new Map();
    for (const m of (M && M.main) || []) {
      if (!m.link) continue;
      const dt = dataDe(valorBruto(m, "data1")) || new Date(0);
      const prev = ult.get(m.link);
      if (!prev || dt > prev.dt) ult.set(m.link, { dt, m });
    }
    for (const r of R.main) {
      const u = ult.get(r);
      if (!u) { r.d._estado_monitoria = "sem_monitoria"; r.d._sobrev = null; continue; }
      let s = num(valorBruto(u.m, "sobrevivencia_media"));
      if (s === null) {
        const ps = u.m.kids.parcelas || [];
        const pl = ps.reduce((a, p) => a + (num(valorBruto(p, "plantas_plantadas")) || 0), 0);
        const vv = ps.reduce((a, p) => a + (num(valorBruto(p, "plantas_vivas")) || 0), 0);
        s = pl > 0 ? (vv / pl) * 100 : null;
      }
      r.d._sobrev = s; r.d._ultima_visita = u.dt;
      r.d._estado_monitoria = s === null ? "sem_dados" : s >= lim ? "em_recuperacao" : "abaixo_limiar";
    }
  }
}

export async function carregarTudo(onProgress) {
  const cfg = S.cfg.fontes;
  let demo = null;
  for (const ds of DATASETS) {
    const c = cfg.datasets[ds] || {};
    S.data[ds] = { estado: "a_carregar", main: [], tables: {}, meta: {} };
    onProgress && onProgress();
    try {
      let raw;
      if (c.url && c.activo !== false) { raw = await lerArcGIS(c); S.data[ds].estado = "ok"; }
      else if (cfg.modoDemo) { demo = demo || gerarDemo(S.choices, S.schema); raw = demo[ds]; S.data[ds].estado = "demo"; }
      else { S.data[ds].estado = "vazio"; continue; }
      const n = normalizar(ds, raw);
      Object.assign(S.data[ds], n);
    } catch (e) {
      console.error(ds, e);
      S.data[ds].estado = "erro"; S.data[ds].msg = String(e.message || e);
    }
  }
  ligar();
  S.versao++;
}

/* ---------------- Acesso a valores e rótulos ---------------- */
export function campoSchema(ds, tabela, campo) {
  const sc = S.schema[ds]; if (!sc) return null;
  const t = sc.tables[tabela];
  if (t && t.fields[campo]) return t.fields[campo];
  for (const tt of Object.values(sc.tables)) if (tt.fields[campo]) return tt.fields[campo];
  return null;
}

export function get(r, campo) {
  if (!r) return undefined;
  if (campo.startsWith("_")) {
    if (campo in r.d) return r.d[campo];
    if (r.parent) return get(r.parent, campo);
    if (r.link) return get(r.link, campo);
    return undefined;
  }
  if (campo.startsWith("ano:")) { const a = anoDe(get(r, campo.slice(4))); return a ? String(a) : ""; }
  const v = valorBruto(r, campo);
  if (v !== undefined && v !== null && v !== "") return v;
  if (r.parent) return get(r.parent, campo);
  if (r.link && r.tabela === "main") { const lv = valorBruto(r.link, campo); if (lv !== undefined) return lv; }
  return v;
}

export function valores(r, campo, incluirVazios = false) {
  if (campo === "_instituicao") { const m = r.root ? r.root.d._inst : r.d._inst; const l = m ? [...m.values()] : []; return l.length ? l : (incluirVazios ? [""] : []); }
  if (campo === "_dataset") return [r.ds];
  const v = get(r, campo);
  let arr;
  if (v === null || v === undefined || v === "") arr = [];
  else {
    const f = campo.startsWith("_") || campo.startsWith("ano:") ? null : campoSchema(r.ds, r.tabela, campo);
    arr = f && f.type === "select_multiple" ? String(v).split(/[,\s]+/).map(s => s.trim()).filter(Boolean) : [String(v)];
  }
  if (!arr.length && incluirVazios) arr = [""];
  return arr;
}

export function listaDoCampo(ds, tabela, campo) {
  if (VIRTUAIS_CAMPOS[campo]) return VIRTUAIS_CAMPOS[campo].list || null;
  if (campo.startsWith("ano:")) return null;
  const f = campoSchema(ds, tabela, campo);
  return f ? f.list || (f.file ? "file:" + f.file : null) : null;
}

export function rotulo(ds, tabela, campo, codigo) {
  const lang = S.lang;
  if (codigo === "" || codigo === null || codigo === undefined) return tr(LISTAS_VIRTUAIS._vazio[""], lang);
  if (campo === "_dataset") return tr(LISTAS_VIRTUAIS._dataset[codigo], lang) || codigo;
  const lista = listaDoCampo(ds, tabela, campo);
  if (!lista) return String(codigo);
  if (lista.startsWith("file:")) {
    const file = lista.slice(5);
    const alvo = file.startsWith("viveiros") ? ["viveiros", "id_viveiro"] : file.startsWith("areas_restauracao") ? ["restauracao", "id_area_restauracao"] : file.startsWith("areas_degradadas") ? ["degradadas", "id_area_degradada"] : null;
    if (alvo && S.data[alvo[0]] && S.data[alvo[0]].main) {
      const m = S.data[alvo[0]].main.find(x => String(valorBruto(x, alvo[1])) === String(codigo));
      if (m) return m.d._rotulo || String(codigo);
    }
    return String(codigo);
  }
  const L = LISTAS_VIRTUAIS[lista] || S.choices[lista];
  if (!L) return String(codigo);
  const e = L[codigo];
  return e ? (e[lang] || e.pt || String(codigo)) : String(codigo);
}

export function ordemLista(ds, tabela, campo) {
  const lista = listaDoCampo(ds, tabela, campo);
  if (!lista || lista.startsWith("file:")) return null;
  const L = LISTAS_VIRTUAIS[lista] || S.choices[lista];
  return L ? Object.keys(L) : null;
}

export function rotuloCampo(ds, tabela, campo) {
  if (VIRTUAIS_CAMPOS[campo]) return tr(VIRTUAIS_CAMPOS[campo], S.lang);
  if (campo.startsWith("ano:")) return (S.lang === "en" ? "Year of " : "Ano de ") + rotuloCampo(ds, tabela, campo.slice(4)).toLowerCase();
  const f = campoSchema(ds, tabela, campo);
  return f ? f.label : campo;
}

/* ---------------- Filtros ---------------- */
let cache = { v: -1, m: new Map() };
export function invalidar() { S.versao++; }

const MAPA_GLOBAL = { _provincia: "provincia", _distrito: "distrito", _posto: "posto", _ano: "ano", _instituicao: "inst" };
export function chaveGlobal(campo) { return MAPA_GLOBAL[campo] || null; }

function passaGlobal(r, saltar = "") {
  const f = { ...S.filters };
  if (saltar) f[saltar] = "";
  if (f.provincia && r.d._provincia !== f.provincia) return false;
  if (f.distrito && r.d._distrito !== f.distrito) return false;
  if (f.posto && r.d._posto !== f.posto) return false;
  if (f.ano && r.d._ano !== f.ano) return false;
  if (f.inst && !r.d._inst.has(normName(f.inst))) return false;
  return true;
}

function cfKey(cf) { return `${cf.ds}|${cf.tabela}|${cf.campo}`; }
function cfMatch(r, cf) { return valores(r, cf.campo, true).includes(cf.valor); }

// Devolve {main, tables} do dataset com os filtros aplicados; "excluir" = chave do filtro cruzado a ignorar
export function vista(ds, excluir = "", semFiltros = false) {
  if (cache.v !== S.versao) cache = { v: S.versao, m: new Map() };
  const key = ds + "#" + excluir + "#" + semFiltros;
  if (cache.m.has(key)) return cache.m.get(key);
  const D = S.data[ds];
  if (!D || !D.main) { const e = { main: [], tables: {} }; cache.m.set(key, e); return e; }
  if (semFiltros) { const e = { main: D.main, tables: D.tables }; cache.m.set(key, e); return e; }
  const cfs = S.cross.filter(c => c.ds === ds && cfKey(c) !== excluir);
  const saltar = excluir.startsWith("global:") ? excluir.slice(7) : "";
  let main = D.main.filter(r => passaGlobal(r, saltar));
  // filtros cruzados na tabela principal
  for (const cf of cfs.filter(c => c.tabela === "main")) main = main.filter(r => cfMatch(r, cf));
  // filtros cruzados em tabelas relacionadas
  const tabMatch = {};
  for (const cf of cfs.filter(c => c.tabela !== "main")) {
    const rows = (D.tables[cf.tabela] || []).filter(r => cfMatch(r, cf));
    tabMatch[cf.tabela] = tabMatch[cf.tabela] ? tabMatch[cf.tabela].filter(r => rows.includes(r)) : rows;
  }
  for (const rows of Object.values(tabMatch)) { const roots = new Set(rows.map(r => r.root)); main = main.filter(r => roots.has(r)); }
  // filtros cruzados de uma ficha "pai" (ex.: restauração -> monitoria)
  const pai = (S.cfg.fontes.datasets[ds] || {}).pai;
  if (pai && S.cross.some(c => c.ds === pai.dataset && cfKey(c) !== excluir)) {
    const keep = new Set(vista(pai.dataset, excluir).main);
    main = main.filter(r => r.link && keep.has(r.link));
  }
  const set = new Set(main);
  const tables = {};
  for (const [t, rows] of Object.entries(D.tables)) {
    tables[t] = rows.filter(r => {
      if (!set.has(r.root)) return false;
      for (const [mt, mrows] of Object.entries(tabMatch)) {
        let x = r, ok = null;
        while (x && x.tabela !== "main") { if (x.tabela === mt) { ok = mrows.includes(x); break; } x = x.parent; }
        if (ok === false) return false;
      }
      return true;
    });
  }
  const res = { main, tables };
  cache.m.set(key, res);
  return res;
}

export function linhas(ds, tabela, excluir = "") {
  const v = vista(ds, excluir);
  return tabela === "main" || !tabela ? v.main : (v.tables[tabela] || []);
}

export function temFiltros() {
  const f = S.filters; return !!(f.provincia || f.distrito || f.posto || f.ano || f.inst || S.cross.length);
}

export function descricaoFiltros() {
  const f = S.filters, L = [], lang = S.lang;
  const lab = (k, v) => `${k}: ${v}`;
  if (f.provincia) L.push(lab(lang === "en" ? "Province" : "Província", rotulo("restauracao", "main", "_provincia", f.provincia)));
  if (f.distrito) L.push(lab(lang === "en" ? "District" : "Distrito", rotulo("restauracao", "main", "_distrito", f.distrito)));
  if (f.posto) L.push(lab(lang === "en" ? "Post" : "Posto", rotulo("restauracao", "main", "_posto", f.posto)));
  if (f.ano) L.push(lab(lang === "en" ? "Year" : "Ano", f.ano));
  if (f.inst) L.push(lab(lang === "en" ? "Institution" : "Instituição", f.inst));
  for (const c of S.cross) L.push(`${rotuloCampo(c.ds, c.tabela, c.campo)}: ${c.rotulo}`);
  return L;
}

export function exportVal(r, campo) { return valorBruto(r, campo); }
