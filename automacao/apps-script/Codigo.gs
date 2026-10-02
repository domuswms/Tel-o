/**
 * Telão WeAxis · automação no Google (Apps Script)
 *
 * Faz, sem ninguém mexer:
 *   1. atualizarRuptura()   todo dia às 06h  · lê a PAC (aba Gustavo) e publica colunas/mural/ruptura.json
 *   2. publicarMural()      a cada 10 min    · lê as respostas do formulário e publica colunas/mural/mural.json
 *   3. enviarEmailDiario()  todo dia às 07h30 · e-mail com notícias + resumo de meta e ruptura, do seu e-mail da empresa
 *
 * Instalação (uma vez só): veja automacao/README.md, passo "Apps Script".
 * O token do GitHub fica em Propriedades do script (GITHUB_TOKEN), nunca no código.
 */

const CFG = {
  GITHUB_OWNER: 'NOME-DA-ORGANIZACAO',      // ex.: domuscommerce
  GITHUB_REPO: 'telao-weaxis',
  GITHUB_BRANCH: 'main',
  PAC_ID: '17xjD_hJq1V_vpydBPeY25NQWbL9F9GwlQqM2HhIymPE',
  PAC_ABA: 'Gustavo',
  PAC_BASE: 'SC · carteira Gustavo',
  EMAILS: ['joao.vitor@domuscommerce.com'],  // quem recebe o e-mail das 07h30
  APROVACAO_AUTOMATICA: true,                // false = só vai ao telão quem tiver "sim" na coluna Aprovado
  MIDIA_MAX_MB: 25,
  FUSO: 'America/Sao_Paulo',
};

// ===================================================================== instalação

/** Rode uma vez. Cria o formulário dos analistas, a planilha de respostas e os gatilhos. */
function configurarTudo() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('GITHUB_TOKEN')) throw new Error('Defina GITHUB_TOKEN em Configurações do projeto > Propriedades do script.');

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

  const ss = SpreadsheetApp.create('Telão · respostas do mural');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  props.setProperty('FORM_ID', form.getId());
  props.setProperty('RESPOSTAS_ID', ss.getId());

  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('publicarMural').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('atualizarRuptura').timeBased().atHour(6).nearMinute(0).everyDays(1).inTimezone(CFG.FUSO).create();
  ScriptApp.newTrigger('enviarEmailDiario').timeBased().atHour(7).nearMinute(30).everyDays(1).inTimezone(CFG.FUSO).create();

  Logger.log('Formulário (para os analistas): ' + form.getPublishedUrl());
  Logger.log('Edição do formulário: ' + form.getEditUrl());
  Logger.log('Planilha de respostas: ' + ss.getUrl());
  Logger.log('FALTA 1 PASSO MANUAL: no formulário, adicione a pergunta "Upload de arquivo" com o título "Mídia (opcional)" (o Apps Script não consegue criar esse tipo).');
}

// ===================================================================== GitHub

function gh_(path, method, body) {
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

// ===================================================================== 1. ruptura (PAC)

function calcularRuptura_() {
  const sh = SpreadsheetApp.openById(CFG.PAC_ID).getSheetByName(CFG.PAC_ABA);
  const v = sh.getDataRange().getValues();
  // acha a linha de cabeçalho (a que contém "MVD") e as colunas pelo nome
  const hi = v.findIndex(r => r.some(c => String(c).trim() === 'MVD'));
  const H = v[hi].map(c => String(c).trim());
  const col = nome => { const i = H.indexOf(nome); return i >= 0 ? i : H.findIndex(h => h.endsWith(nome)); };
  const C = { sku: col('SKU'), tit: col('Título'), forn: col('Fornecedor'), custo: col('Custo'), est: col('Estoque'), oc: col('OC Trânsito'), curva: col('Curva'), mvd: col('MVD') };
  const num = x => typeof x === 'number' ? x : (parseFloat(String(x).replace(/R\$|\s|\./g, '').replace(',', '.')) || 0);
  const itens = v.slice(hi + 1).filter(r => r[C.sku]).map(r => ({
    sku: String(r[C.sku]).trim(), titulo: String(r[C.tit]), forn: String(r[C.forn]), custo: num(r[C.custo]),
    est: num(r[C.est]), oc: num(r[C.oc]), curva: String(r[C.curva]).trim() || '?', mvd: num(r[C.mvd]),
  }));
  const ativos = itens.filter(x => x.mvd > 0), rup = ativos.filter(x => x.est <= 0);
  const perda = x => x.mvd * x.custo;
  const soma = a => a.reduce((s, x) => s + perda(x), 0);
  const curvas = {};
  ['AA', 'A', 'B', 'C', 'D'].forEach(k => {
    const a = ativos.filter(x => x.curva === k), r = a.filter(x => x.est <= 0);
    curvas[k] = { ativos: a.length, ruptura: r.length, perda: Math.round(soma(r) * 100) / 100 };
  });
  const porForn = {};
  rup.forEach(x => porForn[x.forn] = (porForn[x.forn] || 0) + perda(x));
  const curto = n => n.replace(/\s+(INDUSTRIA|INDUSTRIAL|IMPORTADORA|DISTRIBUIDORA|ELETRODOMESTICOS|COMERCIO|LTDA|S\.?\s?A\.?|E|DA|DE|DO).*$/i, '').replace(/^O\.V\.D\.?$/i, 'O.V.D. (Vonder)');
  return {
    _info: 'Coluna 3 · Alertas de ruptura. Gerado pelo Apps Script a partir da PAC. Não editar à mão.',
    atualizado_em: agoraISO_(), base: CFG.PAC_BASE, fonte: 'PAC · Processo Avançado de Compras - SC',
    skus_ativos: ativos.length, skus_ruptura: rup.length,
    pct_ruptura: Math.round(rup.length / Math.max(1, ativos.length) * 10000) / 100,
    perda_dia_custo: Math.round(soma(rup) * 100) / 100,
    pct_perda: Math.round(soma(rup) / Math.max(1, soma(ativos)) * 10000) / 100,
    sem_oc: rup.filter(x => x.oc <= 0).length,
    curvas,
    top_fornecedores: Object.entries(porForn).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, p]) => ({ nome: curto(n), perda: Math.round(p * 100) / 100 })),
    top_skus: rup.sort((a, b) => perda(b) - perda(a)).slice(0, 5).map(x => ({ sku: x.sku, titulo: x.titulo.slice(0, 48), curva: x.curva, perda: Math.round(perda(x)), oc: x.oc })),
  };
}

function atualizarRuptura() {
  const r = calcularRuptura_();
  Logger.log(publicar_('colunas/mural/ruptura.json', JSON.stringify(r, null, 1), `ruptura: ${r.pct_ruptura}% (${hoje_()})`));
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

function enviarEmailDiario() {
  const meta = lerRepo_('colunas/meta/dados.json');
  const news = lerRepo_('colunas/noticias/dados.json');
  let rup; try { rup = calcularRuptura_(); } catch (e) { rup = lerRepo_('colunas/mural/ruptura.json'); }
  const brl = v => v >= 1e6 ? 'R$ ' + (v / 1e6).toFixed(2).replace('.', ',') + ' mi' : 'R$ ' + (v / 1e3).toFixed(1).replace('.', ',') + ' mil';
  const pc = v => v.toFixed(1).replace('.', ',') + '%';
  const ddmm = s => s.slice(8, 10) + '/' + s.slice(5, 7);
  const L = [];
  L.push(`<div style="font-family:Arial,sans-serif;max-width:640px;color:#212121">`);
  L.push(`<div style="background:#212121;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0"><b style="color:#ECFC30;font-size:20px">Telão WeAxis</b><br>Resumo de ${Utilities.formatDate(new Date(), CFG.FUSO, 'dd/MM/yyyy')}</div>`);
  if (meta) {
    const p = meta.realizado_mes / meta.meta_mes * 100, o = meta.ontem;
    L.push(`<h3 style="margin:22px 0 6px">Meta do mês</h3><p style="margin:0">Realizado: <b>${brl(meta.realizado_mes)}</b> · ${pc(p)} da meta de ${brl(meta.meta_mes)}${meta.meta_exemplo ? ' (meta de exemplo)' : ''}<br>Ontem (${ddmm(o.data)}): <b>${brl(o.receita)}</b> · ${o.pedidos.toLocaleString('pt-BR')} pedidos · ticket R$ ${o.ticket.toFixed(2).replace('.', ',')}</p>`);
  }
  if (rup) {
    L.push(`<h3 style="margin:22px 0 6px">Ruptura · ${rup.base}</h3><p style="margin:0"><b style="color:#D93838">${pc(rup.pct_ruptura)}</b> dos SKUs com venda estão sem estoque (${rup.skus_ruptura} de ${rup.skus_ativos})<br>Venda perdida a custo: <b>${brl(rup.perda_dia_custo)}/dia</b> · ${rup.sem_oc} sem OC em trânsito<br>Curva A em ruptura: ${rup.curvas.A.ruptura} SKUs (${brl(rup.curvas.A.perda)}/dia)</p>`);
    L.push(`<ul style="margin:8px 0 0;padding-left:18px">${rup.top_skus.slice(0, 5).map(s => `<li>${s.titulo} · curva ${s.curva} · ${brl(s.perda)}/dia${s.oc ? ' · OC ' + s.oc : ' · sem OC'}</li>`).join('')}</ul>`);
  }
  if (news && news.itens) {
    L.push(`<h3 style="margin:22px 0 6px">Notícias de marketplaces</h3>`);
    news.itens.forEach(n => L.push(`<p style="margin:0 0 12px"><b>${n.manchete}</b><br>${n.detalhe || ''}<br><span style="color:#777">${n.fonte}${n.data_fonte ? ' · ' + n.data_fonte : ''}${n.url ? ` · <a href="${n.url}">ler</a>` : ''}</span></p>`));
  }
  L.push(`<p style="color:#888;font-size:12px;margin-top:24px">Gerado automaticamente. Faturamento é D+1 (Preço Certo); ruptura vem da PAC.</p></div>`);
  MailApp.sendEmail({ to: CFG.EMAILS.join(','), subject: `Telão · resumo do dia ${Utilities.formatDate(new Date(), CFG.FUSO, 'dd/MM')}`, htmlBody: L.join('\n'), name: 'Telão WeAxis' });
}
