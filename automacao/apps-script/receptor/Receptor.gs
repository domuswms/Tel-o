/**
 * Telão · Receptor
 * Projeto Apps Script SEPARADO (não cole no Codigo.gs). Recebe da rotina diária do Claude os JSON do dia
 * e grava no GitHub. Existe porque a sessão do Claude na nuvem não consegue dar git push no repositório.
 *
 * Propriedades do script (Configurações do projeto → Propriedades do script), nunca no código:
 *   GITHUB_TOKEN    token fine-grained só do repositório Tel-o, permissão Contents = Read and write
 *   ROTINA_SEGREDO  texto aleatório longo (rode gerarSegredo() uma vez e copie do registro)
 *
 * Implantar → Nova implantação → App da Web · Executar como: Eu · Quem pode acessar: Qualquer pessoa.
 * Sem o segredo o receptor recusa tudo; ele só grava os caminhos de CAMINHOS e só devolve os de LEITURA.
 */

const R = {
  OWNER: 'domuswms',
  REPO: 'Tel-o',
  BRANCH: 'main',
  MAX_BYTES: 400000,
  CAMINHOS: [
    'colunas/meta/dados.json',
    'colunas/noticias/dados.json',
    'colunas/telacheia/analise.json',
    'automacao/ultima_execucao.json',
  ],
  // o que a rotina pode LER (acao: "ler"): scripts e dados de entrada. Funciona com o repositório privado.
  LEITURA: [
    'automacao/atualizar_meta.py', 'automacao/validar_analise.py', 'automacao/entregar.py', 'automacao/tem_pedido.py',
    'automacao/pedido.json', 'automacao/ultima_execucao.json',
    'colunas/meta/metas.json', 'colunas/meta/dados.json', 'colunas/noticias/dados.json',
    'colunas/telacheia/dados.json', 'colunas/telacheia/analise.json', 'colunas/mural/estoque.json',
  ],
};

function doPost(e) {
  const resp = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  try {
    const props = PropertiesService.getScriptProperties();
    const segredo = props.getProperty('ROTINA_SEGREDO');
    if (!segredo || segredo.length < 32) return resp({ ok: false, erro: 'receptor sem ROTINA_SEGREDO configurado' });
    if (!e || !e.postData || e.postData.length > R.MAX_BYTES * 4) return resp({ ok: false, erro: 'corpo ausente ou grande demais' });
    let corpo;
    try { corpo = JSON.parse(e.postData.contents); } catch (x) { return resp({ ok: false, erro: 'JSON inválido' }); }
    if (!igual_(String(corpo.segredo || ''), segredo)) { Utilities.sleep(1500); return resp({ ok: false, erro: 'não autorizado' }); }

    if (corpo.acao === 'ler') {
      const out = {};
      R.LEITURA.forEach(p => { const a = gh_(p, 'get'); if (a.code === 200 && a.json.content) out[p] = Utilities.newBlob(Utilities.base64Decode(a.json.content.replace(/\n/g, ''))).getDataAsString('UTF-8'); });
      return resp({ ok: true, arquivos: out });
    }

    const arquivos = corpo.arquivos || {};
    const nomes = Object.keys(arquivos);
    if (!nomes.length) return resp({ ok: false, erro: 'nenhum arquivo' });
    const fora = nomes.filter(p => R.CAMINHOS.indexOf(p) < 0);
    if (fora.length) return resp({ ok: false, erro: 'caminho não permitido: ' + fora.join(', ') });

    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const out = {};
      nomes.forEach(p => {
        const v = arquivos[p];
        const txt = typeof v === 'string' ? v : JSON.stringify(v, null, 1);
        JSON.parse(txt); // só JSON válido entra no repositório
        if (txt.length > R.MAX_BYTES) throw new Error(p + ' grande demais');
        out[p] = gravar_(p, txt, corpo.mensagem || 'Rotina diária · ' + p);
      });
      return resp({ ok: true, arquivos: out });
    } finally { lock.releaseLock(); }
  } catch (x) {
    return resp({ ok: false, erro: String(x.message || x) });
  }
}

/** Abrir a URL no navegador só confirma que o receptor está no ar (não mostra nada sensível). */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, receptor: 'telao' })).setMimeType(ContentService.MimeType.JSON);
}

function igual_(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function gh_(path, method, body) {
  const tk = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!tk) throw new Error('receptor sem GITHUB_TOKEN');
  const url = `https://api.github.com/repos/${R.OWNER}/${R.REPO}/contents/${path}` + (method === 'get' ? `?ref=${R.BRANCH}` : '');
  const r = UrlFetchApp.fetch(url, {
    method, muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + tk, Accept: 'application/vnd.github+json' },
    payload: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = JSON.parse(r.getContentText()); } catch (x) { }
  return { code: r.getResponseCode(), json: j };
}

function gravar_(path, txt, msg) {
  const b64 = Utilities.base64Encode(txt, Utilities.Charset.UTF_8);
  const atual = gh_(path, 'get');
  if (atual.code === 200 && String(atual.json.content || '').replace(/\n/g, '') === b64) return 'igual';
  const r = gh_(path, 'put', { message: msg, content: b64, branch: R.BRANCH, sha: atual.code === 200 ? atual.json.sha : undefined });
  if (r.code >= 300) throw new Error(`GitHub ${r.code} em ${path}: ${(r.json && r.json.message) || ''}`);
  return 'ok';
}

/** Rode uma vez: gera e grava o ROTINA_SEGREDO e mostra no registro para você copiar para o ambiente do Claude. */
function gerarSegredo() {
  const s = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('ROTINA_SEGREDO', s);
  Logger.log('ROTINA_SEGREDO = ' + s + '\nCopie para a variável TELAO_SEGREDO do ambiente da rotina no Claude.');
}

/** Teste sem a rotina: regrava o analise.json atual. */
function testarReceptor() {
  const a = gh_('colunas/telacheia/analise.json', 'get');
  if (a.code !== 200) throw new Error('não li o analise.json (GitHub ' + a.code + ')');
  Logger.log('GitHub ok · ' + R.OWNER + '/' + R.REPO + ' · sha ' + a.json.sha);
}
