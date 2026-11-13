// Relatório em PDF (jsPDF). Só leva o logótipo do InOM.
import { S } from "./data.js";
import { UI } from "./i18n.js";
import { kpiValor, dadosGrafico, opcaoGrafico, tabelaAnalisada, descricaoFiltros } from "./dash.js";
import { h, tr, fmt, fmtDate, toast } from "./util.js";
import { modal } from "./main.js";

const t = k => UI[S.lang][k] || k;

export function abrirPDF(paginaActual) {
  let ambito = "actual";
  const corpo = h("div", {},
    h("p", {}, t("dl_ambito")),
    h("label", { class: "radio" }, h("input", { type: "radio", name: "amb", checked: true, onchange: () => (ambito = "actual") }), " " + t("pdf_pagina_actual") + ` (${tr(paginaActual.titulo, S.lang)})`),
    h("label", { class: "radio" }, h("input", { type: "radio", name: "amb", onchange: () => (ambito = "todas") }), " " + t("pdf_todas")));
  modal(t("exportar_pdf"), corpo, [
    { texto: t("cancelar") },
    { texto: t("pdf_gerar"), primario: true, accao: async () => {
      const ps = ambito === "todas" ? S.cfg.dashboard.paginas : [paginaActual];
      toast(t("pdf_a_gerar"));
      try { await gerarPDF(ps); } catch (e) { console.error(e); toast("PDF: " + e.message, "erro", 8000); }
    } }
  ]);
}

async function imagemPNG(src) {
  return new Promise(res => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = img.naturalWidth || 400, hh = img.naturalHeight || 160, k = Math.min(1, 800 / w);
      const c = document.createElement("canvas"); c.width = Math.round(w * k * 2); c.height = Math.round(hh * k * 2);
      const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, c.width, c.height);
      try { res({ url: c.toDataURL("image/png"), ratio: c.width / c.height }); } catch { res(null); }
    };
    img.onerror = () => res(null);
    img.src = src;
  });
}

function graficoPNG(g, largura = 900) {
  const dados = dadosGrafico(g, { completo: true });
  const alt = g.tipo === "barrash" || g.tipo === "empilhado" ? Math.min(620, Math.max(260, 50 + dados.cats.length * 26)) : 340;
  const div = document.createElement("div");
  div.style.cssText = `position:fixed;left:-12000px;top:0;width:${largura}px;height:${alt}px;background:#fff`;
  document.body.append(div);
  const inst = window.echarts.init(div, null, { renderer: "canvas" });
  inst.setOption(opcaoGrafico(g, dados, true));
  const url = inst.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#ffffff" });
  inst.dispose(); div.remove();
  return { url, ratio: largura / alt };
}

function hex(c) { const m = /^#?([0-9a-f]{6})$/i.exec(c || ""); const n = m ? parseInt(m[1], 16) : 0x0b4a3a; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

export async function gerarPDF(paginas) {
  if (!window.jspdf) throw new Error("jsPDF não carregou");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 14, lang = S.lang, cfg = S.cfg;
  const cor = hex(cfg.portal.corPrimaria);
  const logo = await imagemPNG(cfg.portal.logoInom);
  const nome = tr(cfg.portal.nome, lang);
  const hoje = fmtDate(new Date(), lang);
  const filtros = descricaoFiltros();
  let y = 0;

  const desenharCab = () => {
    doc.setFillColor(...cor); doc.rect(0, 0, W, 4, "F");
    if (logo) { const hh = 12, ww = Math.min(40, hh * logo.ratio); doc.addImage(logo.url, "PNG", M, 8, ww, hh); }
    doc.setTextColor(30, 40, 50); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text(nome, W - M, 13, { align: "right", maxWidth: 120 });
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(110, 120, 130);
    doc.text(`${t("pdf_titulo")} · ${hoje}`, W - M, 18, { align: "right" });
    doc.setDrawColor(220, 225, 230); doc.line(M, 23, W - M, 23);
  };
  const cabecalho = () => { desenharCab(); y = 30; };
  const novaPagina = () => { doc.addPage(); cabecalho(); };
  const espaco = n => { if (y + n > 282) novaPagina(); };

  cabecalho();
  doc.setTextColor(...cor); doc.setFont("helvetica", "bold"); doc.setFontSize(18);
  doc.text(t("pdf_titulo"), M, y + 4); y += 12;
  doc.setTextColor(60, 70, 80); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(`${t("pdf_gerado")}: ${hoje}`, M, y); y += 6;
  doc.setFont("helvetica", "bold"); doc.text(t("pdf_filtros") + ":", M, y); doc.setFont("helvetica", "normal");
  const ftxt = filtros.length ? filtros.join(" · ") : t("pdf_sem_filtros");
  const lines = doc.splitTextToSize(ftxt, W - 2 * M - 30);
  doc.text(lines, M + 30, y); y += lines.length * 5 + 4;
  if (Object.values(S.data).some(d => d.estado === "demo")) {
    doc.setTextColor(200, 80, 30); doc.setFontSize(9); doc.text(doc.splitTextToSize(t("demo_banner"), W - 2 * M), M, y); y += 10;
  }

  for (const pg of paginas) {
    espaco(30);
    doc.setFillColor(...cor); doc.rect(M, y, W - 2 * M, 8, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text(tr(pg.titulo, lang), M + 3, y + 5.6); y += 12;
    // KPIs em grelha
    const ks = pg.kpis || [];
    if (ks.length) {
      const porLinha = 3, bw = (W - 2 * M - (porLinha - 1) * 4) / porLinha, bh = 20;
      ks.forEach((k, i) => {
        const col = i % porLinha;
        if (col === 0) { espaco(bh + 4); if (i) y += bh + 4; }
        const x = M + col * (bw + 4);
        doc.setDrawColor(220, 225, 230); doc.setFillColor(247, 249, 250); doc.roundedRect(x, y, bw, bh, 2, 2, "FD");
        doc.setTextColor(40, 50, 60); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
        doc.text(doc.splitTextToSize(tr(k.titulo, lang), bw - 6)[0], x + 3, y + 5.5);
        doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(120, 130, 140);
        doc.text(doc.splitTextToSize(tr(k.subtitulo, lang), bw - 6)[0] || "", x + 3, y + 9.5);
        doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...cor);
        doc.text(fmt(kpiValor(k), { formato: k.formato, decimais: k.decimais }, lang), x + 3, y + 17);
      });
      y += bh + 8;
    }
    for (const g of pg.graficos || []) {
      if (g.tipo === "mapa") continue;
      if (g.tipo === "texto") continue;
      espaco(20);
      doc.setTextColor(30, 40, 50); doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
      doc.text(doc.splitTextToSize(tr(g.titulo, lang), W - 2 * M), M, y); y += 4.5;
      if (g.subtitulo) { doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120, 130, 140); doc.text(doc.splitTextToSize(tr(g.subtitulo, lang), W - 2 * M)[0], M, y); y += 4; }
      if (g.tipo === "tabela" || g.tipo === "cobertura") {
        const ta = tabelaAnalisada(g);
        if (ta && ta.linhas.length && doc.autoTable) {
          const cols = Object.keys(ta.linhas[0]);
          doc.autoTable({ startY: y, head: [cols], body: ta.linhas.slice(0, 40).map(r => cols.map(c => r[c] ?? "")),
            styles: { fontSize: 7, cellPadding: 1.4 }, headStyles: { fillColor: cor, fontSize: 7 }, margin: { left: M, right: M, top: 30 },
            didDrawPage: () => desenharCab() });
          y = doc.lastAutoTable.finalY + 3;
          if (ta.linhas.length > 40) { doc.setFontSize(7.5); doc.setTextColor(120, 130, 140); doc.text(`… ${ta.linhas.length - 40} ${t("registos")}`, M, y + 2); y += 5; }
          y += 4;
        }
        continue;
      }
      const img = graficoPNG(g);
      const ww = W - 2 * M, hh = Math.min(150, ww / img.ratio);
      espaco(hh + 4);
      doc.addImage(img.url, "PNG", M, y, hh * img.ratio > ww ? ww : hh * img.ratio, hh);
      y += hh + 8;
    }
  }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(140, 150, 160); doc.setFont("helvetica", "normal");
    doc.text(tr(cfg.portal.rodape, lang), M, 291, { maxWidth: 150 });
    doc.text(`${i} / ${n}`, W - M, 291, { align: "right" });
  }
  doc.save(`relatorio_mangal_ervas_${new Date().toISOString().slice(0, 10)}.pdf`);
}
