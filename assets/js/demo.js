// Dados FICTÍCIOS de demonstração, usados enquanto as fontes de dados não estão configuradas.
import { rng } from "./util.js";

const CENTROS = { // [lat, lon] aproximados de zonas costeiras
  cabo_delgado: [-12.6, 40.35], nampula: [-15.2, 40.4], "zambézia": [-18.4, 36.6], sofala: [-19.7, 34.85],
  inhambane: [-22.9, 35.45], gaza: [-25.1, 33.7], "maputo_província": [-26.3, 32.85], maputo_cidade: [-25.97, 32.62]
};
const PESO = { cabo_delgado: 14, nampula: 12, "zambézia": 13, sofala: 16, inhambane: 12, gaza: 5, "maputo_província": 8, maputo_cidade: 4 };
const INST = [
  ["Associação Comunitária Mangal Demo", "organizacao_comunitaria"], ["Conselho Comunitário de Pesca Demo", "organizacao_comunitaria"],
  ["Governo Distrital (demonstração)", "governo"], ["Serviços Provinciais do Ambiente (demonstração)", "governo"],
  ["ONG Mangal Vivo (demonstração)", "ong"], ["ONG Costa Verde (demonstração)", "ong"],
  ["Universidade de Demonstração", "instituicao_academica"], ["Fundo Ambiental de Demonstração", "agencia_intergovernamental"],
  ["Agência de Cooperação Demo", "agencia_estrangeira"], ["Empresa Costeira Demo", "setor_privado"]
];
const ESP = ["avicennia_marina", "rhizophora_mucronata", "ceriops_tagal", "bruguiera_gymnorrhiza", "sonneratia_alba", "xylocarpus_granatum", "heritiera_littoralis", "lumnitzera_racemosa"];
const ESP_P = [30, 26, 18, 10, 6, 5, 3, 2];
const ERVAS = ["Thalassia_hemprichii", "Cymodocea_rotundata", "Halodule_uninervis", "Zostera_capensis", "Thalassodendron_ciliatum", "Syringodium_isoetifolium", "Halophila_ovalis", "Enhalus_acoroides"];

export function gerarDemo(choices, schema) {
  const R = rng(20261113);
  const pick = a => a[Math.floor(R() * a.length)];
  const wpick = (a, w) => { const t = w.reduce((s, x) => s + x, 0); let r = R() * t; for (let i = 0; i < a.length; i++) { r -= w[i]; if (r <= 0) return a[i]; } return a[a.length - 1]; };
  const some = (a, min, max) => { const n = min + Math.floor(R() * (max - min + 1)); const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b.slice(0, n); };
  const int = (a, b) => Math.round(a + R() * (b - a));
  let gidN = 0; const gid = () => `{demo-${(++gidN).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000}`;
  const date = (y0, y1) => Math.min(Date.UTC(int(y0, y1), int(0, 11), int(1, 28)), Date.now() - 864e5 * int(1, 60));
  const provs = Object.keys(PESO), pesos = Object.values(PESO);
  const distritos = {};
  for (const [k, v] of Object.entries(choices.distrito || {})) (distritos[v.provincia] = distritos[v.provincia] || []).push(k);
  const postos = {};
  for (const [k, v] of Object.entries(choices.posto_adm || {})) (postos[v.distrito] = postos[v.distrito] || []).push(k);
  const local = () => {
    const p = wpick(provs, pesos), d = pick(distritos[p] || [""]), po = pick(postos[d] || [""]);
    const c = CENTROS[p]; return { p, d, po, lat: c[0] + (R() - 0.5) * 0.9, lon: c[1] + (R() - 0.5) * 0.5 };
  };
  const quad = (lat, lon, ha) => {
    const side = Math.sqrt(ha * 10000) / 2, dLat = side / 111320, dLon = side / (111320 * Math.cos(lat * Math.PI / 180));
    return { type: "Polygon", coordinates: [[[lon - dLon, lat - dLat], [lon + dLon, lat - dLat], [lon + dLon, lat + dLat], [lon - dLon, lat + dLat], [lon - dLon, lat - dLat]]] };
  };
  const pt = (lat, lon) => ({ type: "Point", coordinates: [lon, lat] });
  const base = (l, y0 = 2019, y1 = 2026) => ({ globalid: gid(), provincia: l.p, distrito: l.d, posto_adm: l.po, CreationDate: date(y0, y1) });
  const out = {};

  // Entidades e técnicos (fictícios). Os códigos seguem a regra do notebook: ENT-001, ENT-001-T01…
  out.entidades = { main: [], tables: { tecnicos: [] } };
  const TIPO_ENT = { organizacao_comunitaria: "organizacao_comunitaria", governo: "governo", ong: "ong", instituicao_academica: "instituicao_academica",
    agencia_intergovernamental: "agencia_intergovernamental", agencia_estrangeira: "agencia_estrangeira", setor_privado: "setor_privado" };
  const ESTADOS_ENT = ["validado", "validado", "validado", "validado", "validado", "validado", "validado", "validado", "pendente", "rejeitado"];
  const activos = [];
  INST.forEach(([nome, tipo], i) => {
    const estado = ESTADOS_ENT[i], cod = estado === "validado" ? `ENT-${String(i + 1).padStart(3, "0")}` : null;
    const criado = estado === "pendente" ? Date.now() - 40 * 864e5 : date(2023, 2025);
    const a = { globalid: gid(), CreationDate: criado, nome_entidade: nome, sigla: nome.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 5),
      tipo_entidade: TIPO_ENT[tipo] || "outra", provincias_actuacao: some(provs.slice(0, 7), 1, 3).join(","), estado_entidade: estado,
      codigo_entidade: cod, data_validacao: cod ? criado + int(2, 20) * 864e5 : null };
    out.entidades.main.push({ attributes: a, geometry: null });
    const nt = int(2, 5);
    for (let k = 1; k <= nt; k++) {
      const et = !cod ? "pendente" : (k === nt && R() > 0.6 ? "suspenso" : "validado");
      const ct = et === "validado" || et === "suspenso" ? `${cod}-T${String(k).padStart(2, "0")}` : null;
      out.entidades.tables.tecnicos.push({ attributes: { globalid: gid(), parentglobalid: a.globalid, estado_tecnico: et, codigo_tecnico: ct } });
      if (et === "validado") activos.push({ codigo_tecnico: ct, codigo_entidade: cod, nome_entidade: nome });
    }
  });
  const quem = () => (R() < 0.06 ? {} : { ...pick(activos), nome_digitalizador: "Técnico de demonstração" });

  // Viveiros
  out.viveiros = { main: [], tables: { registo_especies: [] } };
  for (let i = 1; i <= 24; i++) {
    const l = local(), perm = R() > 0.3, inst = pick(INST);
    const a = { ...base(l), id_viveiro: `VIV_DEMO_${i}`, nome_viveiro: `Viveiro Demo ${i}`, tempo: perm ? "Permanente" : "Temporario",
      ano_estabelecimento: date(2015, 2025), ano_enceramento: perm ? null : (R() > 0.5 ? date(2023, 2025) : date(2027, 2028)),
      entidade_responsavel: inst[0], num_homens: int(2, 20), num_mulheres: int(2, 22), capacidade_instalada: int(20, 150) * 1000,
      capacidade_anual: int(30, 160) * 1000, custo_por_muda: Math.round((10 + R() * 30) * 10) / 10, tipo_estufa: pick(["palha", "rede"]),
      tem_financiador: "sim", financiadores: some(["ong_fin", "governo_fin", "agencia_estrangeira_fin", "sector_privado_fin"], 1, 2).join(","),
      ong_fin: "ONG Mangal Vivo (demonstração)", governo_fin: "Governo Distrital (demonstração)",
      desafios_enfrentados: some(["recursos_escassos", "pessoal_nao_formado", "apoio_tecnico", "infraestrutura", "transporte", "conhecimento_mangal", "seguranca"], 1, 4).join(","),
      necessidades_prioritarias: some(["formacao", "financiamento", "transporte", "estufas", "apoio_tecnico", "conhecimento_especies", "sensibilizacao"], 1, 4).join(",") };
    out.viveiros.main.push({ attributes: a, geometry: quad(l.lat, l.lon, 0.2 + R() * 0.8) });
    for (const e of some(ESP.slice(0, 6), 2, 4)) out.viveiros.tables.registo_especies.push({ attributes: { globalid: gid(), parentglobalid: a.globalid, especies_produzidas: e, mudas_disponiveis: int(1, 30) * 500, mudas_distribuidas: int(2, 40) * 500 } });
  }

  // Áreas degradadas
  out.degradadas = { main: [], tables: { executores_rpt: [], financiadores_rpt: [] } };
  const causas = {
    causa_degradacao_actividades_de_producao_e_extraccao: ["extracao_madeira", "sobre_madeira", "agricultura", "pastagem", "colecta_invertebrados", "garimpo", "industria_mineradora"],
    causa_degradacao_factores_naturais_e_climaticos: ["ciclones", "inundacoes", "seca", "tempestades", "nivel_mar"],
    causa_degradacao_infraestruturas_e_uso_do_solo: ["expansao_urbana", "desenvolvimento_costeiro", "salinas", "abertura_caminhos"],
    causa_degradacao_poluicao_e_impactos_ambientais: ["poluicao"],
    causa_degradacao_processos_fisicos_e_ecologicos: ["erosao", "assoreamento"]
  };
  for (let i = 1; i <= 100; i++) {
    const l = local(), ha = Math.round(5 + R() * 60), a = { ...base(l), id_area_degradada: `ADM_DEMO_${i}`, data_levantamento: date(2020, 2026),
      ano_estimado_perda: date(2000, 2024), nome_floresta: `Floresta Demo ${i}`, nome_comunidade: `Comunidade Demo ${int(1, 40)}`,
      degradada_sim_nao: "sim", nivel_degradacao: String(wpick([1, 2, 3, 4], [2, 3, 3, 2])), metodologia: pick(["percepcao", "imagem_satelite", "quadriculas"]),
      sinais_degradacao_visiveis: some(["clareiras_cepos", "arvores_dispersas", "erosao_solo", "lixo_residuos", "canais_artificiais", "arvores_cortadas", "sedimentacao"], 1, 3).join(","),
      especies_abatidas: some(ESP.slice(0, 7), 1, 2).join(","), especies_presentes: some(ESP, 2, 5).join(","), tipo_protecao: pick(["sem_protecao", "acc", "anac", "reserva_nformal"]) };
    for (const [f, opts] of Object.entries(causas)) if (R() > 0.45) a[f] = some(opts, 1, 2).join(",");
    out.degradadas.main.push({ attributes: a, geometry: quad(l.lat, l.lon, ha) });
    const ex = pick(INST); out.degradadas.tables.executores_rpt.push({ attributes: { globalid: gid(), parentglobalid: a.globalid, tipo_executor: ex[1] + "_exec", nome_executor: ex[0] } });
    if (R() > 0.4) { const f = pick(INST); out.degradadas.tables.financiadores_rpt.push({ attributes: { globalid: gid(), parentglobalid: a.globalid, tipo_financiador: f[1] + "_fin", nome_financiador: f[0] } }); }
  }

  // Restauração
  out.restauracao = { main: [], tables: { partes_interessadas_rpt: [], partes_executoras_rpt: [], material_vegetal: [], financiadores_grp: [] } };
  for (let i = 1; i <= 40; i++) {
    const l = local(), prop = int(5, 50), ha = Math.max(1, Math.round(prop * (0.3 + R() * 0.7))), tec = wpick(["restauracao_activa", "restauracao_hidrologica", "restauracao_combinada"], [6, 3, 1]);
    const orig = wpick(["sim", "mapeada", "nao", "Sem_informação"], [35, 25, 30, 10]);
    const dg = orig === "sim" ? `ADM_DEMO_${int(1, 100)}` : null;
    const a = { ...base(l), id_area_restauracao: `ARM_DEMO_${i}`, nome_do_projecto: `Projecto Demo ${i}`, inicio_do_projecto: date(2018, 2026),
      em_area_degradada: orig, id_area_degradada: dg,
      lat_degradado: orig === "mapeada" ? l.lat : null, lon_degradado: orig === "mapeada" ? l.lon : null, ano_mapeamento: orig === "mapeada" && R() > 0.4 ? String(int(2018, 2024)) : null, area_total: prop, tecnica_restauracao_usadas: tec,
      num_homens: int(10, 120), num_mulheres: int(10, 130), custo_total_mt: R() > 0.3 ? int(2, 25) * 100000 : null, apoio_financeiro: "sim",
      plano_monitoria: R() > 0.4 ? "sim" : "nao", especies_utilizadas: some(ESP.slice(0, 6), 1, 3).join(",") };
    out.restauracao.main.push({ attributes: a, geometry: quad(l.lat, l.lon, ha) });
    let tm = 0, tp = 0;
    for (const e of a.especies_utilizadas.split(",")) {
      const tipo = R() > 0.35 ? "muda" : "propagulo", q = int(5, 60) * 100;
      const row = { globalid: gid(), parentglobalid: a.globalid, especie_material: e, tipo_material: tipo, quantidade_material: q };
      if (tipo === "muda") { row.origem_muda = R() > 0.25 ? "viveiro" : "transplante_com_raiz"; if (row.origem_muda === "viveiro") row.viveiro_origem = `VIV_DEMO_${int(1, 24)}`; tm += q; }
      else { row.origem_propagulo = "recolhido"; tp += q; }
      out.restauracao.tables.material_vegetal.push({ attributes: row });
    }
    a.total_mudas = tm; a.total_propagulos = tp;
    for (const ins of some(INST, 1, 3)) out.restauracao.tables.partes_executoras_rpt.push({ attributes: { globalid: gid(), parentglobalid: a.globalid, tipo_parte_executora: ins[1] + "_exec", nome_parte_executora: ins[0] } });
    const ip = pick(INST); out.restauracao.tables.partes_interessadas_rpt.push({ attributes: { globalid: gid(), parentglobalid: a.globalid, tipo_parte_interessada: ip[1], nome_parte_interessada: ip[0] } });
    const f = pick(INST); out.restauracao.tables.financiadores_grp.push({ attributes: { globalid: gid(), parentglobalid: a.globalid, tipo_financiador: f[1], nome_financiador: f[0], percentagem_aporte: 100 } });
  }

  // Tabela «Restauração em polígonos de mangal degradado» (normalmente criada pelo notebook)
  out.poligonos = { main: [], tables: {} };
  const SIG = { cabo_delgado: "CD", nampula: "NP", "zambézia": "ZB", sofala: "SF", inhambane: "IN", gaza: "GZ", "maputo_província": "MP", maputo_cidade: "MP" };
  for (const r of out.restauracao.main) {
    const a = r.attributes; if (a.em_area_degradada !== "mapeada") continue;
    const haR = a.area_total || 5, base0 = { id_area_restauracao: a.id_area_restauracao, projecto: a.nome_do_projecto, ano_indicado: a.ano_mapeamento, ha_restauracao: haR };
    if (R() < 0.15) { out.poligonos.main.push({ attributes: { globalid: gid(), ...base0, estado: "ponto_fora_de_poligono" }, geometry: null }); continue; }
    const anos = some([2018, 2019, 2020, 2021, 2022, 2023, 2024], 1, 2).sort();
    for (const ano of anos) {
      const hp = Math.round((0.4 + R() * 8) * 100) / 100, hs = Math.round(Math.min(hp, haR) * (0.3 + R() * 0.7) * 100) / 100;
      out.poligonos.main.push({ attributes: { globalid: gid(), ...base0, estado: "encontrado", ano, codigo_poligono: `${SIG[a.provincia] || "XX"}${ano}_${int(100, 50000)}`,
        provincia_mapa: a.provincia, ha_poligono: hp, ha_sobreposicao: hs, pct_poligono_restaurado: Math.round((hs / hp) * 1000) / 10, camada: `Demo ${ano}` }, geometry: null });
    }
  }

  // Monitoria
  out.monitoria = { main: [], tables: { parcelas: [], especie_q: [], medicoes: [], folhas_med: [] } };
  const ABUND = ["inexistente", "baixa", "moderada", "alta"];
  const STRESS = ["folhas_amarelas", "desfolha", "herbivoria", "pragas", "algas", "soterramento", "erosao", "danos", "lixo"];
  const projs = out.restauracao.main.map(r => r.attributes).filter(() => R() > 0.3);
  for (const p of projs) {
    const nv = int(1, 4);
    for (let v = 0; v < nv; v++) {
      const d = p.inicio_do_projecto + (v + 1) * int(150, 400) * 864e5;
      if (d > Date.now()) break;
      const anos = (d - p.inicio_do_projecto) / (365.25 * 864e5);
      const geo = out.restauracao.main.find(x => x.attributes === p).geometry.coordinates[0][0];
      const a = { globalid: gid(), CreationDate: d, id_area_restauracao: p.id_area_restauracao, nome_projecto: p.nome_do_projecto,
        inicio_projecto: new Date(p.inicio_do_projecto).toISOString().slice(0, 10), data1: d, tempo_anos: Math.round(anos * 10) / 10,
        temp_monitoria: anos < 1 ? "0_1" : anos < 3 ? "1_3" : anos < 5 ? "3_5" : "5_10", visita: v === 0 ? "linha_base" : "periodica",
        ameacas_observadas: some(["corte", "gado", "herbivoria", "cracas_algas", "sedimentacao", "erosao", "lixo"], 0, 2).join(",") || null,
        replantio_necessario: R() > 0.6 ? "sim" : "nao", participantes_homens: int(0, 15), participantes_mulheres: int(0, 18) };
      let pl = 0, vv = 0, rec = 0, afs = [];
      const np = R() > 0.15 ? int(2, 4) : 0;
      for (let k = 1; k <= np; k++) {
        const pa = { globalid: gid(), parentglobalid: a.globalid, codigo_parcela: `Q${String(k).padStart(2, "0")}`, area_parcela_m2: 100,
          cobertura_parcela: pick(["0_20", "21_40", "41_60", "61_80"]), fz_caranguejo: wpick(ABUND, [1, 3, 4, 3]), fz_gastropode: wpick(ABUND, [2, 4, 3, 1]),
          fz_bivalve: wpick(ABUND, [4, 3, 2, 1]), fz_peixes: wpick(ABUND, [3, 3, 3, 1]), buracos_scylla: wpick(ABUND, [3, 4, 2, 1]), fz_outros: wpick(ABUND, [6, 2, 1, 1]) };
        let ppl = 0, pvv = 0, prec = 0;
        const esps = some(ESP.slice(0, 4), 1, 3);
        for (const e of esps) {
          const plant = int(20, 60), taxaBase = { avicennia_marina: 0.75, rhizophora_mucronata: 0.62, ceriops_tagal: 0.55, bruguiera_gymnorrhiza: 0.45 }[e] || 0.5;
          const viv = Math.round(plant * Math.max(0.05, Math.min(1, taxaBase + (R() - 0.5) * 0.4 - v * 0.03))), rc = int(0, 12);
          ppl += plant; pvv += viv; prec += rc;
          out.monitoria.tables.especie_q.push({ attributes: { globalid: gid(), parentglobalid: pa.globalid, especies: e, plantadas_s: plant, vivas_s: viv,
            taxa_s: Math.round((viv / plant) * 1000) / 10, recrutas_s: rc, total_vivas_s: viv + rc } });
        }
        const alts = [], dias = [];
        for (let m = 1; m <= int(3, 6); m++) {
          const e = pick(esps), alt = Math.round(25 + anos * 45 + R() * 40), dia = Math.round((4 + anos * 9 + R() * 6) * 10) / 10;
          alts.push(alt); dias.push(dia);
          const st = R() < 0.45 ? ["nenhum"] : some(STRESS, 1, 2);
          const me = { globalid: gid(), parentglobalid: pa.globalid, especies_1: e, cod_planta: `${pa.codigo_parcela}-P${m}`, diametro: dia, altura_p: alt,
            ramos: a.temp_monitoria === "1_3" ? int(2, 12) : null, stress: st.join(","), intens_stress: st[0] === "nenhum" ? null : wpick(["baixa", "moderada", "alta"], [5, 3, 1]) };
          if (a.temp_monitoria === "0_1") {
            const fs = [];
            for (let fo = 1; fo <= int(2, 3); fo++) { const c = Math.round((3 + R() * 5) * 10) / 10, lg = Math.round((1.5 + R() * 2.5) * 10) / 10, ar = Math.round(2 / 3 * c * lg * 10) / 10; fs.push(ar);
              out.monitoria.tables.folhas_med.push({ attributes: { globalid: gid(), parentglobalid: me.globalid, folha_comp: c, folha_larg: lg, area_folha: ar } }); }
            me.n_folhas_med = fs.length; me.af_maior = Math.max(...fs); me.af_media_planta = Math.round(fs.reduce((x, y) => x + y, 0) / fs.length * 10) / 10; afs.push(...fs);
          }
          out.monitoria.tables.medicoes.push({ attributes: me });
        }
        Object.assign(pa, { especie_parcela: esps[0], plantas_plantadas: ppl, plantas_vivas: pvv, sobrevivencia_parcela: Math.round((pvv / ppl) * 1000) / 10,
          regeneracao_natural: prec, altura_media: Math.round(alts.reduce((x, y) => x + y, 0) / alts.length), diametro_medio: Math.round(dias.reduce((x, y) => x + y, 0) / dias.length * 10) / 10,
          estado_plantas: pvv / ppl > 0.6 ? "bom" : pvv / ppl > 0.35 ? "razoavel" : "mau" });
        out.monitoria.tables.parcelas.push({ attributes: pa });
        pl += ppl; vv += pvv; rec += prec;
      }
      a.regeneracao_total = rec;
      if (afs.length) a.af_media_total = Math.round(afs.reduce((x, y) => x + y, 0) / afs.length * 10) / 10;
      a.sobrevivencia_media = pl ? Math.round((vv / pl) * 1000) / 10 : null;
      out.monitoria.main.push({ attributes: a, geometry: pt(geo[1], geo[0]) });
    }
  }

  // Levantamento ecológico
  out.levantamento = { main: [], tables: { registro_plot: [], Medicoes: [], caules: [], Regenera: [] } };
  for (let i = 1; i <= 12; i++) {
    const l = local(), a = { ...base(l, 2021, 2026), id_levantamento_ecologico: `MG_DEMO_${i}`, nome_comunidade: `Comunidade Demo ${int(1, 40)}`, tipo_area_ligada: "nenhuma" };
    out.levantamento.main.push({ attributes: a, geometry: null });
    const flo = pick(["Oceananica", "Ribeirinha", "sobrelavado", "bacia", "Anao"]);
    for (let q = 1; q <= int(3, 8); q++) {
      const pa = { globalid: gid(), parentglobalid: a.globalid, data_1: date(2021, 2026), nome_floresta: `Floresta Demo ${i}`, plot_id: `Q${i}-${q}`,
        especie: wpick(ESP, ESP_P), cobertura: pick(["21_40", "41_60", "61_80", "81_100"]), floresta: flo, solo: pick(["Lodo", "Areia", "Areia/Argila"]),
        temp: Math.round((24 + R() * 8) * 10) / 10, sal: Math.round((25 + R() * 15) * 10) / 10, pH: Math.round((6.8 + R() * 1.4) * 10) / 10, od: Math.round((4 + R() * 4) * 10) / 10, Equipamento: "suta" };
      out.levantamento.tables.registro_plot.push({ attributes: pa, geometry: pt(l.lat + (R() - 0.5) * 0.02, l.lon + (R() - 0.5) * 0.02) });
      for (let t = 1; t <= int(10, 30); t++) {
        const ta = { globalid: gid(), parentglobalid: pa.globalid, MALGAL_1: wpick(ESP, ESP_P), codigo_arvore: `${pa.plot_id}-A${t}`, condicao: wpick(["I", "PC", "SC", "cepo", "MN"], [75, 10, 4, 7, 4]), qualidade: pick(["I", "II", "III"]) };
        out.levantamento.tables.Medicoes.push({ attributes: ta });
        for (let c = 1; c <= (R() > 0.8 ? 2 : 1); c++) { const dap = Math.round((3 + R() * 22) * 10) / 10; out.levantamento.tables.caules.push({ attributes: { globalid: gid(), parentglobalid: ta.globalid, dap_caule: dap, dap_caule_calc: dap, altura: Math.round((2 + R() * 9) * 10) / 10, n_caule: c } }); }
      }
      for (const e of some(ESP.slice(0, 5), 1, 3)) for (const rc of ["RCI", "RCII", "RCIII"]) out.levantamento.tables.Regenera.push({ attributes: { globalid: gid(), parentglobalid: pa.globalid, MALGAL_2: e, regeneracao: rc, individuos: int(0, rc === "RCI" ? 40 : rc === "RCII" ? 15 : 6) } });
    }
  }

  // Ervas marinhas
  out.ervas = { main: [], tables: { dominancia: [], gestores_rpt: [], apoio_externo_rpt: [] } };
  for (let i = 1; i <= 20; i++) {
    const l = local(), esp = some(ERVAS, 1, 4), a = { ...base(l, 2022, 2026), nome_tapete: `Tapete Demo ${i}`, nome_comunidade: `Comunidade Demo ${int(1, 40)}`,
      data_observacao: date(2022, 2026), registro_especies: esp.join(","), cobertura_total: int(10, 85),
      ameacas: some(["Âncora/Danos_de_barcos", "Pisoteio_excessivo", "Celecta_de_invertebrados_(escavação)", "Pesca_de_arrasto", "Sedimentação", "Poluição"], 1, 3).join(","),
      fauna_presente: some(["tartaruga", "dugongos", "peixes", "moluscos", "crustáceos", "Equinodermes", "Cavalos-marinhos"], 1, 4).join(","),
      exposicao: pick(["Protegido", "Moderado", "Exposto"]), iniciativa_de_gestao: R() > 0.5 ? "sim" : "nao", fiscalizacao: pick(["sim_regular", "sim_ocasional", "nao", "nao"]),
      restauro: pick(["nunca", "nunca", "sim", "tentativas_anteriores"]) };
    const c = CENTROS[l.p];
    out.ervas.main.push({ attributes: a, geometry: quad(c[0] + (R() - 0.5) * 0.8, c[1] + 0.15 + R() * 0.2, int(2, 40)) });
    for (const e of esp) out.ervas.tables.dominancia.push({ attributes: { globalid: gid(), parentglobalid: a.globalid, especie_codigo: e, escala_dominancia: pick(["minima", "baixa", "moderada", "alta", "muito_alta"]) } });
    if (a.iniciativa_de_gestao === "sim") { const g = pick(INST); out.ervas.tables.gestores_rpt.push({ attributes: { globalid: gid(), parentglobalid: a.globalid, tipo_entidade_gestora: g[1], nome_entidade_gestora: g[0] } }); }
  }
  for (const ds of ["viveiros", "degradadas", "restauracao", "monitoria", "levantamento", "ervas"]) for (const r of out[ds].main) Object.assign(r.attributes, quem());

  // Preenche campos obrigatórios em falta (os dados de demonstração devem passar a validação),
  // deixando alguns problemas de propósito para a Área técnica ter exemplos.
  if (schema) for (const [ds, D] of Object.entries(out)) {
    const sc = schema[ds]; if (!sc) continue;
    const todas = [["main", D.main], ...Object.entries(D.tables)];
    for (const [tb, rows] of todas) {
      const campos = (sc.tables[tb] && sc.tables[tb].fields) || {};
      rows.forEach((row, i) => {
        const a = row.attributes;
        for (const [c, f] of Object.entries(campos)) {
          if (!f.required || (a[c] !== undefined && a[c] !== null && a[c] !== "")) continue;
          if (c.startsWith("codigo_")) continue; // registos antigos sem código de técnico (exemplo para a validação)
          if (i % 23 === 7) continue; // problema intencional
          if (f.type === "select_one") { const L = choices[f.list] || {}; const ks = Object.keys(L).filter(k => !L[k].distrito || L[k].distrito === a.distrito); a[c] = ks[0] || null; }
          else if (f.type === "select_multiple") a[c] = Object.keys(choices[f.list] || {})[0] || null;
          else if (f.type === "integer" || f.type === "decimal") a[c] = 1;
          else if (f.type === "date") a[c] = a.CreationDate || Date.UTC(2024, 0, 1);
          else if (["text", "calculate", "select_one_from_file"].includes(f.type)) a[c] = c.startsWith("nome") ? "Pessoa de demonstração" : "Demo";
        }
      });
    }
    if (D.main[5] && !["levantamento", "entidades", "poligonos"].includes(ds)) D.main[5].geometry = null; // registo sem localização (exemplo)
  }
  return out;
}
