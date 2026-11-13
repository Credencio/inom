// Funções utilitárias partilhadas pelo portal.
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function fmt(v, opts = {}, lang = "pt") {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  const locale = lang === "en" ? "en-GB" : "pt-PT";
  const dec = opts.decimais ?? (Math.abs(v) < 10 && !Number.isInteger(v) ? 1 : 0);
  const s = new Intl.NumberFormat(locale, { maximumFractionDigits: dec, minimumFractionDigits: opts.formato === "pct" ? 0 : 0 }).format(v);
  if (opts.formato === "pct") return s + "%";
  return s + (opts.sufixo ? " " + opts.sufixo : "");
}

export function fmtDate(d, lang = "pt") {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return "";
  return dt.toLocaleDateString(lang === "en" ? "en-GB" : "pt-PT");
}

export function isoDate(d) {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  return isNaN(dt) ? "" : dt.toISOString().slice(0, 10);
}

export function tr(obj, lang) {
  if (obj === null || obj === undefined) return "";
  if (typeof obj === "string") return obj;
  return obj[lang] || obj.pt || obj.en || "";
}

export function clone(o) { return JSON.parse(JSON.stringify(o)); }

export function slug(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function normName(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Área geodésica (ha) de uma geometria GeoJSON Polygon/MultiPolygon
export function areaHa(geom) {
  if (!geom) return null;
  const R = 6378137, rad = Math.PI / 180;
  const ringArea = ring => {
    let a = 0;
    for (let i = 0, n = ring.length; i < n; i++) {
      const p1 = ring[i], p2 = ring[(i + 1) % n];
      a += (p2[0] - p1[0]) * rad * (2 + Math.sin(p1[1] * rad) + Math.sin(p2[1] * rad));
    }
    return Math.abs(a * R * R / 2);
  };
  const poly = rings => rings.reduce((s, r, i) => s + (i === 0 ? ringArea(r) : -ringArea(r)), 0);
  if (geom.type === "Polygon") return poly(geom.coordinates) / 10000;
  if (geom.type === "MultiPolygon") return geom.coordinates.reduce((s, p) => s + poly(p), 0) / 10000;
  return null;
}

export function geomCenter(geom) {
  if (!geom) return null;
  if (geom.type === "Point") return [geom.coordinates[1], geom.coordinates[0]];
  const pts = [];
  const walk = c => (typeof c[0] === "number" ? pts.push(c) : c.forEach(walk));
  walk(geom.coordinates);
  if (!pts.length) return null;
  const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length, lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [lat, lon];
}

export function toCSV(rows, cols) {
  const q = v => {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? isoDate(v) : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return "﻿" + [cols.map(q).join(","), ...rows.map(r => cols.map(c => q(r[c])).join(","))].join("\n");
}

export function download(name, content, type = "text/plain") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function toast(msg, kind = "info", ms = 4000) {
  let box = $("#toasts");
  if (!box) { box = h("div", { id: "toasts" }); document.body.append(box); }
  const t = h("div", { class: "toast " + kind }, msg);
  box.append(t);
  setTimeout(() => t.remove(), ms);
}

// Base64 de texto UTF-8 (para a API do GitHub)
export function b64utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fileToB64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = rej; r.readAsDataURL(file);
  });
}

export function rng(seed = 42) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
