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
  GITHUB_OWNER: 'domuswms',                // organização no GitHub (github.com/domuswms/Tel-o)
  GITHUB_REPO: 'Tel-o',              // nome do repositório no GitHub (github.com/<organização>/Tel-o)
  GITHUB_BRANCH: 'main',
  // uma PAC por filial. Filial sem 'id' fica de fora até ser preenchida (e o total só aparece com todas)
  PACS: {
    // a aba de cada PAC tem o estoque inteiro da filial (as abas com nome de analista são só divisão de leitura)
    // parcial: true quando a aba lida tem filtro restringindo linhas (linha 2: Fornecedor / Tag) → selo "base parcial"
    itajai:   { nome: 'Itajaí',   id: '17xjD_hJq1V_vpydBPeY25NQWbL9F9GwlQqM2HhIymPE', aba: 'Gustavo', base: 'SC', parcial: false, nota: 'PAC SC, sem PI Verticalizado' },
    londrina: { nome: 'Londrina', id: '1f-JzRrFNtKh_EUzeLcgvszLkibvvYP4KDcupJzL4tnw', aba: 'COMPRAS', base: 'PR', parcial: true, nota: 'PAC PR, só Verticalizados' },
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
  if (props.getProperty('FORM_ID')) { try { const shM = SpreadsheetApp.openById(props.getProperty('RESPOSTAS_ID')).getSheetByName('Metas'); const cab = shM ? shM.getRange(1, 1, 1, 8).getValues()[0].join('|') : ''; if (shM && (!/meta\s*2/i.test(cab) || /exemplo/i.test(cab))) atualizarAbaMetas(); } catch (e) { Logger.log('Aba Metas: ' + e.message); }
    instalarGatilhos_(SpreadsheetApp.openById(props.getProperty('RESPOSTAS_ID'))); return Logger.log('Já configurado. Gatilhos reinstalados. Planilha: ' + SpreadsheetApp.openById(props.getProperty('RESPOSTAS_ID')).getUrl()); }

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
  abaMensagens_();
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

// Meta escalonada: três degraus por mês, Meta 1 < Meta 2 < Meta 3 (no JSON continuam meta / super / mega, que o telão já lê).
const NIVEIS_ = [['meta', 'Meta 1'], ['super', 'Meta 2'], ['mega', 'Meta 3']];
const CAB_METAS_ = ['Mês (AAAA-MM)', 'Meta 1 (R$)', 'Meta 2 (R$)', 'Meta 3 (R$)', 'Observação'];

function criarAbaMetas_(ss, linhas) {
  const sh = ss.getSheetByName('Metas') || ss.insertSheet('Metas', 0);
  sh.clear();
  sh.getRange(1, 1, 1, CAB_METAS_.length).setValues([CAB_METAS_]).setFontWeight('bold').setBackground('#212121').setFontColor('#ECFC30');
  const L = linhas && linhas.length ? linhas : [[Utilities.formatDate(new Date(), CFG.FUSO, 'yyyy-MM'), '', '', '', 'Itajaí + Londrina somadas']];
  sh.getRange(2, 1, L.length, CAB_METAS_.length).setValues(L);
  sh.getRange('A:A').setNumberFormat('@'); sh.getRange('B:D').setNumberFormat('"R$" #,##0');
  sh.setColumnWidths(1, CAB_METAS_.length, 170); sh.setFrozenRows(1);
  sh.getRange('H1').setValue('Uma linha por mês, meta da Domus (Itajaí + Londrina). Meta 1 < Meta 2 < Meta 3. O telão e o e-mail atualizam em cerca de 1 minuto.');
}

/** Converte a aba Metas antiga (uma meta só, ou Meta/Super/Mega) para Meta 1, Meta 2 e Meta 3, mantendo os valores. */
function atualizarAbaMetas() {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('RESPOSTAS_ID'));
  const atual = lerMetas_();
  const linhas = Object.entries(atual).map(([m, v]) => [m, v.meta, v.super || '', v.mega || '', '']);
  criarAbaMetas_(ss, linhas);
  publicarMetas();
  try { SpreadsheetApp.getActive().toast('Aba Metas com Meta 1, Meta 2 e Meta 3. Preencha os valores.', 'Telão', 8); } catch (e) { }
}

/** Lê a aba Metas: { 'AAAA-MM': { meta, super, mega } }. Aceita o formato antigo (só Meta). */
function lerMetas_() {
  const id = PropertiesService.getScriptProperties().getProperty('RESPOSTAS_ID'); if (!id) return {};
  const sh = SpreadsheetApp.openById(id).getSheetByName('Metas'); if (!sh) return {};
  const v = sh.getDataRange().getValues(); if (!v.length) return {};
  const H = v[0].map(h => String(h).toLowerCase());
  const col = (...k) => H.findIndex(h => k.some(x => h.includes(x)));
  const C = { mes: col('mês', 'mes'), meta: H.findIndex(h => /^meta\b/.test(h) && !/meta\s*[23]/.test(h)), super: H.findIndex(h => /meta\s*2|super/.test(h)), mega: H.findIndex(h => /meta\s*3|mega/.test(h)), ex: col('exemplo') };
  const num = x => typeof x === 'number' ? x : parseFloat(String(x).replace(/R\$|\s|\./g, '').replace(',', '.'));
  const out = {};
  v.slice(1).forEach(r => {
    const mes = r[C.mes] instanceof Date ? Utilities.formatDate(r[C.mes], CFG.FUSO, 'yyyy-MM') : String(r[C.mes]).trim();
    const meta = num(r[C.meta]);
    if (!/^\d{4}-\d{2}$/.test(mes) || !(meta > 0)) return;
    const o = { meta };
    if (C.super >= 0 && num(r[C.super]) > meta) o.super = num(r[C.super]);
    if (C.mega >= 0 && num(r[C.mega]) > (o.super || meta)) o.mega = num(r[C.mega]);
    out[mes] = o;
  });
  return out;
}

/** Lista os degraus do mês em ordem: [{ chave, nome, valor }]. */
const niveis_ = m => NIVEIS_.filter(([k]) => m && m[k] > 0).map(([k, nome]) => ({ chave: k, nome, valor: m[k] }));

function publicarMetas(e) {
  if (e && e.range && e.range.getSheet().getName() === 'Mensagens') return publicarTelaCheia_();
  if (e && e.range && e.range.getSheet().getName() !== 'Metas') return;
  const m = lerMetas_();
  const out = Object.assign({ _info: 'Metas de faturamento por mês (R$), da Domus (Itajaí + Londrina): meta = Meta 1, super = Meta 2, mega = Meta 3. Gerado pela aba Metas da planilha do telão. Não editar à mão.' }, m);
  Logger.log(publicar_('colunas/meta/metas.json', JSON.stringify(out, null, 1), 'metas: ' + Object.entries(m).map(([k, v]) => `${k} ${v.meta}/${v.super || '-'}/${v.mega || '-'}`).join(', ')));
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
  Object.values(CFG.PACS).forEach(p => t(`PAC ${p.nome}`, () => { const { linhas } = goldLinhas_(abrirPac_(p).getDataRange().getValues(), p.nome); const e = goldCalc_(linhas, {}); return `${e.skus} SKUs na base Gold · estoque ${curto_(e.estoque)} · ruptura ${d1_(e.ruptura_pct)}% · DIO ${d1_(e.dio)} dias`; }));
  t('Planilha do telão (metas e mural)', () => { const id = PropertiesService.getScriptProperties().getProperty('RESPOSTAS_ID'); if (!id) throw new Error('ainda não criada: rode configurarTudo'); return SpreadsheetApp.openById(id).getUrl(); });
  t('Metas', () => JSON.stringify(lerMetas_()));
  t('Gatilhos automáticos', () => { const g = ScriptApp.getProjectTriggers().map(x => x.getHandlerFunction()); if (!g.length) throw new Error('nenhum: rode configurarTudo'); return g.join(', '); });
  t('GitHub', () => { if (!githubOk_()) throw new Error('falta GITHUB_OWNER no código e/ou GITHUB_TOKEN nas propriedades (o e-mail funciona sem isso)'); const r = UrlFetchApp.fetch(`https://api.github.com/repos/${CFG.GITHUB_OWNER}/${CFG.GITHUB_REPO}/branches/${CFG.GITHUB_BRANCH}`, { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN'), Accept: 'application/vnd.github+json' } }); if (r.getResponseCode() !== 200) throw new Error(explicarGithub_()); return `acesso ok a ${CFG.GITHUB_OWNER}/${CFG.GITHUB_REPO} (${CFG.GITHUB_BRANCH})`; });
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
    .addItem('Publicar mensagens de tela cheia agora', 'publicarMensagens')
    .addItem('Metas: passar para Meta / Super / Mega', 'atualizarAbaMetas')
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
  if (r.code >= 300) throw new Error(`GitHub ${r.code} ao gravar ${path}. ${explicarGithub_()}`);
  return 'ok';
}

/** Descobre por que o GitHub recusou: repositório, permissão do token ou branch. */
function explicarGithub_() {
  const tk = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  const get = u => { const r = UrlFetchApp.fetch('https://api.github.com' + u, { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + tk, Accept: 'application/vnd.github+json' } }); let j = null; try { j = JSON.parse(r.getContentText()); } catch (e) { } return { code: r.getResponseCode(), json: j }; };
  const nome = `${CFG.GITHUB_OWNER}/${CFG.GITHUB_REPO}`;
  const rep = get(`/repos/${nome}`);
  if (rep.code === 401) return 'Token inválido ou vencido: gere outro e troque a propriedade GITHUB_TOKEN.';
  if (rep.code === 404) return `O token não enxerga o repositório ${nome}. Confira: (1) GITHUB_OWNER é o nome exato da organização no endereço github.com/<nome>; (2) o repositório se chama ${CFG.GITHUB_REPO}; (3) no token, Resource owner = a organização e o repositório está em "Only select repositories"; (4) se a organização exige aprovação, um owner aprovou o token (Org → Settings → Personal access tokens → Pending).`;
  if (rep.code !== 200) return `Resposta ${rep.code} ao consultar ${nome}.`;
  const p = rep.json.permissions || {};
  if (rep.json.size === 0) return `O repositório ${nome} está vazio: suba os arquivos do zip (Add file → Upload files) e faça o primeiro commit.`;
  const br = get(`/repos/${nome}/branches/${CFG.GITHUB_BRANCH}`);
  if (br.code === 404) return `A branch "${CFG.GITHUB_BRANCH}" não existe. A branch padrão é "${rep.json.default_branch}": troque GITHUB_BRANCH no CFG.`;
  if (p.push === false) return 'O token lê, mas não grava: na permissão do token, Contents precisa ser "Read and write".';
  return 'Repositório e branch existem; confira a permissão Contents = Read and write no token.';
}

function lerRepo_(path) {
  const r = gh_(path, 'get');
  if (r.code !== 200) return null;
  return JSON.parse(Utilities.newBlob(Utilities.base64Decode(r.json.content.replace(/\n/g, ''))).getDataAsString('UTF-8'));
}

const agoraISO_ = () => Utilities.formatDate(new Date(), CFG.FUSO, "yyyy-MM-dd'T'HH:mm:ssXXX");
const hoje_ = () => Utilities.formatDate(new Date(), CFG.FUSO, 'yyyy-MM-dd');

// ===================================================================== 1. estoque por filial (PACs) · Análise Gold

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

  // ---------- Gold+ · indicadores extras de estoque (não substituem os 6 indicadores) ----------
  const soma = (arr, f) => arr.reduce((t, x) => t + f(x), 0);
  const cob = x => x.m > 0 && x.q > 0 ? x.q / x.m : null;
  const ativos = L.filter(temC);
  // estoque por faixa de cobertura (dias de venda que o estoque aguenta), a custo
  const cobertura_faixas = [['até 15 d', 0, 15], ['15 a 30 d', 15, 30], ['30 a 60 d', 30, 60], ['60 a 90 d', 60, 90], ['90 a 180 d', 90, 180], ['mais de 180 d', 180, Infinity]]
    .map(([faixa, a, b]) => { const s = ativos.filter(x => cob(x) !== null && cob(x) >= a && cob(x) < b); return { faixa, valor: soma(s, x => x.q * x.c), skus: s.length }; });
  cobertura_faixas.push({ faixa: 'sem venda', valor: semGiro, skus: cong.length });
  // estoque lento: vende, mas a cobertura passa de 120 dias
  const lentoArr = ativos.filter(x => cob(x) !== null && cob(x) > 120);
  const lentos = lentoArr.slice().sort((a, b) => b.q * b.c - a.q * a.c).slice(0, 5).map(x => Object.assign(item(x), { valor: x.q * x.c, cobertura: cob(x) }));
  // vai romper: tem estoque, vende, cobertura menor que o lead time (7 dias se não houver LT) e nenhuma OC em trânsito
  const romperArr = ativos.filter(x => x.q > 0 && x.m > 0 && !(x.oc > 0) && x.q / x.m < (x.lt > 0 ? x.lt : 7));
  const vai_romper = romperArr.slice().sort((a, b) => ordemCurva(a.curva) - ordemCurva(b.curva) || b.m * b.c - a.m * a.c).slice(0, 8)
    .map(x => Object.assign(item(x), { giro: x.m * x.c, cobertura: cob(x) }));
  // OCs: valor em trânsito e a parte que já vai passar do Emax quando chegar
  const ocExc = ativos.filter(x => x.oc > 0 && x.emax !== null && x.q !== null && Math.max(x.q, 0) + x.oc > x.emax);
  // nível de serviço: dos SKUs que vendem, quantos têm estoque
  const vendem = ativos.filter(x => x.m > 0);
  // por curva: estoque, congelado e DIO
  Object.values(curvas).forEach(c => { c.estoque = 0; c.congelado = 0; });
  ativos.forEach(x => { const c = curvas[x.curva]; if (!c || !(x.q > 0)) return; c.estoque += x.q * x.c; if (x.m === 0) c.congelado += x.q * x.c; });
  Object.values(curvas).forEach(c => { c.dio = c.giro > 0 ? c.estoque / c.giro : null; });
  // concentração: quanto do estoque está nos 20% de SKUs de maior valor
  const valores = ativos.filter(x => x.q > 0).map(x => x.q * x.c).sort((a, b) => b - a);
  const top20 = soma(valores.slice(0, Math.max(1, Math.ceil(valores.length * .2))), v => v);
  // lista completa (até 40) dos mais vendidos sem estoque: curvas AA e A, com nome
  const ruptura_aa_a = rup.filter(x => x.curva === 'AA' || x.curva === 'A')
    .sort((a, b) => ordemCurva(a.curva) - ordemCurva(b.curva) || (a.curva === 'AA' ? 0 : 1) - (b.curva === 'AA' ? 0 : 1) || b.m * b.c - a.m * a.c).slice(0, 40)
    .map(x => Object.assign(item(x), { perdido: x.m * x.c }));
  const extras = {
    pct_congelado: E > 0 ? semGiro / E * 100 : null, pct_excesso: E > 0 ? exc / E * 100 : null,
    cobertura_faixas, lento_valor: soma(lentoArr, x => x.q * x.c), lento_skus: lentoArr.length, lentos,
    vai_romper, vai_romper_skus: romperArr.length, vai_romper_giro: soma(romperArr, x => x.m * x.c),
    oc_valor: soma(ativos, x => (x.oc || 0) * x.c), oc_acima_emax: soma(ocExc, x => Math.min(x.oc, Math.max(x.q, 0) + x.oc - x.emax) * x.c), oc_acima_emax_skus: ocExc.length,
    nivel_servico: vendem.length ? vendem.filter(x => x.q > 0).length / vendem.length * 100 : null,
    concentracao_top20: valores.length ? top20 / soma(valores, v => v) * 100 : null,
    ruptura_aa_a, skus_ruptura_aa_a: rup.filter(x => x.curva === 'AA' || x.curva === 'A').length,
  };

  const porForn = (arr, f) => { const o = {}; arr.forEach(x => o[x.forn] = (o[x.forn] || 0) + f(x)); return Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([nome, v]) => ({ nome, valor: v })); };
  return Object.assign({}, meta, extras, {
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

const curto_ = v => { const a = Math.abs(v), sg = v < 0 ? '-' : ''; return a >= 1e6 ? `${sg}R$ ${(a / 1e6).toFixed(1).replace('.', ',')} mi` : a >= 1e4 ? `${sg}R$ ${Math.round(a / 1e3)} mil` : `${sg}R$ ${Math.round(a).toLocaleString('pt-BR')}`; };
const d1_ = v => v === null || v === undefined ? '–' : v.toFixed(1).replace('.', ',');
const titulo_ = n => String(n).toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
const fornCurto_ = n => titulo_(String(n).replace(/\s+(INDUSTRIA|INDÚSTRIA|INDUSTRIAL|IMPORTADORA|DISTRIBUIDORA|ELETRODOMESTICOS|COMERCIO|COMÉRCIO|FABR\.?|LTDA|S\.?\s?A\.?|E|DA|DE|DO|-)\b.*$/i, ''));

/** Lê as PACs e calcula a Análise Gold por filial e para a Domus (linhas somadas). */
function calcularEstoque_() {
  const filiais = {}, todas = [], parcial = [];
  Object.entries(CFG.PACS).forEach(([k, p]) => {
    if (!p.id) { filiais[k] = null; return; }
    const { linhas, duplicatas } = goldLinhas_(abrirPac_(p).getDataRange().getValues(), p.nome);
    todas.push(...linhas); if (p.parcial) parcial.push(p.nome);
    filiais[k] = arrumar_(goldCalc_(linhas, { nome: p.nome, base: p.base, nota: p.nota, parcial: !!p.parcial, fonte: `PAC ${p.base}`, duplicatas }));
  });
  const ok = Object.values(filiais).filter(Boolean);
  const total = ok.length === Object.keys(CFG.PACS).length && ok.length > 1
    ? arrumar_(goldCalc_(todas, { nome: 'Domus', base: ok.map(f => f.nome).join(' + '), nota: ok.map(f => f.nome).join(' + ') + ', linhas somadas', parcial: parcial.length > 0 })) : null;
  return {
    _info: "Estoque por filial e Domus · Análise Gold da PAC (6 indicadores + listas). Gerado pelo Apps Script. Não editar à mão.",
    atualizado_em: agoraISO_(), corte: Utilities.formatDate(new Date(), CFG.FUSO, 'dd/MM'), sigma: 'não identificável nas PACs (não excluído)',
    filiais, total,
  };
}
/** Nomes curtos e campos que a coluna 3 e o e-mail já usam. */
function arrumar_(e) {
  const curtoItem = x => Object.assign(x, { forn: fornCurto_(x.forn) });
  ['top_ruptura', 'congelados', 'campeoes', 'azaroes', 'lentos', 'vai_romper', 'ruptura_aa_a'].forEach(k => (e[k] || []).forEach(curtoItem));
  e.top_fornecedores = e.forn_ruptura.map(x => ({ nome: fornCurto_(x.nome), perda: x.valor }));
  e.forn_excesso = e.forn_excesso.map(x => ({ nome: fornCurto_(x.nome), valor: x.valor }));
  e.top_skus = e.top_ruptura.map(x => ({ sku: x.sku, filial: x.filial, titulo: x.titulo.slice(0, 48), curva: x.curva, perda: Math.round(x.perdido), oc: x.oc }));
  return e;
}

// ---------- mensagens de tela cheia: insights automáticos (guia, seção 10) + aba Mensagens ----------
function insights_(est, meta) {
  const M = [], F = est.filiais || {}, T = est.total || Object.values(F).find(Boolean);
  const pctCurva = (e, k) => { const c = e && e.curvas[k]; return c && (c.giro + c.giro_perdido) > 0 ? c.giro_perdido / (c.giro + c.giro_perdido) * 100 : null; };
  const add = (tipo, titulo, numero, legenda, apoio) => M.push({ tipo, titulo, numero, legenda, apoio, origem: 'automático' });
  // vamos bem
  const aaI = pctCurva(F.itajai, 'AA'); if (aaI !== null && aaI < 5) add('bem', 'Curva AA de Itajaí quase sem ruptura', d1_(aaI) + '%', 'da demanda AA sem estoque', `DIO da Domus em ${d1_(T.dio)} dias`);
  if (T && T.ccc !== null && T.ccc < 0) add('bem', 'O prazo dos fornecedores cobre o nosso giro', d1_(T.ccc) + ' dias', 'de ciclo de caixa (CCC)', `DIO ${d1_(T.dio)} dias contra DPO ${Math.round(T.dpo)} dias`);
  if (meta && meta.canais_mes) {
    const cs = meta.canais_mes.filter(c => c.canal !== 'Outros' && c.total.pedidos >= 100);
    const lm = cs.slice().sort((a, b) => (b.total.margem_pct || 0) - (a.total.margem_pct || 0))[0];
    if (lm) add('bem', `${lm.canal} lidera a margem do mês`, d1_(lm.total.margem_pct) + '%', 'de margem de contribuição', `${lm.total.pedidos.toLocaleString('pt-BR')} pedidos no mês`);
    const lf = cs.slice().sort((a, b) => b.total.receita - a.total.receita)[0];
    if (lf) add('bem', `${lf.canal} puxa o faturamento`, d1_(lf.total.receita / meta.realizado_mes * 100) + '%', 'do faturamento da Domus no mês', curto_(lf.total.receita) + ' no mês');
    const ml = meta.canais_mes.find(c => c.canal === 'Mercado Livre');
    if (ml && ml.total.margem_pct !== null && meta.margem_pct_mes !== null && ml.total.margem_pct < meta.margem_pct_mes) add('melhoria', 'Margem no Mercado Livre abaixo da média', d1_(ml.total.margem_pct) + '%', `contra ${d1_(meta.margem_pct_mes)}% da Domus`, curto_(ml.total.receita) + ' vendidos no mês');
  }
  // ponto de melhoria
  const L = F.londrina; if (L && L.estoque > 0 && L.sem_giro / L.estoque > .2) add('melhoria', 'Estoque parado em Londrina', curto_(L.sem_giro), `${Math.round(L.sem_giro / L.estoque * 100)}% do estoque sem venda`, L.congelados[0] ? `Maior item: ${L.congelados[0].titulo.slice(0, 40)}` : '');
  if (T) add('melhoria', 'Excesso acima do estoque máximo', curto_(T.excesso), 'a custo, acima do Emax', T.forn_excesso[0] ? `Maior concentração: ${T.forn_excesso[0].nome}` : '');
  // Gold+: congelado, lento, vai romper, OC acima do Emax
  Object.values(F).filter(Boolean).forEach(f => {
    if (f.vai_romper_skus > 0) add('alerta', `${f.vai_romper_skus} SKUs de ${f.nome} vão romper sem OC`, curto_(f.vai_romper_giro) + '/dia', 'de venda em risco', f.vai_romper[0] ? `Primeiro da fila: ${f.vai_romper[0].titulo.slice(0, 36)}` : '');
    if (f.oc_acima_emax > 0) add('melhoria', `OCs que passam do estoque máximo em ${f.nome}`, curto_(f.oc_acima_emax), 'vão chegar acima do Emax', `${f.oc_acima_emax_skus} SKUs com OC além do necessário`);
    if (f.lento_valor > 0 && f.estoque > 0) add('melhoria', `Estoque lento em ${f.nome}`, curto_(f.lento_valor), 'com mais de 120 dias de cobertura', `${Math.round(f.lento_valor / f.estoque * 100)}% do estoque da filial`);
  });
  // alerta
  const aaL = pctCurva(L, 'AA'); if (aaL !== null && aaL >= 20) add('alerta', 'Curva AA de Londrina sem estoque', d1_(aaL) + '%', 'da demanda AA em ruptura', L.top_ruptura[0] ? `${L.top_ruptura[0].titulo.slice(0, 36)} · ${L.top_ruptura[0].oc > 0 ? 'OC ' + L.top_ruptura[0].oc + ' un' : 'sem OC'}` : '');
  if (T && T.top_fornecedores[0]) add('alerta', `Ruptura concentrada em ${T.top_fornecedores[0].nome}`, curto_(T.top_fornecedores[0].perda) + '/dia', 'de MVD perdida a custo', T.top_ruptura[0] ? `Item mais afetado: ${T.top_ruptura[0].titulo.slice(0, 36)}` : '');
  if (T) add('alerta', 'Cobrar entregas antes de comprar de novo', `${T.rupturas_com_oc} de ${T.skus_ruptura}`, 'SKUs em ruptura já têm OC', `Ruptura de ${d1_(T.ruptura_pct)}% da demanda · ${curto_(T.mvd_perdida)}/dia`);
  // azarão e meta
  const az = T && T.azaroes[0]; if (az) add('bem', 'Azarão do momento', az.fator ? `×${d1_(az.fator)}` : 'novo', 'de ritmo nos últimos 15 dias', `${az.titulo.slice(0, 40)} · ${Math.round(az.d15)} un em 15 dias`);
  if (meta && meta.niveis) {
    const pj = projecao_(meta.realizado_mes, meta.meta_mes, meta.referencia), prox = meta.niveis.find(n => pj.proj < n.valor), alc = meta.niveis.filter(n => pj.proj >= n.valor).pop();
    if (alc) add('bem', `No ritmo atual, a Domus bate a ${alc.nome}`, curto_(pj.proj), 'de projeção para o mês', prox && pj.restantes ? `${prox.nome} pede ${curto_(Math.max(0, prox.valor - meta.realizado_mes) / pj.restantes)}/dia` : 'Acima de todos os degraus');
    else if (prox && pj.restantes) add('alerta', `Faltam ${curto_(Math.max(0, prox.valor - meta.realizado_mes) / pj.restantes)}/dia para a ${prox.nome}`, curto_(pj.proj), 'de projeção no ritmo atual', `Ritmo atual: ${curto_(pj.ritmo)}/dia`);
  }
  return M;
}

/** Aba "Mensagens" da planilha do telão: mensagens manuais em tela cheia. */
function abaMensagens_() {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('RESPOSTAS_ID'));
  let sh = ss.getSheetByName('Mensagens');
  if (!sh) {
    sh = ss.insertSheet('Mensagens', 2);
    sh.getRange(1, 1, 1, 7).setValues([['Ativa (sim/não)', 'Tipo (bem/melhoria/alerta/marca)', 'Título (até 45)', 'Número (opcional)', 'Legenda do número', 'Frase de apoio (até 70)', 'Até (data)']]).setFontWeight('bold').setBackground('#212121').setFontColor('#ECFC30');
    sh.getRange(2, 1, 1, 7).setValues([['sim', 'marca', 'Nós somos o eixo.', '', '', 'Clareza vem dos dados, lucidez vem das pessoas.', '']]);
    sh.setFrozenRows(1); sh.setColumnWidths(1, 7, 180);
    sh.getRange('A2:A').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['sim', 'não']).build());
    sh.getRange('B2:B').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['bem', 'melhoria', 'alerta', 'marca']).build());
  }
  return sh;
}
function mensagensManuais_() {
  try {
    const hoje = hoje_();
    return abaMensagens_().getDataRange().getValues().slice(1).filter(r => /^s/i.test(String(r[0])) && String(r[2]).trim())
      .filter(r => !r[6] || (r[6] instanceof Date ? Utilities.formatDate(r[6], CFG.FUSO, 'yyyy-MM-dd') : String(r[6])) >= hoje)
      .map(r => ({ tipo: String(r[1]).trim() || 'marca', titulo: String(r[2]).trim().slice(0, 60), numero: String(r[3]).trim(), legenda: String(r[4]).trim(), apoio: String(r[5]).trim().slice(0, 90), origem: 'manual' }));
  } catch (e) { return []; }
}

/** Publica o estoque (coluna 3) e a tela cheia (cenas da PAC + mensagens). */
function atualizarEstoque() {
  const e = calcularEstoque_();
  const resumo = Object.values(e.filiais).filter(Boolean).map(f => `${f.nome} ${d1_(f.ruptura_pct)}%`).join(', ');
  Logger.log(publicar_('colunas/mural/estoque.json', JSON.stringify(e), `estoque: ruptura ${resumo} (${hoje_()})`));
  publicarTelaCheia_(e);
}
function publicarTelaCheia_(e) {
  e = e || calcularEstoque_();
  const meta = lerRepo_('colunas/meta/dados.json');
  if (meta) { const mt = lerMetas_()[meta.mes]; if (mt) { meta.meta_mes = mt.meta; meta.niveis = niveis_(mt); } }
  const escopos = [e.total, e.filiais.itajai, e.filiais.londrina].filter(Boolean);
  const out = { _info: 'Tela cheia do telão (2560 × 512): cenas da PAC por escopo e mensagens. Gerado pelo Apps Script. Não editar à mão.',
    atualizado_em: agoraISO_(), corte: e.corte, escopos, mensagens: [...mensagensManuais_(), ...insights_(e, meta)] };
  Logger.log(publicar_('colunas/telacheia/dados.json', JSON.stringify(out), `tela cheia: ${escopos.length} escopos, ${out.mensagens.length} mensagens`));
}
function publicarMensagens() { publicarTelaCheia_(); }

// ===================================================================== 2. mural (formulário)

const TIPO_ = { 'Meta batida': 'meta', 'Ação tomada': 'acao', 'Alerta': 'alerta', 'Comemoração': 'comemoracao', 'Aviso': 'aviso' };

function publicarMural() {
  const props = PropertiesService.getScriptProperties();
  // a aba de respostas é a que está ligada ao formulário (não a primeira: Metas e Assinantes ficam na frente)
  const ssR = SpreadsheetApp.openById(props.getProperty('RESPOSTAS_ID'));
  const sh = ssR.getSheets().find(x => x.getFormUrl()) || ssR.getSheets().find(x => /respostas|responses/i.test(x.getName()));
  if (!sh) { Logger.log('Aba de respostas do formulário não encontrada.'); return; }
  const v = sh.getDataRange().getValues();
  if (v.length < 2) return;
  const H = v[0].map(String);
  // garante a coluna "Aprovado" no fim da planilha de respostas
  let ap = H.indexOf('Aprovado');
  if (ap < 0) { ap = H.length; sh.getRange(1, ap + 1).setValue('Aprovado'); }
  const c = n => H.findIndex(h => h.startsWith(n));
  const falta = ['Seu nome', 'Título', 'Texto'].filter(n => c(n) < 0);
  if (falta.length) { Logger.log(`Aba "${sh.getName()}" não é a de respostas do formulário (faltam ${falta.join(', ')}). Não publiquei o mural.`); return; }
  const txt = x => { const s = String(x == null ? '' : x).trim(); return /^(undefined|null)$/i.test(s) ? '' : s; };
  const hoje = hoje_();
  const posts = [];
  v.slice(1).forEach((r, i) => {
    if (!txt(r[c('Título')]) || !txt(r[c('Texto')])) return;   // linha vazia: ignora
    const aprov = String(r[ap] || '').trim().toLowerCase();
    if (CFG.APROVACAO_AUTOMATICA ? aprov === 'não' || aprov === 'nao' : aprov !== 'sim') return;
    const ate = r[c('Fica no ar até')] instanceof Date ? Utilities.formatDate(r[c('Fica no ar até')], CFG.FUSO, 'yyyy-MM-dd') : String(r[c('Fica no ar até')] || '');
    if (ate && ate < hoje) return;
    const id = Utilities.formatDate(new Date(r[0]), CFG.FUSO, 'yyyyMMdd-HHmmss') + '-' + (i + 2);
    let midia = '';
    const mi = c('Mídia');
    if (mi >= 0 && r[mi]) midia = subirMidia_(id, String(r[mi]).split(',')[0].trim());
    posts.push({
      id, tipo: TIPO_[r[c('Tipo')]] || 'aviso', autor: txt(r[c('Seu nome')]) || 'Equipe',
      titulo: txt(r[c('Título')]), texto: txt(r[c('Texto')]),
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
  if (meta) { const mt = lerMetas_()[meta.mes]; if (mt) { meta.meta_mes = mt.meta; meta.niveis = niveis_(mt); } }
  return { meta, news, mural, est };
}

const brl_ = v => !v ? 'R$ 0' : Math.abs(v) >= 1e6 ? 'R$ ' + (v / 1e6).toFixed(2).replace('.', ',') + ' mi' : 'R$ ' + (v / 1e3).toFixed(1).replace('.', ',') + ' mil';
const pc_ = v => v == null ? '–' : v.toFixed(1).replace('.', ',') + '%';
const escH_ = x => String(x == null ? '' : x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const urlOk_ = u => /^https:\/\/[^\s"<>]+$/.test(String(u || ''));

// ---------- layout do e-mail (tabelas + estilos inline: funciona no Gmail, Outlook e celular) ----------
const COR_ = { ink: '#212121', deep: '#141414', lime: '#ECFC30', g3: '#BDBDBD', g1: '#F5F5F5', linha: '#E6E6E6', txt: '#212121', sub: '#6B6B6B', red: '#D93838', it: '#ECFC30', lo: '#7FD6FF' };
const PLAT_ = {
  mercadolivre: ['Mercado Livre', '#FFE600', '#212121'], shopee: ['Shopee', '#EE4D2D', '#FFFFFF'], tiktokshop: ['TikTok Shop', '#0A0A0A', '#25F4EE'],
  amazon: ['Amazon', '#232F3E', '#FF9900'], magalu: ['Magalu', '#0086FF', '#FFFFFF'], geral: ['Marketplaces', '#212121', '#ECFC30'],
};
const CAT_ = { comissao: 'Alerta de comissão', politica: 'Mudança de política', tributario: 'Tributário', logistica: 'Logística', ads: 'Ads e mídia', campanha: 'Campanha', evento: 'Evento', movimento: 'Mercado' };
const FONTE_ = "'Archivo','Helvetica Neue',Arial,sans-serif";

/** Logo da WeAxis (PNG) para ir embutido no e-mail; lido do repositório. Sem GitHub, o cabeçalho usa o nome em texto. */
function logoBlob_() {
  try { const r = gh_('automacao/apps-script/logo_email.png', 'get'); if (r.code === 200) return Utilities.newBlob(Utilities.base64Decode(r.json.content.replace(/\n/g, '')), 'image/png', 'logo.png'); } catch (e) { }
  return null;
}
const dominio_ = u => { const m = String(u).match(/^https:\/\/(?:www\.)?([^\/?#]+)/); return m ? m[1] : ''; };
const busca_ = n => 'https://www.google.com/search?q=' + encodeURIComponent(`${n.manchete} ${n.fonte || ''}`);

function montarEmail_(D, nivel, gerenciarUrl, temLogo) {
  const { meta, news, mural, est } = D, brl = brl_, pc = pc_, C = COR_;
  const ddmm = s => s.slice(8, 10) + '/' + s.slice(5, 7);
  const hoje = Utilities.formatDate(new Date(), CFG.FUSO, 'dd/MM/yyyy');
  const secao = (titulo, sub) => `<tr><td style="padding:30px 32px 10px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="width:6px;background:${C.lime};border-radius:3px">&nbsp;</td>
      <td style="padding-left:12px;font:700 20px/1.2 ${FONTE_};color:${C.txt}">${titulo}${sub ? `<div style="font:400 13px/1.4 ${FONTE_};color:${C.sub};padding-top:2px">${sub}</div>` : ''}</td></tr></table></td></tr>`;
  const tabela = (cab, linhas, destaqueUltima) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font:400 13px/1.4 ${FONTE_};color:${C.txt}">
      <tr>${cab.map((c, i) => `<td style="padding:8px 10px;background:${C.ink};color:${i ? '#FFFFFF' : C.lime};font-weight:700;text-align:${i ? 'right' : 'left'}${i === 0 ? ';border-radius:6px 0 0 0' : ''}${i === cab.length - 1 ? ';border-radius:0 6px 0 0' : ''}">${c}</td>`).join('')}</tr>
      ${linhas.map((l, k) => { const ult = destaqueUltima && k === linhas.length - 1; return `<tr>${l.map((c, i) => `<td style="padding:8px 10px;border-bottom:1px solid ${C.linha};text-align:${i ? 'right' : 'left'};${k % 2 ? `background:${C.g1};` : ''}${ult ? 'font-weight:700;border-top:2px solid ' + C.ink + ';' : ''}white-space:nowrap">${c}</td>`).join('')}</tr>`; }).join('')}</table>`;
  const kpi = (rot, valor, nota, cor) => `<td width="33%" valign="top" style="padding:0 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.ink};border-radius:10px"><tr><td style="padding:14px 14px 16px">
      <div style="font:600 11px/1.3 ${FONTE_};color:${C.g3};text-transform:uppercase;letter-spacing:.06em">${rot}</div>
      <div style="font:800 22px/1.15 ${FONTE_};color:${cor || '#FFFFFF'};padding-top:6px">${valor}</div>
      <div style="font:400 12px/1.35 ${FONTE_};color:${C.g3};padding-top:4px">${nota}</div></td></tr></table></td>`;
  const R = [];

  // ---------- cabeçalho ----------
  R.push(`<tr><td style="background:${C.ink};padding:26px 32px 22px;border-radius:14px 14px 0 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle">${temLogo ? `<img src="cid:logo" alt="weaxis" height="30" style="display:block;height:30px;width:auto;border:0">` : `<span style="font:800 22px ${FONTE_};color:#FFFFFF">weaxis</span>`}</td>
      <td valign="middle" align="right" style="font:600 12px/1.3 ${FONTE_};color:${C.g3}">${hoje}</td></tr></table>
    <div style="font:800 34px/1.05 ${FONTE_};color:${C.lime};padding-top:22px;letter-spacing:-.01em">Radar Domus</div>
    <div style="font:400 14px/1.4 ${FONTE_};color:${C.g3};padding-top:6px">Marketplaces, faturamento e estoque · Itajaí + Londrina</div></td></tr>
    <tr><td style="height:6px;background:${C.lime};line-height:6px;font-size:0">&nbsp;</td></tr>`);

  // ---------- resumo em 3 números (só nível completo) ----------
  if (nivel === 'completo' && meta) {
    const pj = projecao_(meta.realizado_mes, meta.meta_mes, meta.referencia);
    const nv = meta.niveis && meta.niveis.length ? meta.niveis : [{ nome: 'Meta 1', valor: meta.meta_mes }];
    const alc = nv.filter(n => pj.proj >= n.valor).pop();
    const rup = est && (est.total || Object.values(est.filiais).find(Boolean));
    R.push(`<tr><td style="padding:24px 26px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${kpi('Faturamento no mês', brl(meta.realizado_mes), `${pc(meta.realizado_mes / meta.meta_mes * 100)} da Meta 1 · margem ${pc(meta.margem_pct_mes)}`)}
      ${kpi('Projeção do mês', brl(pj.proj), alc ? `fecha na ${alc.nome}` : 'abaixo da Meta 1', alc ? C.lime : '#F25C5C')}
      ${rup ? kpi('Ruptura · Domus', pc(rup.pct_ruptura), `${brl(rup.perda_dia_custo)}/dia de venda perdida`, '#F25C5C') : '<td></td>'}
    </tr></table></td></tr>`);
  }

  // ---------- notícias com link de referência ----------
  if (news && (news.itens || []).length) {
    R.push(secao('Notícias do dia', 'O que muda para quem vende em marketplace'));
    news.itens.forEach(n => {
      const [pnome, pbg, pfg] = PLAT_[n.plataforma] || PLAT_.geral;
      const temUrl = urlOk_(n.url), link = temUrl ? n.url : busca_(n);
      R.push(`<tr><td style="padding:6px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.linha};border-radius:10px;border-left:6px solid ${pbg}"><tr><td style="padding:14px 16px 16px">
        <span style="display:inline-block;font:700 11px/1 ${FONTE_};background:${pbg};color:${pfg};padding:5px 8px;border-radius:4px;text-transform:uppercase;letter-spacing:.04em">${escH_(n.tag || pnome)}</span>
        <span style="font:600 11px/1 ${FONTE_};color:${n.categoria === 'comissao' ? C.red : C.sub};text-transform:uppercase;letter-spacing:.04em;padding-left:6px">${CAT_[n.categoria] || ''}</span>
        <div style="font:700 17px/1.3 ${FONTE_};color:${C.txt};padding-top:10px">${escH_(n.manchete)}</div>
        ${n.numero ? `<div style="font:800 15px/1.3 ${FONTE_};color:${C.txt};padding-top:6px"><span style="background:${C.lime};padding:1px 6px;border-radius:3px">${escH_(n.numero)}</span> <span style="font-weight:400;color:${C.sub}">${escH_(n.legenda || '')}</span></div>` : ''}
        ${n.detalhe ? `<div style="font:400 14px/1.45 ${FONTE_};color:#3A3A3A;padding-top:6px">${escH_(n.detalhe)}</div>` : ''}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px"><tr>
          <td style="background:${C.ink};border-radius:6px"><a href="${link}" target="_blank" style="display:inline-block;padding:9px 14px;font:700 13px/1 ${FONTE_};color:${C.lime};text-decoration:none;white-space:nowrap">${temUrl ? 'Ler a matéria →' : 'Buscar a matéria →'}</a></td>
          <td style="padding-left:12px;font:400 12px/1.4 ${FONTE_};color:${C.sub}">Fonte: ${escH_(n.fonte)}${n.data_fonte ? ' · ' + escH_(n.data_fonte) : ''}<br>${temUrl ? `Referência: <a href="${n.url}" style="color:${C.sub}">${escH_(dominio_(n.url))}</a>` : 'Referência: busca pelo título'}</td>
        </tr></table></td></tr></table></td></tr>`);
    });
    const extras = (news.mais_links || []).filter(x => urlOk_(x.url));
    if (extras.length) {
      R.push(secao('Mais leituras'));
      R.push(`<tr><td style="padding:0 32px">${extras.map(x => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid ${C.linha}"><tr><td style="padding:9px 0;font:400 14px/1.4 ${FONTE_}"><a href="${x.url}" target="_blank" style="color:${C.txt};font-weight:600;text-decoration:none">${escH_(x.titulo)}</a><br><span style="font-size:12px;color:${C.sub}">${escH_(x.fonte || '')} · <a href="${x.url}" style="color:${C.sub}">${escH_(dominio_(x.url))}</a></span></td></tr></table>`).join('')}</td></tr>`);
    }
    const fontes = [...new Set(news.itens.filter(n => urlOk_(n.url)).map(n => n.url))];
    if (fontes.length) R.push(`<tr><td style="padding:16px 32px 0;font:400 12px/1.6 ${FONTE_};color:${C.sub}"><b style="color:${C.txt}">Referências</b><br>${fontes.map((u, k) => `${k + 1}. <a href="${u}" style="color:${C.sub};word-break:break-all">${escH_(u)}</a>`).join('<br>')}</td></tr>`);
  }

  // ---------- mural ----------
  const vazio = s => !String(s == null ? '' : s).trim() || /^(undefined|null)$/i.test(String(s).trim());
  const posts = ((mural && mural.posts) || []).filter(p => (!p.ate || p.ate >= hoje_()) && !(vazio(p.titulo) && vazio(p.texto)));
  if (posts.length) {
    R.push(secao('Mural do time', 'Metas, ações e avisos publicados pelos analistas'));
    posts.forEach(p => R.push(`<tr><td style="padding:6px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.g1};border-radius:10px"><tr><td style="padding:12px 16px;font:400 14px/1.45 ${FONTE_};color:${C.txt}">
      <b>${escH_(p.titulo)}</b>${p.numero ? ` · <span style="background:${C.lime};padding:1px 6px;border-radius:3px;font-weight:800">${escH_(p.numero)}</span>` : ''}<br>${escH_(p.texto)}<br><span style="font-size:12px;color:${C.sub}">${escH_(p.autor)}</span></td></tr></table></td></tr>`));
  }

  if (nivel === 'completo') {
    // ---------- faturamento ----------
    if (meta) {
      const F = meta.filiais || {}, ks = Object.keys(F);
      const pj = projecao_(meta.realizado_mes, meta.meta_mes, meta.referencia);
      const nv = meta.niveis && meta.niveis.length ? meta.niveis : [{ nome: 'Meta 1', valor: meta.meta_mes }];
      R.push(secao('Faturamento · Domus', `D+1 · até ${ddmm(meta.referencia)} · ontem ${brl(meta.ontem.receita)} em ${meta.ontem.pedidos.toLocaleString('pt-BR')} pedidos`));
      R.push(`<tr><td style="padding:0 32px">${tabela(['Degrau', 'Valor', 'Feito', 'Projeção', 'Precisa/dia'], nv.map(n => [`<b>${n.nome}</b>`, brl(n.valor), pc(meta.realizado_mes / n.valor * 100), pc(pj.proj / n.valor * 100), pj.restantes ? brl(Math.max(0, n.valor - meta.realizado_mes) / pj.restantes) : '–']))}
        <div style="font:400 12px/1.4 ${FONTE_};color:${C.sub};padding-top:6px">Ritmo atual: ${brl(pj.ritmo)}/dia · projeção linear até o fim do mês.</div></td></tr>`);
      const cel = v => v && v.receita ? `${brl(v.receita)} <span style="color:${C.sub}">${pc(v.margem_pct)}</span>` : '<span style="color:#AAA">–</span>';
      if (meta.canais_mes) R.push(`<tr><td style="padding:16px 32px 0"><div style="font:600 13px/1.4 ${FONTE_};color:${C.sub};padding-bottom:6px">Canais no mês · receita e margem</div>${tabela(['Canal', ...ks.map(k => F[k].nome), 'Domus'],
        [...meta.canais_mes.map(c => [c.canal, ...ks.map(k => cel(c[k])), `<b>${cel(c.total)}</b>`]),
         ['Total', ...ks.map(k => cel({ receita: F[k].realizado_mes, margem_pct: F[k].margem_pct_mes })), cel({ receita: meta.realizado_mes, margem_pct: meta.margem_pct_mes })]], true)}</td></tr>`);
    }
    // ---------- estoque ----------
    if (est) {
      const bl = Object.values(est.filiais).filter(Boolean); if (est.total) bl.push(est.total);
      R.push(secao('Estoque', 'PACs de Itajaí e Londrina · valores a custo'));
      const sub = (v, t) => `${v} <span style="color:${C.sub}">${t}</span>`;
      R.push(`<tr><td style="padding:0 32px">${tabela(['Análise Gold', ...bl.map(f => f.nome + (f.parcial ? ' *' : ''))], [
        ['Estoque a custo', ...bl.map(f => `<b>${brl(f.estoque)}</b>`)],
        ['DIO', ...bl.map(f => d1_(f.dio) + ' dias')],
        ['CCC', ...bl.map(f => `<span style="color:${f.ccc < 0 ? '#3A7D0A' : C.red}">${d1_(f.ccc)} dias</span>`)],
        ['NWC', ...bl.map(f => `<span style="color:${f.nwc < 0 ? '#3A7D0A' : C.red}">${curto_(f.nwc)}</span>`)],
        [`<b style="color:${C.red}">Ruptura (demanda)</b>`, ...bl.map(f => sub(`<b style="color:${C.red}">${pc(f.ruptura_pct)}</b>`, curto_(f.mvd_perdida) + '/dia'))],
        ['Excesso acima do Emax', ...bl.map(f => brl(f.excesso))],
        ['Congelado (sem venda)', ...bl.map(f => sub(brl(f.sem_giro), (f.skus_congelados || 0) + ' SKUs'))],
        ['SKUs em ruptura · com OC', ...bl.map(f => `${f.skus_ruptura} · ${f.rupturas_com_oc}`)],
      ])}<div style="font:400 12px/1.4 ${FONTE_};color:${C.sub};padding-top:6px">Análise Gold: sem PI Verticalizado, dado faltante não vira zero, Domus = linhas somadas. * base parcial (aba com filtro).</div></td></tr>`);
      const lista = (titulo, arr, fmt) => arr && arr.length ? `<tr><td style="padding:14px 32px 0;font:400 13px/1.55 ${FONTE_};color:${C.txt}"><b>${titulo}</b><br>${arr.slice(0, 5).map(x => `${escH_(x.titulo.slice(0, 52))} <span style="color:${C.sub}">· ${x.filial === 'Itajaí' ? 'ITJ' : 'LDN'} · curva ${x.curva} · ${fmt(x)}</span>`).join('<br>')}</td></tr>` : '';
      const T = est.total || bl[0];
      R.push(lista('Top 5 em ruptura (AA e A primeiro)', T.top_ruptura, x => `${brl(x.perdido)}/dia · ${x.oc > 0 ? 'OC ' + Math.round(x.oc) + ' un' : '<b style="color:' + C.red + '">sem OC</b>'}`));
      R.push(lista('Campeões de venda (giro a custo)', T.campeoes, x => `${d1_(x.mvd)} un/dia · ${brl(x.giro)}/dia · ${x.estoque > 0 ? Math.round(x.cobertura) + ' dias de cobertura' : '<b style="color:' + C.red + '">em ruptura</b>'}`));
      R.push(lista('Azarões (disparou nos últimos 15 dias)', T.azaroes, x => `${x.fator ? '×' + d1_(x.fator) : 'novo'} · ${Math.round(x.d15)} un em 15 dias · ${x.estoque > 0 ? Math.round(x.cobertura) + ' dias de cobertura' : '<b style="color:' + C.red + '">em ruptura</b>'}`));
      R.push(lista('Estoque congelado (maior valor sem venda)', T.congelados, x => `${brl(x.valor)} · ${Math.round(x.estoque)} un`));

      // ---------- Gold+: congelado, lento, excesso, OCs e cobertura ----------
      const tem = f => f.pct_congelado !== undefined;
      if (bl.every(tem)) {
        R.push(secao('Saúde do estoque', 'Para onde está indo o dinheiro parado · valores a custo'));
        R.push(`<tr><td style="padding:0 32px">${tabela(['Indicador', ...bl.map(f => f.nome + (f.parcial ? ' *' : ''))], [
          ['Congelado (sem venda)', ...bl.map(f => sub(`<b>${brl(f.sem_giro)}</b>`, pc(f.pct_congelado)))],
          ['Lento (cobertura &gt; 120 d)', ...bl.map(f => sub(brl(f.lento_valor), f.lento_skus + ' SKUs'))],
          ['Excesso acima do Emax', ...bl.map(f => sub(brl(f.excesso), pc(f.pct_excesso)))],
          ['OC em trânsito', ...bl.map(f => brl(f.oc_valor))],
          ['OC que passa do Emax', ...bl.map(f => sub(`<span style="color:${f.oc_acima_emax > 0 ? C.red : C.txt}">${brl(f.oc_acima_emax)}</span>`, f.oc_acima_emax_skus + ' SKUs'))],
          ['Vai romper (sem OC)', ...bl.map(f => sub(`<b style="color:${f.vai_romper_skus ? C.red : C.txt}">${f.vai_romper_skus} SKUs</b>`, curto_(f.vai_romper_giro) + '/dia'))],
          ['Nível de serviço', ...bl.map(f => pc(f.nivel_servico))],
          ['Estoque nos 20% maiores SKUs', ...bl.map(f => pc(f.concentracao_top20))],
        ])}<div style="font:400 12px/1.4 ${FONTE_};color:${C.sub};padding-top:6px">Vai romper = cobertura menor que o lead time e nenhuma OC. Nível de serviço = SKUs que vendem e têm estoque.</div></td></tr>`);
        const fx = (T.cobertura_faixas || []);
        if (fx.length) R.push(`<tr><td style="padding:14px 32px 0"><div style="font:600 13px/1.4 ${FONTE_};color:${C.sub};padding-bottom:6px">Cobertura do estoque · ${escH_(T.nome)} (dias de venda que o estoque aguenta)</div>${tabela(['Faixa', 'Valor', 'SKUs', '% do estoque'], fx.map(x => [x.faixa, brl(x.valor), x.skus.toLocaleString('pt-BR'), pc(T.estoque > 0 ? x.valor / T.estoque * 100 : null)]))}</td></tr>`);
        R.push(lista('Estoque lento (maior valor com mais de 120 dias de cobertura)', T.lentos, x => `${brl(x.valor)} · ${Math.round(x.cobertura)} dias`));
        R.push(lista('Vai romper antes de chegar (sem OC)', T.vai_romper, x => `${d1_(x.cobertura)} dias de estoque · LT ${x.lt ? Math.round(x.lt) + ' d' : '–'}`));
      }

      // ---------- sem estoque · curvas AA e A, por filial, com nome ----------
      Object.values(est.filiais).filter(f => f && f.ruptura_aa_a && f.ruptura_aa_a.length).forEach(f => {
        R.push(secao(`Sem estoque · curvas AA e A · ${escH_(f.nome)}`, `${f.skus_ruptura_aa_a} SKUs${f.skus_ruptura_aa_a > Math.min(25, f.ruptura_aa_a.length) ? ` (mostrando os ${Math.min(25, f.ruptura_aa_a.length)} de maior venda perdida)` : ''}${f.parcial ? ' · base parcial' : ''}`));
        R.push(`<tr><td style="padding:0 32px">${tabela(['Produto', 'Curva', 'SKU', 'Perda/dia', 'OC'], f.ruptura_aa_a.slice(0, 25).map(x => [escH_(x.titulo.slice(0, 46)), `<b>${x.curva}</b>`, escH_(x.sku), brl(x.perdido), x.oc > 0 ? Math.round(x.oc) + ' un' : `<b style="color:${C.red}">sem OC</b>`]))}</td></tr>`);
      });
    }
  }

  // ---------- rodapé ----------
  R.push(`<tr><td style="padding:30px 0 0"></td></tr><tr><td style="background:${C.deep};padding:22px 32px;border-radius:0 0 14px 14px;font:400 12px/1.6 ${FONTE_};color:${C.g3}">
    <b style="color:${C.lime}">Radar Domus</b> · enviado por ${CFG.REMETENTE}<br>
    ${nivel === 'completo' ? 'Contém dados internos de faturamento e estoque: não encaminhe para fora da Domus.<br>' : ''}Faturamento é D+1 (Preço Certo); estoque vem das PACs, a custo; notícias conferidas na fonte original.
    ${gerenciarUrl ? `<br><a href="${gerenciarUrl}" style="color:${C.lime}">Gerenciar inscrição ou parar de receber</a>` : ''}</td></tr>`);

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
  <body style="margin:0;padding:0;background:#ECECEC">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ECECEC"><tr><td align="center" style="padding:24px 10px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#FFFFFF;border-radius:14px">
  ${R.join('\n')}
  </table></td></tr></table></body></html>`;
}

/** Envia o Radar para cada assinante ativo (um e-mail por pessoa, com o conteúdo do nível dela). */
function enviarEmailDiario() {
  const D = dadosDoDia_();
  if (!D.news && !D.meta && !D.est) throw new Error('Sem dados para enviar (GitHub e PACs indisponíveis).');
  const quem = Session.getEffectiveUser().getEmail();
  if (quem.toLowerCase() !== CFG.REMETENTE) Logger.log(`Aviso: o script roda como ${quem}; o Radar sai desse endereço. Para sair de ${CFG.REMETENTE}, instale o script logado nessa conta.`);
  let gerenciar = ''; try { gerenciar = ScriptApp.getService().getUrl() || ''; } catch (e) { }
  const logo = logoBlob_(), img = logo ? { logo } : undefined;
  const html = { completo: montarEmail_(D, 'completo', gerenciar, !!logo), noticias: montarEmail_(D, 'noticias', gerenciar, !!logo) };
  const assunto = `Radar Domus · ${Utilities.formatDate(new Date(), CFG.FUSO, 'dd/MM')}` + (D.news && D.news.itens && D.news.itens[0] ? ` · ${D.news.itens[0].manchete}` : '');
  const lista = lerAssinantes_().filter(a => a.ativo);
  if (lista.length > MailApp.getRemainingDailyQuota()) throw new Error(`Lista (${lista.length}) maior que a cota de e-mail de hoje (${MailApp.getRemainingDailyQuota()}).`);
  let ok = 0; const falhas = [];
  lista.forEach(a => { try { MailApp.sendEmail({ to: a.email, subject: assunto, htmlBody: html[a.nivel], inlineImages: img, name: CFG.REMETENTE_NOME, replyTo: CFG.REMETENTE }); ok++; } catch (e) { falhas.push(`${a.email}: ${e.message}`); } });
  Logger.log(`Radar enviado para ${ok} de ${lista.length}.` + (falhas.length ? ' Falhas: ' + falhas.join(' | ') : ''));
}

/** Envia só para quem está rodando o script (para conferir antes de soltar para todos). */
function enviarTeste() {
  const D = dadosDoDia_(), eu = Session.getEffectiveUser().getEmail();
  const logo = logoBlob_(), img = logo ? { logo } : undefined;
  MailApp.sendEmail({ to: eu, subject: '[teste] Radar Domus · versão completa', htmlBody: montarEmail_(D, 'completo', '', !!logo), inlineImages: img, name: CFG.REMETENTE_NOME });
  MailApp.sendEmail({ to: eu, subject: '[teste] Radar Domus · versão só notícias', htmlBody: montarEmail_(D, 'noticias', '', !!logo), inlineImages: img, name: CFG.REMETENTE_NOME });
  try { SpreadsheetApp.getActive().toast('Teste enviado para ' + eu + ' (versão completa e versão só notícias).', 'Radar', 8); } catch (e) { Logger.log('Teste enviado para ' + eu); }
}
