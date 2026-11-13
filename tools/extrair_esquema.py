"""Gera config/schema.json e config/choices.json a partir dos XLSForms em /fichas.
Uso: python tools/extrair_esquema.py   (só é preciso correr quando as fichas mudam)"""
import openpyxl, json, re, sys, os
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FORMS = {
  "viveiros":    "Registo_de_Viveiros_de_Mangal.xlsx",
  "degradadas":  "Registo_de_Areas_Degradadas_de_Mangal.xlsx",
  "restauracao": "Registo_de_Areas_de_Restauracao_de_Mangal.xlsx",
  "monitoria":   "Monitoria_das_Areas_de_Restauracao.xlsx",
  "levantamento":"Levantamento_Ecologico.xlsx",
  "ervas":       "Registo_de_Ervas_Marinhas.xlsx",
}
def clean(s):
    if s is None: return ""
    s = re.sub(r"<[^>]+>", " ", str(s)); s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"^\d+(\.\d+)*\.\s+", "", s)
    return s
schema, choices = {}, {}
def apply_overrides(choices):
    """Rótulos curtos (PT) e traduções (EN) das opções usadas nos gráficos. Edite tools/rotulos_en.json."""
    path = os.path.join(BASE, "tools", "rotulos_en.json")
    if not os.path.exists(path): return
    over = json.load(open(path, encoding="utf-8"))
    for lst, items in over.items():
        for code, v in items.items():
            if lst in choices and code in choices[lst]:
                if isinstance(v, list): choices[lst][code]["pt"], choices[lst][code]["en"] = v
                else: choices[lst][code]["en"] = v

for key, fn in FORMS.items():
    wb = openpyxl.load_workbook(os.path.join(BASE, "fichas", fn))
    ws = wb["survey"]; h = {c.value: i for i, c in enumerate(ws[1]) if c.value}
    tables = {"main": {"fields": {}}}; stack = ["main"]; required = {}
    for r in ws.iter_rows(min_row=2, values_only=True):
        t = r[h["type"]]
        if not t: continue
        t = re.sub(r"\s+", " ", str(t)).strip(); name = (str(r[h["name"]]).strip() if r[h["name"]] else None)
        if t.startswith("begin repeat"):
            stack.append(name); tables[name] = {"fields": {}, "label": clean(r[h["label"]]), "parent": stack[-2]}; continue
        if t.startswith("end repeat"): stack.pop(); continue
        if t.startswith(("begin group", "end group", "note")) or not name: continue
        parts = t.split(); base = parts[0]
        if base == "calculate":
            ft = r[h.get("bind::esri:fieldType")] if "bind::esri:fieldType" in h else None
            if ft == "null": continue
        f = {"type": base, "label": clean(r[h["label"]]) or name}
        if base in ("select_one", "select_multiple") and len(parts) > 1: f["list"] = parts[1]
        if base == "select_one_from_file": f["file"] = parts[1]
        if str(r[h["required"]] or "").lower() == "yes" and not r[h["relevant"]]: f["required"] = True
        tables[stack[-1]]["fields"][name] = f
    schema[key] = {"form": fn, "tables": tables}
    cs = wb["choices"]; ch = {c.value: i for i, c in enumerate(cs[1]) if c.value}
    for r in cs.iter_rows(min_row=2, values_only=True):
        if not r[0]: continue
        lst, code = str(r[0]).strip(), str(r[1]).strip() if r[1] is not None else ""
        d = choices.setdefault(lst, {})
        if code in d: continue
        e = {"pt": clean(r[2]) or code}
        for col in ("provincia", "distrito", "posto_adm"):
            if col in ch and r[ch[col]]: e[col] = str(r[ch[col]]).strip()
        d[code] = e
json.dump(schema, open(os.path.join(BASE, "config", "schema.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
apply_overrides(choices)
json.dump(choices, open(os.path.join(BASE, "config", "choices.json"), "w", encoding="utf-8"), ensure_ascii=False)
print({k: {t: len(v["fields"]) for t, v in s["tables"].items()} for k, s in schema.items()})
print(len(choices), "listas;", sum(len(v) for v in choices.values()), "opções")
