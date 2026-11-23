// Área "Os meus dados": cada entidade vê e descarrega apenas os seus registos.
// Abre sempre vazia. Só mostra dados depois de o código (da entidade ou de um técnico) e o nome da entidade corresponderem.
// Nota: é uma área de consulta, não uma área protegida (os serviços de dados são públicos).
import { S, DATASETS, DATASETS_APOIO, rotulo } from "./data.js";
import { h, tr, toCSV, download, normName, fmtDate, toast } from "./util.js";
import { linhaExport } from "./exportar.js";

const L = (pt, en) => (S.lang === "en" ? en : pt);
const FICHAS = () => DATASETS.filter(d => !DATASETS_APOIO.includes(d));
const MAX_TENTATIVAS = 5, ESPERA_S = 60;
let falhas = 0, bloqueadoAte = 0;
let mapaActual = null;

const val = (r, c) => (c in r.a ? r.a[c] : r.a[c.toLowerCase()]);
const limpaCod = s => String(s ?? "").trim().toUpperCase().replace(/\s+/g, "");
const limpaNome = s => normName(s).replace(/[^a-z0-9]+/g, "");

/* Confere código + nome. Devolve o registo da entidade ou null (sem dizer qual dos dois falhou). */
export function verificar(codigo, nome) {
  const E = S.data.entidades;
  if (!E || !E.main || !E.main.length) return null;
  const c = limpaCod(codigo), n = limpaNome(nome);
  if (!c || !n) return null;
  let ent = null;
  if (/^ENT-\d{3}$/.test(c)) ent = E.main.find(r => limpaCod(val(r, "codigo_entidade")) === c);
  else if (/^ENT-\d{3}-T\d{2}$/.test(c)) {
    const tec = (E.tables.tecnicos || []).find(t => limpaCod(val(t, "codigo_tecnico")) === c);
    if (!tec || String(val(tec, "estado_tecnico") || "") !== "validado") return null;
    ent = tec.root;
  }
  if (!ent || String(val(ent, "estado_entidade") || "") !== "validado") return null;
  if (limpaNome(val(ent, "nome_entidade")) !== n) return null;
  return ent;
}

/* Todos os registos da entidade, por ficha, incluindo as tabelas relacionadas. */
export function dadosDaEntidade(ent) {
  const cod = limpaCod(val(ent, "codigo_entidade"));
  const out = {};
  for (const ds of FICHAS()) {
    const D = S.data[ds]; if (!D || !D.main) continue;
    const main = D.main.filter(r => limpaCod(val(r, "codigo_entidade")) === cod);
    const set = new Set(main), tables = {};
    for (const [t, rows] of Object.entries(D.tables || {})) tables[t] = rows.filter(r => set.has(r.root));
    out[ds] = { main, tables };
  }
  // polígonos de mangal degradado ligados às áreas de restauração da entidade
  const P = S.data.poligonos;
  if (P && P.main && out.restauracao) {
    const minhas = new Set(out.restauracao.main);
    out.poligonos = { main: P.main.filter(r => r.link && minhas.has(r.link)), tables: {} };
  }
  return out;
}

function config() { return S.cfg.areaEntidade || {}; }

export function renderEntidade(app, aguardar) {
  if (mapaActual) { try { mapaActual.remove(); } catch { /* */ } mapaActual = null; }
  app.innerHTML = "";
  const A = config();
  const caixa = h("div", { class: "pagina estreita ent-acesso" });
  const resultado = h("div", { class: "ent-resultado" });
  const msg = h("p", { class: "ent-msg", role: "alert" });
  const inCod = h("input", { type: "text", autocomplete: "off", spellcheck: "false", placeholder: "ENT-001 / ENT-001-T01" });
  const inNome = h("input", { type: "text", autocomplete: "off", placeholder: L("Nome completo da entidade", "Full name of the organisation") });
  const btn = h("button", { class: "btn primary", type: "submit" }, L("Ver os meus dados", "Show my data"));
  const form = h("form", { class: "ent-form", onsubmit: async e => {
    e.preventDefault();
    msg.textContent = ""; resultado.innerHTML = "";
    const agora = Date.now();
    if (agora < bloqueadoAte) { msg.textContent = L(`Demasiadas tentativas. Tente de novo dentro de ${Math.ceil((bloqueadoAte - agora) / 1000)} segundos.`, `Too many attempts. Try again in ${Math.ceil((bloqueadoAte - agora) / 1000)} seconds.`); return; }
    if (!inCod.value.trim() || !inNome.value.trim()) { msg.textContent = L("Preencha os dois campos: o código e o nome da entidade.", "Fill in both fields: the code and the organisation name."); return; }
    btn.disabled = true; btn.textContent = L("A verificar…", "Checking…");
    try { await aguardar(); } catch { /* */ }
    btn.disabled = false; btn.textContent = L("Ver os meus dados", "Show my data");
    const ent = verificar(inCod.value, inNome.value);
    if (!ent) {
      falhas++;
      if (falhas >= MAX_TENTATIVAS) { bloqueadoAte = Date.now() + ESPERA_S * 1000; falhas = 0; }
      msg.textContent = L("O código e o nome não correspondem a uma entidade validada. Confirme os dois e tente de novo.", "The code and name do not match a validated organisation. Check both and try again.");
      return;
    }
    falhas = 0;
    inCod.value = ""; inNome.value = "";
    caixa.style.display = "none";
    mostrar(resultado, ent, () => { resultado.innerHTML = ""; if (mapaActual) { try { mapaActual.remove(); } catch { /* */ } mapaActual = null; } caixa.style.display = ""; inCod.focus(); });
  } },
    h("label", { class: "campo" }, h("span", {}, L("1. Código da entidade ou do técnico", "1. Organisation or staff code")), inCod),
    h("label", { class: "campo" }, h("span", {}, L("2. Nome da entidade", "2. Organisation name")), inNome),
    btn, msg);
  caixa.append(h("h2", {}, tr(A.titulo, S.lang) || L("Os meus dados", "My data")),
    h("p", {}, tr(A.intro, S.lang)), form,
    tr(A.nota, S.lang) ? h("p", { class: "nota" }, tr(A.nota, S.lang)) : null);
  app.append(caixa, resultado);
  inCod.focus();
}

function mostrar(el, ent, sair) {
  const dados = dadosDaEntidade(ent);
  const cod = val(ent, "codigo_entidade");
  const nome = val(ent, "nome_entidade");
  const nomeDs = ds => tr((S.cfg.fontes.datasets[ds] || {}).nome, S.lang) || ds;
  const tecs = (S.data.entidades.tables.tecnicos || []).filter(t => t.root === ent);
  const provs = String(val(ent, "provincias_actuacao") || "").split(/[,\s]+/).filter(Boolean).map(p => rotulo("entidades", "main", "provincias_actuacao", p)).join(", ");
  const total = Object.values(dados).reduce((s, d) => s + d.main.length, 0);

  const cab = h("div", { class: "pagina ent-cab" },
    h("div", { class: "ent-cab-l" },
      h("small", {}, L("Dados de", "Data of")),
      h("h2", {}, nome),
      h("p", {}, [cod, rotulo("entidades", "main", "tipo_entidade", val(ent, "tipo_entidade")), provs].filter(Boolean).join(" · "))),
    h("div", { class: "linha" },
      h("button", { class: "btn primary", disabled: !total, onclick: () => descarregar(ent, dados, "xlsx") }, "⭳ Excel"),
      h("button", { class: "btn", disabled: !total, onclick: () => descarregar(ent, dados, "csv") }, "⭳ CSV (zip)"),
      h("button", { class: "btn", disabled: !total, onclick: () => descarregar(ent, dados, "geojson") }, "⭳ GeoJSON"),
      h("button", { class: "btn claro", onclick: sair }, L("Sair", "Sign out"))));

  const cartoes = h("div", { class: "ent-cartoes" },
    Object.entries(dados).map(([ds, d]) => h("div", { class: "ent-cartao", style: `border-top-color:${(S.cfg.fontes.datasets[ds] || {}).cor || "var(--cor2)"}` },
      h("strong", {}, String(d.main.length)), h("span", {}, nomeDs(ds)))),
    h("div", { class: "ent-cartao" }, h("strong", {}, String(tecs.filter(t => val(t, "estado_tecnico") === "validado").length)), h("span", {}, L("técnicos activos", "active staff"))));

  const mapaEl = h("div", { class: "ent-mapa" });
  const tabelas = h("div", {});
  for (const [ds, d] of Object.entries(dados)) {
    if (!d.main.length) continue;
    const linhas = d.main.slice(0, 300);
    tabelas.append(h("details", { class: "ent-ficha", open: true },
      h("summary", {}, `${nomeDs(ds)} (${d.main.length})`),
      h("div", { class: "tabela-wrap" }, h("table", { class: "tabela" },
        h("thead", {}, h("tr", {}, [L("Registo", "Record"), L("Província", "Province"), L("Distrito", "District"), L("Ano", "Year"), L("Última edição", "Last edit")].map(x => h("th", {}, x)))),
        h("tbody", {}, linhas.map(r => h("tr", {},
          h("td", {}, r.d._rotulo || "—"),
          h("td", {}, r.d._provincia ? rotulo(ds, "main", "_provincia", r.d._provincia) : "—"),
          h("td", {}, r.d._distrito ? rotulo(ds, "main", "_distrito", r.d._distrito) : "—"),
          h("td", {}, r.d._ano || "—"),
          h("td", {}, r.d._data ? fmtDate(r.d._data, S.lang) : "—")))))),
      d.main.length > linhas.length ? h("p", { class: "nota" }, L(`Mostram-se ${linhas.length}; o descarregamento inclui todos.`, `Showing ${linhas.length}; the download includes all.`)) : null));
  }
  const tecBox = tecs.length ? h("details", { class: "ent-ficha" },
    h("summary", {}, `${L("Técnicos da entidade", "Organisation staff")} (${tecs.length})`),
    h("table", { class: "tabela" }, h("thead", {}, h("tr", {}, h("th", {}, L("Código", "Code")), h("th", {}, L("Estado", "Status")))),
      h("tbody", {}, tecs.map(t => h("tr", {}, h("td", {}, val(t, "codigo_tecnico") || "—"), h("td", {}, rotulo("entidades", "tecnicos", "estado_tecnico", val(t, "estado_tecnico")) || "—")))))) : null;

  el.append(cab, cartoes,
    total ? h("div", { class: "pagina larga" }, h("h3", {}, L("Onde estão os seus registos", "Where your records are")), mapaEl) : h("div", { class: "pagina" }, h("p", { class: "vazio" }, L("Ainda não há registos enviados com os códigos desta entidade.", "No records have been submitted with this organisation's codes yet."))),
    h("div", { class: "pagina larga" }, tabelas, tecBox));
  if (total) desenharMapa(mapaEl, dados);
  window.scrollTo(0, 0);
}

function desenharMapa(el, dados) {
  const Lf = window.L; if (!Lf) return;
  const map = Lf.map(el, { scrollWheelZoom: false }); mapaActual = map;
  Lf.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "Esri World Imagery", maxZoom: 19 }).addTo(map);
  const grupo = Lf.featureGroup().addTo(map);
  for (const [ds, d] of Object.entries(dados)) {
    const cor = (S.cfg.fontes.datasets[ds] || {}).cor || "#1f7a5c";
    const nome = tr((S.cfg.fontes.datasets[ds] || {}).nome, S.lang);
    for (const r of d.main) {
      if (!r.g) continue;
      Lf.geoJSON(r.g, { style: { color: cor, weight: 2, fillOpacity: 0.35 }, pointToLayer: (f, ll) => Lf.circleMarker(ll, { radius: 6, color: "#fff", weight: 1.5, fillColor: cor, fillOpacity: 0.95 }) })
        .bindPopup(`<strong>${nome}</strong><br>${(r.d._rotulo || "").replace(/</g, "&lt;")}`).addTo(grupo);
    }
  }
  const b = grupo.getBounds();
  if (b.isValid()) map.fitBounds(b, { padding: [20, 20], maxZoom: 14 }); else map.setView([-18.5, 35.5], 5);
  setTimeout(() => map.invalidateSize(), 50);
}

const hoje = () => new Date().toISOString().slice(0, 10);
const nomeFolha = s => s.replace(/[\\/?*[\]:]/g, "_").slice(0, 31);
function colunas(rows) { const s = new Set(); rows.forEach(r => Object.keys(r).forEach(k => s.add(k))); return [...s]; }

async function descarregar(ent, dados, formato) {
  try {
    const base = `${limpaCod(val(ent, "codigo_entidade"))}_${hoje()}`;
    const permitir = new Set(["codigo_entidade", "nome_entidade"]);
    const blocos = [];
    for (const [ds, d] of Object.entries(dados)) {
      if (!d.main.length) continue;
      blocos.push({ ds, tab: "main", recs: d.main, rows: d.main.map(r => linhaExport(r, ds, true, permitir)) });
      for (const [tb, rows] of Object.entries(d.tables)) if (rows.length) blocos.push({ ds, tab: tb, rows: rows.map(r => linhaExport(r, ds, true, permitir)) });
    }
    const leia = [
      { campo: L("Entidade", "Organisation"), valor: val(ent, "nome_entidade") },
      { campo: L("Código", "Code"), valor: val(ent, "codigo_entidade") },
      { campo: L("Exportado em", "Exported on"), valor: new Date().toISOString() },
      { campo: L("Conteúdo", "Contents"), valor: L("Apenas os registos enviados com os códigos desta entidade. Os dados pessoais dos técnicos não são incluídos.", "Only records submitted with this organisation's codes. Staff personal data is not included.") },
      ...(Object.values(S.data).some(d => d.estado === "demo") ? [{ campo: "DEMO", valor: L("Dados fictícios de demonstração.", "Fictitious demo data.") }] : [])
    ];
    if (formato === "geojson") {
      const features = [];
      for (const b of blocos.filter(b => b.tab === "main")) b.recs.forEach((r, i) => features.push({ type: "Feature", geometry: r.g, properties: { ficha: b.ds, ...b.rows[i] } }));
      download(`${base}.geojson`, JSON.stringify({ type: "FeatureCollection", features }), "application/geo+json");
    } else if (formato === "xlsx") {
      const X = window.XLSX, wb = X.utils.book_new(), usados = new Set();
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(leia), "LEIA-ME");
      for (const b of blocos) { let n = nomeFolha(`${b.ds}_${b.tab}`); let i = 2; while (usados.has(n)) n = nomeFolha(`${b.ds}_${b.tab}`.slice(0, 28) + i++); usados.add(n);
        X.utils.book_append_sheet(wb, X.utils.json_to_sheet(b.rows, { header: colunas(b.rows) }), n); }
      X.writeFile(wb, `${base}.xlsx`);
    } else {
      const zip = new window.JSZip();
      zip.file("LEIA-ME.csv", toCSV(leia, ["campo", "valor"]));
      for (const b of blocos) zip.file(`${b.ds}/${b.tab}.csv`, toCSV(b.rows, colunas(b.rows)));
      download(`${base}.zip`, await zip.generateAsync({ type: "blob" }));
    }
  } catch (e) { console.error(e); toast(e.message, "erro", 8000); }
}
