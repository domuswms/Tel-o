/**
 * Telão WeAxis · automação no Google (Apps Script)
 *
 * Faz, sem ninguém mexer:
 *   1. atualizarEstoque()   todo dia às 06h  · lê as PACs (Itajaí e Londrina) e publica colunas/mural/estoque.json
 *   2. publicarMural()      a cada 10 min    · lê as respostas do formulário e publica colunas/mural/mural.json
 *   3. enviarEmailDiario()  todo dia às 07h30 · newsletter Radar Domus (de radar@domuscommerce.com) para a aba Assinantes
 *   4. publicarMetas()      ao editar a aba Metas · publica colunas/meta/metas.json (a meta aparece no telão em ~1 min)
 *   Menu "Telão" na planilha de metas: atualizar agora, pedir notícias novas, enviar e-mail, diagnóstico.
 *   Algo falhou? Rode diagnostico() e veja o Registro de execução.
 *
 * Sem o GitHub configurado, o e-mail já funciona (estoque direto das PACs + metas da planilha);
 * o telão passa a receber os dados quando GITHUB_OWNER e GITHUB_TOKEN forem preenchidos.
 *
 * Instalação (uma vez só): veja automacao/README.md, passo "Apps Script".
 * O token do GitHub fica em Propriedades do script (GITHUB_TOKEN), nunca no código.
 */

const CFG = {
  GITHUB_OWNER: 'NOME-DA-ORGANIZACAO',      // ex.: domuscommerce
  GITHUB_REPO: 'telao-weaxis',
  GITHUB_BRANCH: 'main',
  // uma PAC por filial. Filial sem 'id' fica de fora até ser preenchida (e o total só aparece com todas)
  PACS: {
    // a aba de cada PAC tem o estoque inteiro da filial (as abas com nome de analista são só divisão de leitura)
    itajai:   { nome: 'Itajaí',   id: '17xjD_hJq1V_vpydBPeY25NQWbL9F9GwlQqM2HhIymPE', aba: 'Gustavo', base: 'SC' },
    londrina: { nome: 'Londrina', id: '1f-JzRrFNtKh_EUzeLcgvszLkibvvYP4KDcupJzL4tnw', aba: 'COMPRAS', base: 'PR' },
  },
  EMAILS: ['joao.vitor@domuscommerce.com'],  // primeiros assinantes (nível completo); depois a lista fica na aba Assinantes
  REMETENTE: 'radar@domuscommerce.com',      // instale o script logado nesta conta: o Radar sai dela
  REMETENTE_NOME: 'Radar Domus',
  DOMINIO: 'domuscommerce.com',
  APROVACAO_AUTOMATICA: true,                // false = só vai ao telão quem tiver "sim" na coluna Aprovado
  MIDIA_MAX_MB: 25,
  FUSO: 'America/Sao_Paulo',
};

// ===================================================================== instalação

/** Rode uma vez (pode rodar de novo sem duplicar nada). Cria o formulário, a planilha do telão (respostas + aba Metas) e os gatilhos. */
function configurarTudo() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('GITHUB_TOKEN')) Logger.log('Aviso: GITHUB_TOKEN ainda não definido. E-mail funciona; o telão só recebe dados depois do token.');
  if (props.getProperty('FORM_ID')) { instalarGatilhos_(SpreadsheetApp.openById(props.getProperty('RESPOSTAS_ID'))); return Logger.log('Já configurado. Gatilhos reinstalados. Planilha: ' + SpreadsheetApp.openById(props.getProperty('RESPOSTAS_ID')).getUrl()); }

  const form = FormApp.create('Telão · publicar no mural');
  form.setDescription('O que você enviar aqui aparece na coluna da direita do telão (em até 10 minutos). Seja curto: o telão lê como faixa.');
  form.setCollectEmail(true);
  form.addTextItem().setTitle('Seu nome').setRequired(true);
  form.addMultipleChoiceItem().setTitle('Tipo').setRequired(true)
    .setChoiceValues(['Meta batida', 'Ação tomada', 'Alerta', 'Comemoração', 'Aviso'])
    .setHelpText('Define a cor e a animação no telão.');
  form.addTextItem().setTitle('Título').setRequired(true).setHelpText('Até 40 caracteres.')
    .setValidation(FormApp.createTextValidation().requireTextLengthLessThanOrEqualTo(40).build());
  form.addParagraphTextItem().setTitle('Texto').setRequired(true).setHelpText('Até 90 caracteres.')
    .setValidation(FormApp.createParagraphTextValidation().requireTextLengthLessThanOrEqualTo(90).build());
  form.addTextItem().setTitle('Número de destaque (opcional)').setHelpText('Ex.: 43,6%  ·  R$ 19,6 mil  ·  120 SKUs')
    .setValidation(FormApp.createTextValidation().requireTextLengthLessThanOrEqualTo(14).build());
  form.addTextItem().setTitle('Legenda do número (opcional)').setHelpText('Até 30 caracteres.')
    .setValidation(FormApp.createTextValidation().requireTextLengthLessThanOrEqualTo(30).build());
  form.addDateItem().setTitle('Fica no ar até').setRequired(true);

  const ss = SpreadsheetApp.create('Telão WeAxis · metas e mural');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  props.setProperty('FORM_ID', form.getId());
  props.setProperty('RESPOSTAS_ID', ss.getId());
  criarAbaMetas_(ss);
  abaAssinantes_();
  instalarGatilhos_(ss);

  Logger.log('Formulário (para os analistas): ' + form.getPublishedUrl());
  Logger.log('Edição do formulário: ' + form.getEditUrl());
  Logger.log('Planilha do telão (aba Metas = onde você altera a meta): ' + ss.getUrl());
  Logger.log('Diagnóstico:\n' + diagnostico());
  Logger.log('FALTA 1 PASSO MANUAL: no formulário, adicione a pergunta "Upload de arquivo" com o título "Mídia (opcional)" (o Apps Script não consegue criar esse tipo).');
}

function instalarGatilhos_(ss) {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('publicarMural').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('atualizarEstoque').timeBased().atHour(6).nearMinute(0).everyDays(1).inTimezone(CFG.FUSO).create();
  ScriptApp.newTrigger('enviarEmailDiario').timeBased().atHour(7).nearMinute(30).everyDays(1).inTimezone(CFG.FUSO).create();
  ScriptApp.newTrigger('publicarMetas').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('montarMenu').forSpreadsheet(ss).onOpen().create();
}

// ===================================================================== metas (aba Metas da planilha do telão)

function criarAbaMetas_(ss) {
  const sh = ss.getSheetByName('Metas') || ss.insertSheet('Metas', 0);
  sh.clear();
  sh.getRange(1, 1, 1, 4).setValues([['Mês (AAAA-MM)', 'Meta da Domus (R$)', 'Exemplo? (sim/não)', 'Observação']]).setFontWeight('bold').setBackground('#212121').setFontColor('#ECFC30');
  sh.getRange(2, 1, 1, 4).setValues([['2026-10', 21000000, 'sim', 'Itajaí + Londrina somadas']]);
  sh.getRange('A:A').setNumberFormat('@'); sh.getRange('B:B').setNumberFormat('"R$" #,##0');
  sh.setColumnWidths(1, 4, 190); sh.setFrozenRows(1);
  sh.getRange('F1').setValue('Edite a linha do mês. O telão atualiza a meta, a projeção e o ritmo em cerca de 1 minuto.');
}

/** Lê a aba Metas: { 'AAAA-MM': { meta, exemplo } } */
function lerMetas_() {
  const id = PropertiesService.getScriptProperties().getProperty('RESPOSTAS_ID'); if (!id) return {};
  const sh = SpreadsheetApp.openById(id).getSheetByName('Metas'); if (!sh) return {};
  const out = {};
  sh.getDataRange().getValues().slice(1).forEach(r => {
    let mes = r[0] instanceof Date ? Utilities.formatDate(r[0], CFG.FUSO, 'yyyy-MM') : String(r[0]).trim();
    const meta = typeof r[1] === 'number' ? r[1] : parseFloat(String(r[1]).replace(/R\$|\s|\./g, '').replace(',', '.'));
    if (/^\d{4}-\d{2}$/.test(mes) && meta > 0) out[mes] = { meta, exemplo: /^s/i.test(String(r[2]).trim()) };
  });
  return out;
}

function publicarMetas(e) {
  if (e && e.range && e.range.getSheet().getName() !== 'Metas') return;
  const m = lerMetas_();
  const out = Object.assign({ _info: 'Meta de faturamento por mês (R$), da empresa toda (Itajaí + Londrina). Gerado pela aba Metas da planilha do telão. Não editar à mão.' }, m);
  Logger.log(publicar_('colunas/meta/metas.json', JSON.stringify(out, null, 1), 'metas: ' + Object.entries(m).map(([k, v]) => `${k} ${v.meta}`).join(', ')));
}

/** Projeção linear no ritmo atual e ritmo necessário até o fim do mês. */
function projecao_(realizado, meta, refISO) {
  const [y, mo, d] = refISO.split('-').map(Number), dias = new Date(y, mo, 0).getDate();
  const ritmo = realizado / d, proj = ritmo * dias, falta = Math.max(0, meta - realizado), rest = dias - d;
  return { dias, dia: d, ritmo, proj, pct_proj: proj / meta * 100, necessario: rest > 0 ? falta / rest : 0, restantes: rest };
}

/** Abre a aba da PAC com mensagem clara quando falta acesso ou o nome da aba mudou. */
function abrirPac_(p) {
  let ss;
  try { ss = SpreadsheetApp.openById(p.id); }
  catch (e) { throw new Error(`Sem acesso à PAC de ${p.nome}. Abra a planilha com a conta ${Session.getEffectiveUser().getEmail()} ou peça ao dono para compartilhar com ela. (${e.message})`); }
  const sh = ss.getSheetByName(p.aba) || ss.getSheets().find(x => x.getName().trim().toLowerCase() === p.aba.trim().toLowerCase());
  if (!sh) throw new Error(`Aba "${p.aba}" não existe na PAC de ${p.nome}. Abas: ${ss.getSheets().map(x => x.getName()).join(', ')}`);
  return sh;
}

// ===================================================================== diagnóstico e atualização manual

/** Rode quando algo não funcionar: testa cada etapa e diz o que falta, sem parar no primeiro erro. */
function diagnostico() {
  const ok = [], erro = [];
  const t = (nome, fn) => { try { const r = fn(); ok.push(`OK  ${nome}${r ? ' · ' + r : ''}`); } catch (e) { erro.push(`ERRO ${nome} · ${e.message}`); } };
  t('Conta que roda o script', () => Session.getEffectiveUser().getEmail());
  Object.values(CFG.PACS).forEach(p => t(`PAC ${p.nome} (aba ${p.aba})`, () => { const v = abrirPac_(p).getDataRange().getValues(); const e = calcEstoque_(v, p.nome, p.base, p.aba); return `${e.skus} SKUs · estoque R$ ${Math.round(e.valor_custo).toLocaleString('pt-BR')} · ruptura ${e.pct_ruptura}%`; }));
  t('Planilha do telão (metas e mural)', () => { const id = PropertiesService.getScriptProperties().getProperty('RESPOSTAS_ID'); if (!id) throw new Error('ainda não criada: rode configurarTudo'); return SpreadsheetApp.openById(id).getUrl(); });
  t('Metas', () => JSON.stringify(lerMetas_()));
  t('Gatilhos automáticos', () => { const g = ScriptApp.getProjectTriggers().map(x => x.getHandlerFunction()); if (!g.length) throw new Error('nenhum: rode configurarTudo'); return g.join(', '); });
  t('GitHub', () => { if (!githubOk_()) throw new Error('falta GITHUB_OWNER no código e/ou GITHUB_TOKEN nas propriedades (o e-mail funciona sem isso)'); const r = gh_('README.md', 'get'); if (r.code !== 200) throw new Error('resposta ' + r.code + ' (token sem acesso ao repositório?)'); return 'acesso ok'; });
  t('Remetente do Radar', () => { const q = Session.getEffectiveUser().getEmail(); if (q.toLowerCase() !== CFG.REMETENTE) throw new Error(`o script roda como ${q}; para sair de ${CFG.REMETENTE}, instale-o logado nessa conta`); return q; });
  t('Assinantes', () => { const l = lerAssinantes_(); return `${l.filter(a => a.ativo).length} ativos (${l.filter(a => a.ativo && a.nivel === 'completo').length} completo)`; });
  t('Página de inscrição (web app)', () => { const u = ScriptApp.getService().getUrl(); if (!u) throw new Error('não implantada: Implantar > Nova implantação > App da Web'); return u; });
  t('Cota de e-mail hoje', () => MailApp.getRemainingDailyQuota() + ' envios restantes');
  const txt = [...ok, ...erro].join('\n');
  Logger.log(txt);
  return txt;
}

/** Menu "Telão" na planilha de metas e mural (instalado por configurarTudo). */
function montarMenu() {
  SpreadsheetApp.getUi().createMenu('Telão')
    .addItem('Atualizar estoque agora', 'atualizarEstoque')
    .addItem('Publicar mural agora', 'publicarMural')
    .addItem('Publicar metas agora', 'publicarMetas')
    .addSeparator()
    .addItem('Radar: enviar teste só para mim', 'enviarTeste')
    .addItem('Radar: enviar agora para todos', 'enviarEmailDiario')
    .addItem('Radar: adicionar pessoas', 'adicionarAssinante')
    .addItem('Radar: remover pessoas', 'removerAssinante')
    .addItem('Radar: importar toda a organização', 'importarOrganizacao')
    .addSeparator()
    .addItem('Pedir notícias e análises novas', 'pedirAtualizacao')
    .addItem('Atualizar tudo agora (Google) + pedir notícias', 'atualizarTudoAgora')
    .addSeparator()
    .addItem('Diagnóstico', 'diagnosticoNaTela')
    .addToUi();
}

function diagnosticoNaTela() { SpreadsheetApp.getUi().alert('Diagnóstico do telão', diagnostico(), SpreadsheetApp.getUi().ButtonSet.OK); }

/** Grava automacao/pedido.json no repositório. A rotina do Claude verifica esse pedido a cada hora (08h–19h) e roda faturamento + notícias na hora. */
function pedirAtualizacao() {
  const quem = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  const r = publicar_('automacao/pedido.json', JSON.stringify({ pedido_em: agoraISO_(), por: quem, o_que: ['faturamento', 'noticias'] }, null, 1), `pedido de atualização manual (${quem})`);
  const msg = r === 'sem GitHub' ? 'GitHub ainda não configurado: o pedido não pôde ser enviado.' : 'Pedido enviado. Notícias e faturamento entram no telão em até 1 hora.';
  try { SpreadsheetApp.getActive().toast(msg, 'Telão', 8); } catch (e) { }
  Logger.log(msg);
}

function atualizarTudoAgora() {
  const passos = [['estoque', atualizarEstoque], ['metas', publicarMetas], ['mural', publicarMural], ['pedido de notícias', pedirAtualizacao]];
  const res = passos.map(([n, fn]) => { try { fn(); return `OK ${n}`; } catch (e) { return `ERRO ${n}: ${e.message}`; } });
  try { SpreadsheetApp.getActive().toast(res.join(' · '), 'Telão', 10); } catch (e) { }
  Logger.log(res.join('\n'));
}

// ===================================================================== GitHub

const githubOk_ = () => !!PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN') && CFG.GITHUB_OWNER !== 'NOME-DA-ORGANIZACAO';

function gh_(path, method, body) {
  if (!githubOk_()) return { code: 0, json: null };
  const url = `https://api.github.com/repos/${CFG.GITHUB_OWNER}/${CFG.GITHUB_REPO}/contents/${path}`;
  const r = UrlFetchApp.fetch(url + (method === 'get' ? `?ref=${CFG.GITHUB_BRANCH}` : ''), {
    method, muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN'), Accept: 'application/vnd.github+json' },
    payload: body ? JSON.stringify(body) : undefined,
  });
  return { code: r.getResponseCode(), json: (() => { try { return JSON.parse(r.getContentText()); } catch (e) { return null; } })() };
}

/** Grava (cria ou substitui) um arquivo no repositório. Só faz commit se o conteúdo mudou. */
function publicar_(path, bytesOuTexto, msg) {
  if (!githubOk_()) { Logger.log('GitHub ainda não configurado: não publiquei ' + path); return 'sem GitHub'; }
  const atual = gh_(path, 'get');
  const b64 = typeof bytesOuTexto === 'string'
    ? Utilities.base64Encode(bytesOuTexto, Utilities.Charset.UTF_8)
    : Utilities.base64Encode(bytesOuTexto);
  if (atual.code === 200 && atual.json && String(atual.json.content || '').replace(/\n/g, '') === b64) return 'igual';
  const r = gh_(path, 'put', { message: msg, content: b64, branch: CFG.GITHUB_BRANCH, sha: atual.code === 200 ? atual.json.sha : undefined });
  if (r.code >= 300) throw new Error(`GitHub ${r.code} em ${path}: ${JSON.stringify(r.json)}`);
  return 'ok';
}

function lerRepo_(path) {
  const r = gh_(path, 'get');
  if (r.code !== 200) return null;
  return JSON.parse(Utilities.newBlob(Utilities.base64Decode(r.json.content.replace(/\n/g, ''))).getDataAsString('UTF-8'));
}

const agoraISO_ = () => Utilities.formatDate(new Date(), CFG.FUSO, "yyyy-MM-dd'T'HH:mm:ssXXX");
const hoje_ = () => Utilities.formatDate(new Date(), CFG.FUSO, 'yyyy-MM-dd');

// ===================================================================== 1. estoque por filial (PACs)

/** Quantidade e qualidade do estoque de uma PAC (matriz de valores com a linha de cabeçalho que contém "MVD"). */
function calcEstoque_(v, nome, base, fonte) {
  const hi = v.findIndex(r => r.some(c => String(c).trim() === 'MVD'));
  const H = v[hi].map(c => String(c).trim());
  const col = n => { const i = H.indexOf(n); return i >= 0 ? i : H.findIndex(h => h.endsWith(n)); };
  const C = { sku: col('SKU'), tit: col('Título'), forn: col('Fornecedor'), custo: col('Custo'), est: col('Estoque'), oc: col('OC Trânsito'), curva: col('Curva'), mvd: col('MVD'), emax: col('Emax') };
  const num = x => typeof x === 'number' ? x : (parseFloat(String(x).replace(/R\$|\s|\./g, '').replace(',', '.')) || 0);
  const it = v.slice(hi + 1).filter(r => r[C.sku]).map(r => ({ sku: String(r[C.sku]).trim(), titulo: String(r[C.tit]), forn: String(r[C.forn]), custo: num(r[C.custo]), est: num(r[C.est]), oc: num(r[C.oc]), curva: String(r[C.curva]).trim() || '?', mvd: num(r[C.mvd]), emax: num(r[C.emax]) }));
  const r2 = x => Math.round(x * 100) / 100;
  const ativos = it.filter(x => x.mvd > 0), rup = ativos.filter(x => x.est <= 0);
  const perda = x => x.mvd * x.custo, soma = (a, f) => a.reduce((s, x) => s + f(x), 0);
  const comEst = it.filter(x => x.est > 0);
  const valor = soma(comEst, x => x.est * x.custo);
  const parado = comEst.filter(x => x.mvd <= 0);
  const exc = comEst.filter(x => x.mvd > 0 && x.emax > 0 && x.est > x.emax);
  const vParado = soma(parado, x => x.est * x.custo), vExc = soma(exc, x => (x.est - x.emax) * x.custo);
  const vendaDiaCusto = soma(ativos, perda);
  const curvas = {}; ['AA', 'A', 'B', 'C', 'D'].forEach(k => { const a = ativos.filter(x => x.curva === k), r = a.filter(x => x.est <= 0); curvas[k] = { ativos: a.length, ruptura: r.length, perda: r2(soma(r, perda)) }; });
  const porForn = {}; rup.forEach(x => porForn[x.forn] = (porForn[x.forn] || 0) + perda(x));
  const curto = n => n.replace(/\s+(INDUSTRIA|INDUSTRIAL|IMPORTADORA|DISTRIBUIDORA|ELETRODOMESTICOS|COMERCIO|LTDA|S\.?\s?A\.?|E|DA|DE|DO)\b.*$/i, '');
  return {
    nome, base, fonte,
    skus: it.length, skus_com_estoque: comEst.length, unidades: Math.round(soma(comEst, x => x.est)), valor_custo: r2(valor),
    cobertura_dias: vendaDiaCusto ? Math.round(valor / vendaDiaCusto * 10) / 10 : null,
    venda_dia_custo: r2(vendaDiaCusto),
    saudavel_valor: r2(valor - vParado - vExc), excesso_valor: r2(vExc), excesso_skus: exc.length, parado_valor: r2(vParado), parado_skus: parado.length,
    skus_ativos: ativos.length, skus_ruptura: rup.length, pct_ruptura: r2(rup.length / Math.max(1, ativos.length) * 100),
    perda_dia_custo: r2(soma(rup, perda)), sem_oc: rup.filter(x => x.oc <= 0).length, curvas,
    top_fornecedores: Object.entries(porForn).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, p]) => ({ nome: curto(n), perda: r2(p) })),
    top_skus: rup.sort((a, b) => perda(b) - perda(a)).slice(0, 5).map(x => ({ sku: x.sku, titulo: x.titulo.slice(0, 48), curva: x.curva, perda: Math.round(perda(x)), oc: x.oc })),
  };
}
// soma das filiais (contagens de SKU somadas por filial; cobertura recalculada pelo valor total)
function totalEstoque_(fs) {
  const s = k => fs.reduce((a, f) => a + (f[k] || 0), 0), r2 = x => Math.round(x * 100) / 100;
  const curvas = {}; ['AA', 'A', 'B', 'C', 'D'].forEach(k => curvas[k] = { ativos: fs.reduce((a, f) => a + f.curvas[k].ativos, 0), ruptura: fs.reduce((a, f) => a + f.curvas[k].ruptura, 0), perda: r2(fs.reduce((a, f) => a + f.curvas[k].perda, 0)) });
  const t = { nome: 'Domus', base: fs.map(f => f.nome).join(' + '), skus: s('skus'), skus_com_estoque: s('skus_com_estoque'), unidades: s('unidades'), valor_custo: r2(s('valor_custo')), venda_dia_custo: r2(s('venda_dia_custo')),
    saudavel_valor: r2(s('saudavel_valor')), excesso_valor: r2(s('excesso_valor')), excesso_skus: s('excesso_skus'), parado_valor: r2(s('parado_valor')), parado_skus: s('parado_skus'),
    skus_ativos: s('skus_ativos'), skus_ruptura: s('skus_ruptura'), perda_dia_custo: r2(s('perda_dia_custo')), sem_oc: s('sem_oc'), curvas };
  t.pct_ruptura = r2(t.skus_ruptura / Math.max(1, t.skus_ativos) * 100);
  t.cobertura_dias = t.venda_dia_custo ? Math.round(t.valor_custo / t.venda_dia_custo * 10) / 10 : null;
  return t;
}

function calcularEstoque_() {
  const filiais = {};
  Object.entries(CFG.PACS).forEach(([k, p]) => {
    if (!p.id) { filiais[k] = null; return; }
    const v = abrirPac_(p).getDataRange().getValues();
    const e = calcEstoque_(v, p.nome, p.base, `PAC ${p.base} · aba ${p.aba}`);
    e.top_fornecedores.forEach(f => f.nome = f.nome.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()));
    filiais[k] = e;
  });
  const ok = Object.values(filiais).filter(Boolean);
  return {
    _info: "Coluna 3 · Estoque por filial (quantidade e qualidade). Gerado pelo Apps Script a partir das PACs. Não editar à mão. 'total' só aparece quando todas as filiais têm PAC.",
    atualizado_em: agoraISO_(), filiais,
    total: ok.length === Object.keys(CFG.PACS).length && ok.length > 1 ? (() => {
      const t = totalEstoque_(ok); t.base = ok.map(f => f.nome).join(' + ');
      const pf = {}; ok.forEach(f => f.top_fornecedores.forEach(x => pf[x.nome] = (pf[x.nome] || 0) + x.perda));
      t.top_fornecedores = Object.entries(pf).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([nome, perda]) => ({ nome, perda }));
      return t; })() : null,
  };
}

function atualizarEstoque() {
  const e = calcularEstoque_();
  const resumo = Object.values(e.filiais).filter(Boolean).map(f => `${f.nome} ${f.pct_ruptura}%`).join(', ');
  Logger.log(publicar_('colunas/mural/estoque.json', JSON.stringify(e, null, 1), `estoque: ruptura ${resumo} (${hoje_()})`));
}

// ===================================================================== 2. mural (formulário)

const TIPO_ = { 'Meta batida': 'meta', 'Ação tomada': 'acao', 'Alerta': 'alerta', 'Comemoração': 'comemoracao', 'Aviso': 'aviso' };

function publicarMural() {
  const props = PropertiesService.getScriptProperties();
  const sh = SpreadsheetApp.openById(props.getProperty('RESPOSTAS_ID')).getSheets()[0];
  const v = sh.getDataRange().getValues();
  if (v.length < 2) return;
  const H = v[0].map(String);
  // garante a coluna "Aprovado" no fim da planilha de respostas
  let ap = H.indexOf('Aprovado');
  if (ap < 0) { ap = H.length; sh.getRange(1, ap + 1).setValue('Aprovado'); }
  const c = n => H.findIndex(h => h.startsWith(n));
  const hoje = hoje_();
  const posts = [];
  v.slice(1).forEach((r, i) => {
    const aprov = String(r[ap] || '').trim().toLowerCase();
    if (CFG.APROVACAO_AUTOMATICA ? aprov === 'não' || aprov === 'nao' : aprov !== 'sim') return;
    const ate = r[c('Fica no ar até')] instanceof Date ? Utilities.formatDate(r[c('Fica no ar até')], CFG.FUSO, 'yyyy-MM-dd') : String(r[c('Fica no ar até')] || '');
    if (ate && ate < hoje) return;
    const id = Utilities.formatDate(new Date(r[0]), CFG.FUSO, 'yyyyMMdd-HHmmss') + '-' + (i + 2);
    let midia = '';
    const mi = c('Mídia');
    if (mi >= 0 && r[mi]) midia = subirMidia_(id, String(r[mi]).split(',')[0].trim());
    posts.push({
      id, tipo: TIPO_[r[c('Tipo')]] || 'aviso', autor: String(r[c('Seu nome')]).trim(),
      titulo: String(r[c('Título')]).trim(), texto: String(r[c('Texto')]).trim(),
      numero: String(r[c('Número')] || '').trim(), legenda: String(r[c('Legenda')] || '').trim(),
      midia, ate, publicado_em: Utilities.formatDate(new Date(r[0]), CFG.FUSO, "yyyy-MM-dd'T'HH:mm"),
    });
  });
  posts.sort((a, b) => b.publicado_em.localeCompare(a.publicado_em));
  const out = { _info: 'Coluna 3 · Publicações dos analistas. Gerado pelo Apps Script a partir do formulário. Não editar à mão.', atualizado_em: agoraISO_(), posts: posts.slice(0, 12) };
  // só o conteúdo (sem a hora) decide se há commit novo
  const atual = lerRepo_('colunas/mural/mural.json');
  if (atual && JSON.stringify(atual.posts) === JSON.stringify(out.posts)) return;
  publicar_('colunas/mural/mural.json', JSON.stringify(out, null, 1), `mural: ${posts.length} publicação(ões)`);
}

/** Copia o arquivo enviado no formulário (Drive) para colunas/mural/midia/ uma vez só. Retorna o caminho relativo. */
function subirMidia_(id, url) {
  const props = PropertiesService.getScriptProperties();
  const k = 'MIDIA_' + id;
  if (props.getProperty(k)) return props.getProperty(k);
  const m = url.match(/[-\w]{25,}/);
  if (!m) return '';
  const f = DriveApp.getFileById(m[0]);
  if (f.getSize() > CFG.MIDIA_MAX_MB * 1024 * 1024) return '';
  const ext = (f.getName().match(/\.(mp4|webm|mov|jpg|jpeg|png|gif|webp)$/i) || [, 'bin'])[1].toLowerCase();
  if (ext === 'bin') return '';
  const nome = `midia/${id}.${ext}`;
  publicar_('colunas/mural/' + nome, f.getBlob().getBytes(), `mural: mídia ${nome}`);
  props.setProperty(k, nome);
  return nome;
}

// ===================================================================== 3. e-mail das 07h30

// ===================================================================== 3. newsletter "Radar Domus" (e-mail das 07h30)
//
// Remetente: rode este script logado em radar@domuscommerce.com (o e-mail sai da conta que roda o script).
// Lista: aba "Assinantes" da planilha do telão. Ativo = sim/não. Conteúdo = completo (notícias + faturamento + estoque)
//        ou noticias (só notícias e mural). Quem entra pela importação da organização começa como "noticias".
// Cada e-mail traz o link "Gerenciar inscrição" (web app só para contas @domuscommerce.com).

const ASSIN_ = ['E-mail', 'Nome', 'Ativo (sim/não)', 'Conteúdo (completo/noticias)', 'Desde', 'Origem'];

function abaAssinantes_() {
  const id = PropertiesService.getScriptProperties().getProperty('RESPOSTAS_ID');
  if (!id) throw new Error('Planilha do telão ainda não criada: rode configurarTudo');
  const ss = SpreadsheetApp.openById(id);
  let sh = ss.getSheetByName('Assinantes');
  if (!sh) {
    sh = ss.insertSheet('Assinantes', 1);
    sh.getRange(1, 1, 1, ASSIN_.length).setValues([ASSIN_]).setFontWeight('bold').setBackground('#212121').setFontColor('#ECFC30');
    sh.setFrozenRows(1); sh.setColumnWidths(1, ASSIN_.length, 200);
    sh.getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['sim', 'não']).build());
    sh.getRange('D2:D').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['completo', 'noticias']).build());
    CFG.EMAILS.forEach(e => sh.appendRow([e, '', 'sim', 'completo', hoje_(), 'inicial']));
  }
  return sh;
}

function lerAssinantes_() {
  const v = abaAssinantes_().getDataRange().getValues().slice(1);
  const vistos = {};
  return v.map(r => ({ email: String(r[0]).trim().toLowerCase(), nome: String(r[1]).trim(), ativo: !/^n/i.test(String(r[2]).trim()), nivel: /^c/i.test(String(r[3]).trim()) ? 'completo' : 'noticias' }))
    .filter(a => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email) && !vistos[a.email] && (vistos[a.email] = true));
}

/** Inclui ou reativa um e-mail. nivel: 'completo' | 'noticias'. */
function definirAssinante_(email, ativo, nivel, origem) {
  email = String(email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('E-mail inválido: ' + email);
  const sh = abaAssinantes_(), v = sh.getDataRange().getValues();
  const i = v.findIndex((r, k) => k > 0 && String(r[0]).trim().toLowerCase() === email);
  if (i > 0) { sh.getRange(i + 1, 3).setValue(ativo ? 'sim' : 'não'); if (nivel) sh.getRange(i + 1, 4).setValue(nivel); return 'atualizado'; }
  if (!ativo) return 'não estava na lista';
  sh.appendRow([email, '', 'sim', nivel || 'noticias', hoje_(), origem || 'manual']); return 'incluído';
}

// ---------- menu: adicionar, remover, importar a organização ----------
function adicionarAssinante() {
  const ui = SpreadsheetApp.getUi(), r = ui.prompt('Adicionar ao Radar', 'E-mail (para vários, separe por vírgula). Entram com conteúdo "noticias"; troque para "completo" na aba Assinantes.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const res = r.getResponseText().split(/[,;\s]+/).filter(Boolean).map(e => `${e}: ${definirAssinante_(e, true, null, 'manual')}`);
  ui.alert(res.join('\n'));
}
function removerAssinante() {
  const ui = SpreadsheetApp.getUi(), r = ui.prompt('Remover do Radar', 'E-mail (para vários, separe por vírgula). A linha fica com Ativo = não (histórico preservado).', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  ui.alert(r.getResponseText().split(/[,;\s]+/).filter(Boolean).map(e => `${e}: ${definirAssinante_(e, false)}`).join('\n'));
}
/** Importa todas as contas do diretório @domuscommerce.com (precisa do serviço avançado People API, já no appsscript.json). */
function importarOrganizacao() {
  let token, n = 0, novos = 0;
  const ja = {}; lerAssinantes_().forEach(a => ja[a.email] = 1);
  do {
    const r = People.People.listDirectoryPeople({ readMask: 'emailAddresses,names', sources: ['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE'], pageSize: 500, pageToken: token });
    (r.people || []).forEach(p => {
      const e = ((p.emailAddresses || [])[0] || {}).value; if (!e) return; n++;
      const em = e.toLowerCase(); if (ja[em] || !em.endsWith('@' + CFG.DOMINIO)) return;
      abaAssinantes_().appendRow([em, ((p.names || [])[0] || {}).displayName || '', 'sim', 'noticias', hoje_(), 'organização']); novos++; ja[em] = 1;
    });
    token = r.nextPageToken;
  } while (token);
  const msg = `${n} contas no diretório · ${novos} incluídas agora (conteúdo "noticias").`;
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

// ---------- página "Gerenciar inscrição" (web app: Implantar > Nova implantação > App da Web) ----------
function doGet(e) {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  const acao = (e && e.parameter && e.parameter.acao) || '';
  let msg = '';
  if (!email.endsWith('@' + CFG.DOMINIO)) msg = 'Entre com a sua conta @' + CFG.DOMINIO + ' para gerenciar a inscrição.';
  else if (acao === 'sair') msg = 'Pronto, você saiu do Radar Domus (' + definirAssinante_(email, false) + ').';
  else if (acao === 'entrar') msg = 'Pronto, você está no Radar Domus (' + definirAssinante_(email, true, null, 'autoinscrição') + ').';
  const a = email ? lerAssinantes_().find(x => x.email === email) : null;
  const status = a && a.ativo ? 'inscrito' : 'fora da lista';
  const url = ScriptApp.getService().getUrl();
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:40px auto;color:#212121">
    <div style="background:#212121;color:#ECFC30;padding:16px 20px;border-radius:10px;font-size:20px;font-weight:bold">Radar Domus</div>
    <p>${msg ? `<b>${msg}</b><br><br>` : ''}Conta: <b>${email || '-'}</b> · situação: <b>${status}</b></p>
    <p><a href="${url}?acao=entrar" target="_top" style="background:#ECFC30;color:#212121;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Quero receber</a>
       &nbsp; <a href="${url}?acao=sair" target="_top" style="background:#eee;color:#212121;padding:10px 16px;border-radius:8px;text-decoration:none">Não quero mais receber</a></p></div>`;
  return HtmlService.createHtmlOutput(html).setTitle('Radar Domus · inscrição');
}

// ---------- montagem e envio ----------
function dadosDoDia_() {
  const meta = lerRepo_('colunas/meta/dados.json');
  const news = lerRepo_('colunas/noticias/dados.json');
  const mural = lerRepo_('colunas/mural/mural.json');
  let est; try { est = calcularEstoque_(); } catch (e) { est = lerRepo_('colunas/mural/estoque.json'); }
  if (meta) { const mt = lerMetas_()[meta.mes]; if (mt) { meta.meta_mes = mt.meta; meta.meta_exemplo = mt.exemplo; } }
  return { meta, news, mural, est };
}

const brl_ = v => v >= 1e6 ? 'R$ ' + (v / 1e6).toFixed(2).replace('.', ',') + ' mi' : 'R$ ' + (v / 1e3).toFixed(1).replace('.', ',') + ' mil';
const pc_ = v => v == null ? '–' : v.toFixed(1).replace('.', ',') + '%';
const escH_ = x => String(x == null ? '' : x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const urlOk_ = u => /^https:\/\/[^\s"<>]+$/.test(String(u || ''));

function montarEmail_(D, nivel, gerenciarUrl) {
  const { meta, news, mural, est } = D, brl = brl_, pc = pc_;
  const ddmm = s => s.slice(8, 10) + '/' + s.slice(5, 7);
  const th = 'style="text-align:right;padding:4px 10px;border-bottom:1px solid #ddd"', tl = 'style="text-align:left;padding:4px 10px;border-bottom:1px solid #ddd"';
  const tabela = (cab, linhas) => `<table style="border-collapse:collapse;margin-top:8px;font-size:14px"><tr>${cab.map((c, i) => `<th ${i ? th : tl}>${c}</th>`).join('')}</tr>${linhas.map(l => `<tr>${l.map((c, i) => `<td ${i ? th : tl}>${c}</td>`).join('')}</tr>`).join('')}</table>`;
  const h3 = t => `<h3 style="margin:26px 0 8px;border-left:6px solid #ECFC30;padding-left:10px">${t}</h3>`;
  const L = [];
  L.push(`<div style="font-family:Arial,sans-serif;max-width:680px;color:#212121">`);
  L.push(`<div style="background:#212121;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0"><b style="color:#ECFC30;font-size:22px">Radar Domus</b><br>${Utilities.formatDate(new Date(), CFG.FUSO, "dd/MM/yyyy")} · marketplaces, faturamento e estoque</div>`);

  // 1. matérias do dia, com link
  if (news && (news.itens || []).length) {
    L.push(h3('Notícias do dia'));
    news.itens.forEach(n => {
      const link = urlOk_(n.url) ? `<a href="${n.url}" style="color:#1a56db">Ler a matéria</a>` : '';
      L.push(`<p style="margin:0 0 14px"><b>${escH_(n.manchete)}</b><br>${escH_(n.detalhe || '')}<br><span style="color:#777">${escH_(n.fonte)}${n.data_fonte ? ' · ' + escH_(n.data_fonte) : ''}</span>${link ? ' · ' + link : ''}</p>`);
    });
    const extras = (news.mais_links || []).filter(x => urlOk_(x.url));
    if (extras.length) L.push(`<p style="margin:6px 0 0;color:#555"><b>Mais leituras</b></p><ul style="margin:4px 0 0;padding-left:18px">${extras.map(x => `<li><a href="${x.url}" style="color:#1a56db">${escH_(x.titulo)}</a> <span style="color:#777">· ${escH_(x.fonte || '')}</span></li>`).join('')}</ul>`);
  }

  // 2. mural dos analistas
  const posts = ((mural && mural.posts) || []).filter(p => !p.exemplo && (!p.ate || p.ate >= hoje_()));
  if (posts.length) {
    L.push(h3('Mural do time'));
    posts.forEach(p => L.push(`<p style="margin:0 0 10px"><b>${escH_(p.titulo)}</b>${p.numero ? ` · <b>${escH_(p.numero)}</b>` : ''}<br>${escH_(p.texto)}<br><span style="color:#777">${escH_(p.autor)}</span></p>`));
  }

  if (nivel === 'completo') {
    // 3. faturamento e margem
    if (meta) {
      const p = meta.realizado_mes / meta.meta_mes * 100, F = meta.filiais || {};
      const pj = projecao_(meta.realizado_mes, meta.meta_mes, meta.referencia);
      L.push(h3('Faturamento · Domus (Itajaí + Londrina)'));
      L.push(`<p style="margin:0">No mês: <b>${brl(meta.realizado_mes)}</b>${meta.margem_pct_mes != null ? ' · margem ' + pc(meta.margem_pct_mes) : ''} · ${pc(p)} da meta de ${brl(meta.meta_mes)}${meta.meta_exemplo ? ' (meta de exemplo)' : ''}<br>Ontem (${ddmm(meta.ontem.data)}): <b>${brl(meta.ontem.receita)}</b> · ${meta.ontem.pedidos.toLocaleString('pt-BR')} pedidos<br>Projeção no ritmo atual (${brl(pj.ritmo)}/dia): <b>${brl(pj.proj)}</b> · ${pc(pj.pct_proj)} da meta${pj.restantes ? `<br>Para bater a meta: <b>${brl(pj.necessario)}/dia</b> nos ${pj.restantes} dias restantes` : ''}</p>`);
      const ks = Object.keys(F);
      const cel = v => v && v.receita ? `${brl(v.receita)} <span style="color:#777">· ${pc(v.margem_pct)}</span>` : '–';
      if (meta.canais_mes) L.push(`<p style="margin:12px 0 0;color:#555">Canais no mês: receita · margem</p>` + tabela(['Canal', ...ks.map(k => F[k].nome), 'Domus'],
        [...meta.canais_mes.map(c => [c.canal, ...ks.map(k => cel(c[k])), `<b>${cel(c.total)}</b>`]),
         ['<b>Total</b>', ...ks.map(k => `<b>${cel({ receita: F[k].realizado_mes, margem_pct: F[k].margem_pct_mes })}</b>`), `<b>${cel({ receita: meta.realizado_mes, margem_pct: meta.margem_pct_mes })}</b>`]]));
    }
    // 4. estoque
    if (est) {
      const bl = Object.values(est.filiais).filter(Boolean); if (est.total) bl.push(est.total);
      L.push(h3('Estoque'));
      L.push(tabela(['', ...bl.map(f => f.nome)], [
        ['Valor a custo', ...bl.map(f => brl(f.valor_custo))],
        ['Unidades', ...bl.map(f => f.unidades.toLocaleString('pt-BR'))],
        ['Cobertura', ...bl.map(f => Math.round(f.cobertura_dias) + ' dias')],
        ['Em excesso', ...bl.map(f => `${brl(f.excesso_valor)} (${pc(f.excesso_valor / f.valor_custo * 100)})`)],
        ['Parado (sem venda)', ...bl.map(f => `${brl(f.parado_valor)} (${f.parado_skus} SKUs)`)],
        ['<b style="color:#D93838">Ruptura</b>', ...bl.map(f => `<b style="color:#D93838">${pc(f.pct_ruptura)}</b> (${f.skus_ruptura} SKUs)`)],
        ['Venda perdida/dia', ...bl.map(f => brl(f.perda_dia_custo))],
        ['Curvas AA e A sem estoque', ...bl.map(f => `${f.curvas.AA.ruptura + f.curvas.A.ruptura} SKUs (${brl(f.curvas.AA.perda + f.curvas.A.perda)}/dia)`)],
      ]));
      Object.values(est.filiais).filter(Boolean).forEach(f => L.push(`<p style="margin:12px 0 0"><b>Maiores perdas · ${f.nome}</b></p><ul style="margin:4px 0 0;padding-left:18px">${f.top_skus.slice(0, 5).map(s => `<li>${escH_(s.titulo)} · curva ${s.curva} · ${brl(s.perda)}/dia${s.oc ? ' · OC ' + s.oc : ' · sem OC'}</li>`).join('')}</ul>`));
    }
  }

  L.push(`<p style="color:#888;font-size:12px;margin-top:28px;border-top:1px solid #eee;padding-top:10px">Radar Domus · enviado por ${CFG.REMETENTE}. ${nivel === 'completo' ? 'Contém dados internos de faturamento e estoque: não encaminhe para fora da Domus. ' : ''}Faturamento é D+1 (Preço Certo); estoque vem das PACs, a custo.${gerenciarUrl ? `<br><a href="${gerenciarUrl}" style="color:#888">Gerenciar inscrição ou parar de receber</a>` : ''}</p></div>`);
  return L.join('\n');
}

/** Envia o Radar para cada assinante ativo (um e-mail por pessoa, com o conteúdo do nível dela). */
function enviarEmailDiario() {
  const D = dadosDoDia_();
  if (!D.news && !D.meta && !D.est) throw new Error('Sem dados para enviar (GitHub e PACs indisponíveis).');
  const quem = Session.getEffectiveUser().getEmail();
  if (quem.toLowerCase() !== CFG.REMETENTE) Logger.log(`Aviso: o script roda como ${quem}; o Radar sai desse endereço. Para sair de ${CFG.REMETENTE}, instale o script logado nessa conta.`);
  let gerenciar = ''; try { gerenciar = ScriptApp.getService().getUrl() || ''; } catch (e) { }
  const html = { completo: montarEmail_(D, 'completo', gerenciar), noticias: montarEmail_(D, 'noticias', gerenciar) };
  const assunto = `Radar Domus · ${Utilities.formatDate(new Date(), CFG.FUSO, 'dd/MM')}` + (D.news && D.news.itens && D.news.itens[0] ? ` · ${D.news.itens[0].manchete}` : '');
  const lista = lerAssinantes_().filter(a => a.ativo);
  if (lista.length > MailApp.getRemainingDailyQuota()) throw new Error(`Lista (${lista.length}) maior que a cota de e-mail de hoje (${MailApp.getRemainingDailyQuota()}).`);
  let ok = 0; const falhas = [];
  lista.forEach(a => { try { MailApp.sendEmail({ to: a.email, subject: assunto, htmlBody: html[a.nivel], name: CFG.REMETENTE_NOME, replyTo: CFG.REMETENTE }); ok++; } catch (e) { falhas.push(`${a.email}: ${e.message}`); } });
  Logger.log(`Radar enviado para ${ok} de ${lista.length}.` + (falhas.length ? ' Falhas: ' + falhas.join(' | ') : ''));
}

/** Envia só para quem está rodando o script (para conferir antes de soltar para todos). */
function enviarTeste() {
  const D = dadosDoDia_(), eu = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({ to: eu, subject: '[teste] Radar Domus', htmlBody: montarEmail_(D, 'completo', '') + '<hr>' + montarEmail_(D, 'noticias', ''), name: CFG.REMETENTE_NOME });
  try { SpreadsheetApp.getActive().toast('Teste enviado para ' + eu + ' (versão completa e versão só notícias).', 'Radar', 8); } catch (e) { Logger.log('Teste enviado para ' + eu); }
}
