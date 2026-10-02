/**
 * Análise Gold da PAC (Domus / WeAxis) · mesma lógica do guia "logica_relatorio_pac.md".
 * Este arquivo é a fonte; o mesmo código está colado no Apps Script (Codigo.gs, seção "Gold").
 *
 * Regras principais:
 *  - base Gold = linhas sem "PI Verticalizado = Sim"; Sigma não identificável nas PACs atuais (não excluído, declarado)
 *  - dado faltante nunca vira zero (null); afeta só os cálculos que dependem dele e marca "parcial"
 *  - Empresa total = recálculo sobre as linhas somadas, nunca média das filiais
 *  - 6 indicadores: estoque a custo, DIO, CCC, NWC, ruptura ponderada (% e R$/dia), excesso acima do Emax
 *  - listas (não são indicadores): top ruptura (AA/A primeiro), estoque congelado (sem giro),
 *    campeões (maior giro a custo) e azarões (burst: ritmo dos últimos 15 dias × ritmo dos 45 anteriores)
 */

function goldNum_(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === 'number') return isFinite(x) ? x : null;
  let s = String(x).trim();
  if (!s || s === '-' || /[a-z]/i.test(s.replace(/R\$/g, ''))) return null;
  s = s.replace(/R\$|%|\s/g, '').replace(/\./g, '').replace(',', '.');
  const v = parseFloat(s);
  return isNaN(v) ? null : v;
}

/** Lê a matriz de valores de uma aba de PAC e devolve as linhas normalizadas. */
function goldLinhas_(v, filial) {
  const hi = v.findIndex(r => r.some(c => String(c).trim().replace(/^.*\s/, '') === 'MVD' || String(c).trim() === 'MVD'));
  if (hi < 0) throw new Error('Cabeçalho da PAC não encontrado (coluna MVD).');
  const H = v[hi].map(c => String(c).trim().replace(/^(Tag:|Fornecedor:|Verticalizados)\s*/i, '').replace(/^O\s+(?=SKU$)/, '').trim());
  const idx = (...nomes) => { for (const n of nomes) { const i = H.findIndex(h => h.toLowerCase() === n.toLowerCase()); if (i >= 0) return i; } return -1; };
  const C = {
    sku: idx('SKU'), tit: idx('Título', 'Titulo'), forn: idx('Fornecedor'), custo: idx('Custo'), est: idx('Estoque'),
    pi: idx('PI Verticalizado', 'PI'), oc: idx('OC Trânsito', 'OC Transito'), lt: idx('LT'), curva: idx('Curva'),
    d15: idx('D-15'), d30: idx('D-30'), d60: idx('D-60'), mvd: idx('MVD'), emax: idx('Emax'), dpo: idx('DPO'), dso: idx('DSO'),
  };
  ['sku', 'custo', 'est', 'mvd'].forEach(k => { if (C[k] < 0) throw new Error(`Coluna ${k} não encontrada na PAC de ${filial}.`); });
  const g = (r, k) => C[k] >= 0 ? r[C[k]] : null;
  const vistos = {}, linhas = []; let dup = 0;
  v.slice(hi + 1).forEach(r => {
    const sku = String(g(r, 'sku') || '').trim(); if (!sku) return;
    const chave = JSON.stringify(r);
    if (vistos[chave]) { dup++; return; } vistos[chave] = 1;   // só duplicata exata
    const d15 = goldNum_(g(r, 'd15')), d30 = goldNum_(g(r, 'd30')), d60 = goldNum_(g(r, 'd60'));
    let m = goldNum_(g(r, 'mvd'));
    if (m === null && d15 !== null && d30 !== null && d60 !== null) m = (d15 / 15 + d30 / 30 + d60 / 60) / 3;
    linhas.push({
      filial, sku, titulo: String(g(r, 'tit') || ''), forn: String(g(r, 'forn') || ''),
      c: goldNum_(g(r, 'custo')), q: goldNum_(g(r, 'est')), pi: /^sim$/i.test(String(g(r, 'pi') || '').trim()),
      oc: goldNum_(g(r, 'oc')) || 0, lt: goldNum_(g(r, 'lt')), curva: String(g(r, 'curva') || '').trim().toUpperCase() || '?',
      d15, d30, d60, m, emax: goldNum_(g(r, 'emax')), dpo: goldNum_(g(r, 'dpo')), dso: goldNum_(g(r, 'dso')),
    });
  });
  return { linhas, duplicatas: dup };
}

/** Os 6 indicadores Gold + aberturas e listas, sobre um conjunto de linhas (uma filial ou todas). */
function goldCalc_(todas, meta) {
  const L = todas.filter(x => !x.pi);
  const pi = todas.filter(x => x.pi);
  const temC = x => x.c !== null && x.c > 0;
  const qp = x => Math.max(x.q || 0, 0);
  let E = 0, Gd = 0, Gp = 0, pesoP = 0, sDPO = 0, sDSO = 0, nwc = 0, exc = 0, excGiro = 0, semGiro = 0, unid = 0;
  let semPrazo = 0, giroSemPrazo = 0, semCusto = 0, nwcParcial = false, mvdFalta = 0;
  const curvas = {}; ['AA', 'A', 'B', 'C', 'D'].forEach(k => curvas[k] = { ativos: 0, ruptura: 0, perda: 0, giro: 0, giro_perdido: 0 });
  L.forEach(x => {
    if (!temC(x)) { if ((x.q || 0) > 0 || (x.m || 0) > 0) semCusto++; return; }
    const q = x.q, m = x.m, c = x.c;
    if (m === null) mvdFalta++;
    if (q !== null && q > 0) { E += q * c; unid += q; }
    if (x.emax !== null && q !== null) { const e = Math.max(Math.max(q, 0) - x.emax, 0) * c; exc += e; if (m && m > 0) excGiro += e; }
    if (q > 0 && m === 0) semGiro += q * c;
    const cv = curvas[x.curva];
    if (m > 0 && q > 0) {
      Gd += m * c; if (cv) { cv.ativos++; cv.giro += m * c; }
      if (x.dpo !== null && x.dso !== null) { pesoP += m * c; sDPO += m * c * x.dpo; sDSO += m * c * x.dso; nwc += q * c + m * c * (x.dso - x.dpo); }
      else { semPrazo++; giroSemPrazo += m * c; nwcParcial = true; }
    } else if (m > 0 && (q === null || q <= 0)) {
      Gp += m * c; if (cv) { cv.ativos++; cv.ruptura++; cv.perda += m * c; cv.giro_perdido += m * c; }
    } else if (q > 0 && m === 0) nwc += q * c;
    else if (q > 0 && m === null) nwcParcial = true;
  });
  const dio = Gd > 0 ? E / Gd : null;
  const dpo = pesoP > 0 ? sDPO / pesoP : null, dso = pesoP > 0 ? sDSO / pesoP : null;
  const ccc = dio !== null && dpo !== null ? dio + dso - dpo : null;
  const Gpot = Gd + Gp;
  const rup = L.filter(x => temC(x) && x.m > 0 && (x.q === null || x.q <= 0));
  const ordemCurva = k => ({ AA: 0, A: 0, B: 1, C: 2, D: 3 }[k] ?? 4);
  const item = x => ({ sku: x.sku, filial: x.filial, titulo: x.titulo, curva: x.curva, forn: x.forn, mvd: x.m, custo: x.c, estoque: x.q, oc: x.oc, lt: x.lt });

  // listas
  const top_ruptura = rup.slice().sort((a, b) => ordemCurva(a.curva) - ordemCurva(b.curva) || b.m * b.c - a.m * a.c).slice(0, 5)
    .map(x => Object.assign(item(x), { perdido: x.m * x.c }));
  const cong = L.filter(x => temC(x) && x.q > 0 && x.m === 0);
  const congelados = cong.slice().sort((a, b) => b.q * b.c - a.q * a.c).slice(0, 5)
    .map(x => Object.assign(item(x), { valor: x.q * x.c, d60: x.d60 }));
  const campeoes = L.filter(x => temC(x) && x.m > 0).sort((a, b) => b.m * b.c - a.m * a.c).slice(0, 5)
    .map(x => Object.assign(item(x), { giro: x.m * x.c, cobertura: x.q > 0 ? x.q / x.m : 0 }));
  const azaroes = L.filter(x => temC(x) && x.d15 !== null && x.d60 !== null && x.d15 >= 15).map(x => {
    const ritmo15 = x.d15 / 15, ant45 = Math.max(x.d60 - x.d15, 0) / 45;
    return { x, ritmo15, ant45, fator: ant45 > 0 ? ritmo15 / ant45 : null };
  }).filter(z => (z.fator === null || z.fator >= 2.5) && z.x.curva !== 'AA')
    .sort((a, b) => (b.fator ?? 99) * Math.sqrt(b.ritmo15 * b.x.c) - (a.fator ?? 99) * Math.sqrt(a.ritmo15 * a.x.c)).slice(0, 5)
    .map(z => Object.assign(item(z.x), { d15: z.x.d15, ritmo15: z.ritmo15, ritmo_ant: z.ant45, fator: z.fator, cobertura: z.x.q > 0 ? z.x.q / z.ritmo15 : 0 }));

  const porForn = (arr, f) => { const o = {}; arr.forEach(x => o[x.forn] = (o[x.forn] || 0) + f(x)); return Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([nome, v]) => ({ nome, valor: v })); };
  return Object.assign({}, meta, {
    skus: L.length, skus_pi: pi.length, estoque_pi: pi.reduce((s, x) => s + (temC(x) ? qp(x) * x.c : 0), 0),
    estoque: E, unidades: Math.round(unid), giro_disp: Gd, mvd_perdida: Gp, ruptura_pct: Gpot > 0 ? Gp / Gpot * 100 : null,
    dio, dpo, dso, ccc, nwc, excesso: exc, sem_giro: semGiro,
    prazo_parcial: semPrazo > 0, nwc_parcial: nwcParcial, linhas_sem_prazo: semPrazo, giro_sem_prazo: giroSemPrazo, linhas_sem_custo: semCusto, mvd_ausente: mvdFalta,
    skus_ruptura: rup.length, rupturas_com_oc: rup.filter(x => x.oc > 0).length, skus_congelados: cong.length,
    curvas, top_ruptura, congelados, campeoes, azaroes,
    forn_ruptura: porForn(rup, x => x.m * x.c), forn_excesso: porForn(L.filter(x => temC(x) && x.emax !== null && x.q > x.emax), x => (x.q - x.emax) * x.c),
    // para a coluna 3 (barra de qualidade) e o e-mail
    valor_custo: E, cobertura_dias: dio, parado_valor: semGiro, parado_skus: cong.length, excesso_valor: excGiro,
    saudavel_valor: Math.max(E - semGiro - excGiro, 0), perda_dia_custo: Gp, pct_ruptura: Gpot > 0 ? Gp / Gpot * 100 : null,
    skus_ativos: L.filter(x => temC(x) && x.m > 0).length, sem_oc: rup.filter(x => !(x.oc > 0)).length,
  });
}
