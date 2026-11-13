// Descarregamento de dados brutos (CSV/Excel/GeoJSON) e analisados (tabelas dos indicadores e gráficos).
import { S, DATASETS, vista, campoSchema, rotulo, valores, dataDe, descricaoFiltros } from "./data.js";
import { UI } from "./i18n.js";
import { kpiValor, tabelaAnalisada } from "./dash.js";
import { h, tr, toCSV, download, isoDate, toast } from "./util.js";
import { modal } from "./main.js";

const t = k => UI[S.lang][k] || k;

export function abrirDownload(paginaActual) {
  const st = { aba: "brutos", dss: new Set(DATASETS.filter(d => S.data[d] && S.data[d].main && S.data[d].main.length)), formato: "csv", filtros: true, rotulos: true, ambito: "actual", fmtA: "xlsx" };
  const corpo = h("div", {});
  const desenhar = () => {
    corpo.innerHTML = "";
    corpo.append(h("div", { class: "subtabs mini" },
      h("a", { class: st.aba === "brutos" ? "active" : "", onclick: () => { st.aba = "brutos"; desenhar(); } }, t("dados_brutos")),
      h("a", { class: st.aba === "analisados" ? "active" : "", onclick: () => { st.aba = "analisados"; desenhar(); } }, t("dados_analisados"))));
    if (st.aba === "brutos") {
      corpo.append(h("h4", {}, t("dl_fichas")),
        h("div", { class: "checks" }, DATASETS.map(d => {
          const n = (S.data[d] && S.data[d].main && (st.filtros ? vista(d).main.length : S.data[d].main.length)) || 0;
          return h("label", { class: "check" }, h("input", { type: "checkbox", checked: st.dss.has(d), disabled: !n, onchange: e => (e.target.checked ? st.dss.add(d) : st.dss.delete(d)) }),
            ` ${tr(S.cfg.fontes.datasets[d].nome, S.lang)} (${n})`);
        })),
        h("h4", {}, t("dl_formato")),
        ...[["csv", t("dl_csv")], ["xlsx", t("dl_xlsx")], ["geojson", t("dl_geojson")]].map(([v, l]) =>
          h("label", { class: "radio" }, h("input", { type: "radio", name: "fmt", checked: st.formato === v, onchange: () => (st.formato = v) }), " " + l)),
        h("label", { class: "check" }, h("input", { type: "checkbox", checked: st.filtros, onchange: e => { st.filtros = e.target.checked; desenhar(); } }), " " + t("dl_aplicar_filtros")),
        h("label", { class: "check" }, h("input", { type: "checkbox", checked: st.rotulos, onchange: e => (st.rotulos = e.target.checked) }), " " + t("dl_rotulos")),
        h("p", { class: "nota" }, t("dl_privacidade")));
    } else {
      corpo.append(h("p", {}, t("dl_analisados_desc")), h("h4", {}, t("dl_ambito")),
        h("label", { class: "radio" }, h("input", { type: "radio", name: "amb", checked: st.ambito === "actual", onchange: () => (st.ambito = "actual") }), " " + t("pdf_pagina_actual") + ` (${tr(paginaActual.titulo, S.lang)})`),
        h("label", { class: "radio" }, h("input", { type: "radio", name: "amb", checked: st.ambito === "todas", onchange: () => (st.ambito = "todas") }), " " + t("pdf_todas")),
        h("h4", {}, t("dl_formato")),
        ...[["xlsx", t("dl_xlsx")], ["csv", t("dl_csv")]].map(([v, l]) =>
          h("label", { class: "radio" }, h("input", { type: "radio", name: "fmta", checked: st.fmtA === v, onchange: () => (st.fmtA = v) }), " " + l)));
    }
  };
  desenhar();
  modal(t("descarregar"), corpo, [{ texto: t("cancelar") }, { texto: t("dl_baixar"), primario: true, accao: async () => {
    try {
      if (st.aba === "brutos") await brutos(st); else await analisados(st, paginaActual);
    } catch (e) { console.error(e); toast(e.message, "erro", 8000); }
  } }]);
}

function excluidos() { return new Set((S.cfg.privacidade.camposExcluidos || []).map(s => s.toLowerCase())); }

function linhaExport(r, ds, rotulos) {
  const ex = excluidos(), o = {};
  for (const k of r.k) {
    if (ex.has(k.toLowerCase())) continue;
    let v = r.a[k];
    const f = campoSchema(ds, r.tabela, k);
    if (f && (f.type === "date" || f.type === "datetime")) v = isoDate(dataDe(v));
    else if (/^(creationdate|editdate)$/i.test(k)) v = v ? new Date(v).toISOString() : "";
    o[k] = v;
    if (rotulos && f && (f.list || f.file) && v !== null && v !== undefined && v !== "") o[k + "__rotulo"] = valores(r, k).map(x => rotulo(ds, r.tabela, k, x)).join(", ");
  }
  if (r.tabela === "main") {
    o.portal_provincia = rotulo(ds, "main", "_provincia", r.d._provincia || "");
    o.portal_distrito = rotulo(ds, "main", "_distrito", r.d._distrito || "");
    o.portal_ano = r.d._ano;
    if (r.d._area_ha !== null && r.d._area_ha !== undefined) o.portal_area_poligono_ha = r.d._area_ha;
    if (r.d._estado_monitoria) o.portal_estado_monitoria = rotulo(ds, "main", "_estado_monitoria", r.d._estado_monitoria);
  }
  return o;
}

function colunas(rows) { const s = new Set(); rows.forEach(r => Object.keys(r).forEach(k => s.add(k))); return [...s]; }
const nomeFolha = s => s.replace(/[\\/?*[\]:]/g, "_").slice(0, 31);
const hoje = () => new Date().toISOString().slice(0, 10);

async function brutos(st) {
  const blocos = [];
  for (const ds of st.dss) {
    const D = st.filtros ? vista(ds) : { main: S.data[ds].main, tables: S.data[ds].tables };
    blocos.push({ ds, tab: "main", rows: D.main.map(r => linhaExport(r, ds, st.rotulos)), recs: D.main });
    for (const [tb, rows] of Object.entries(D.tables)) blocos.push({ ds, tab: tb, rows: rows.map(r => linhaExport(r, ds, st.rotulos)) });
  }
  if (!blocos.length) return;
  if (st.formato === "geojson") {
    for (const b of blocos.filter(b => b.tab === "main")) {
      const fc = { type: "FeatureCollection", features: b.recs.map((r, i) => ({ type: "Feature", geometry: r.g, properties: b.rows[i] })) };
      download(`${b.ds}_${hoje()}.geojson`, JSON.stringify(fc), "application/geo+json");
    }
    return;
  }
  if (st.formato === "xlsx") {
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(leiame()), "LEIA-ME");
    for (const b of blocos) window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(b.rows.length ? b.rows : [{}], { header: colunas(b.rows) }), nomeFolha(`${b.ds}_${b.tab}`));
    window.XLSX.writeFile(wb, `dados_brutos_${hoje()}.xlsx`);
    return;
  }
  const zip = new window.JSZip();
  zip.file("LEIA-ME.csv", toCSV(leiame(), ["campo", "valor"]));
  for (const b of blocos) zip.file(`${b.ds}/${b.tab}.csv`, toCSV(b.rows, colunas(b.rows)));
  download(`dados_brutos_${hoje()}.zip`, await zip.generateAsync({ type: "blob" }));
}

function leiame() {
  const f = descricaoFiltros();
  return [
    { campo: S.lang === "en" ? "Portal" : "Portal", valor: tr(S.cfg.portal.nome, S.lang) },
    { campo: S.lang === "en" ? "Exported on" : "Exportado em", valor: new Date().toISOString() },
    { campo: t("pdf_filtros"), valor: f.length ? f.join(" · ") : t("pdf_sem_filtros") },
    { campo: S.lang === "en" ? "Note" : "Nota", valor: t("dl_privacidade") },
    { campo: S.lang === "en" ? "Columns" : "Colunas", valor: S.lang === "en" ? "__rotulo = option name; portal_* = values computed by the portal" : "__rotulo = nome da opção; portal_* = valores calculados pelo portal" },
    ...(Object.values(S.data).some(d => d.estado === "demo") ? [{ campo: "DEMO", valor: t("demo_banner") }] : [])
  ];
}

async function analisados(st, paginaActual) {
  const ps = st.ambito === "todas" ? S.cfg.dashboard.paginas : [paginaActual];
  const ind = [], tabs = [];
  for (const p of ps) {
    for (const k of p.kpis || []) { const v = kpiValor(k); ind.push({ [S.lang === "en" ? "Page" : "Página"]: tr(p.titulo, S.lang), [S.lang === "en" ? "Indicator" : "Indicador"]: tr(k.titulo, S.lang), [S.lang === "en" ? "Value" : "Valor"]: v === null ? null : Math.round(v * 100) / 100, [S.lang === "en" ? "Note" : "Nota"]: tr(k.subtitulo, S.lang) }); }
    for (const g of p.graficos || []) { const ta = tabelaAnalisada(g); if (ta && ta.linhas.length) tabs.push({ nome: `${tr(p.titulo, S.lang)} - ${ta.nome}`, linhas: ta.linhas }); }
  }
  if (st.fmtA === "xlsx") {
    const wb = window.XLSX.utils.book_new(); const usados = new Set();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(leiame()), "LEIA-ME");
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(ind), S.lang === "en" ? "Indicators" : "Indicadores");
    tabs.forEach((tb, i) => { let n = nomeFolha(`${i + 1} ${tb.nome}`); while (usados.has(n)) n = nomeFolha(n.slice(0, 28) + i); usados.add(n);
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(tb.linhas), n); });
    window.XLSX.writeFile(wb, `dados_analisados_${hoje()}.xlsx`);
  } else {
    const zip = new window.JSZip();
    zip.file("LEIA-ME.csv", toCSV(leiame(), ["campo", "valor"]));
    zip.file("indicadores.csv", toCSV(ind, colunas(ind)));
    tabs.forEach((tb, i) => zip.file(`${String(i + 1).padStart(2, "0")}_${tb.nome.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60)}.csv`, toCSV(tb.linhas, colunas(tb.linhas))));
    download(`dados_analisados_${hoje()}.zip`, await zip.generateAsync({ type: "blob" }));
  }
}
