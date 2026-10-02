"""Entrega os JSON do dia ao telão sem git push: POST para o Receptor (Apps Script), que grava no GitHub.

    python3 automacao/entregar.py colunas/meta/dados.json colunas/noticias/dados.json colunas/telacheia/analise.json

Variáveis de ambiente (configuradas no ambiente da rotina, nunca no código nem no prompt):
    TELAO_RECEPTOR_URL   URL /exec da implantação do Receptor
    TELAO_SEGREDO        o mesmo ROTINA_SEGREDO das propriedades do Receptor
Sai com código 0 se gravou, 2 se faltou configuração, 1 se o receptor recusou ou a rede bloqueou.
"""
import json, os, sys, urllib.request, urllib.error

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def main(caminhos):
    url, seg = os.environ.get('TELAO_RECEPTOR_URL'), os.environ.get('TELAO_SEGREDO')
    if not url or not seg:
        print('Receptor não configurado (faltam TELAO_RECEPTOR_URL / TELAO_SEGREDO).'); return 2
    arquivos = {}
    for p in caminhos:
        with open(os.path.join(RAIZ, p), encoding='utf-8') as f: arquivos[p] = f.read()
        json.loads(arquivos[p])
    corpo = json.dumps({'segredo': seg, 'mensagem': 'Rotina diária · telão', 'arquivos': arquivos}).encode()
    req = urllib.request.Request(url, data=corpo, headers={'Content-Type': 'application/json'}, method='POST')
    try:
        # o Apps Script executa o doPost e responde com um 302; o urllib segue como GET e lê a resposta
        with urllib.request.urlopen(req, timeout=90) as r: txt = r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        print(f'Receptor respondeu HTTP {e.code}.'); return 1
    except Exception as e:
        print(f'Rede bloqueou o receptor: {e}. Peça ao admin para liberar script.google.com e script.googleusercontent.com.'); return 1
    try: j = json.loads(txt)
    except ValueError: print('Resposta inesperada do receptor (a implantação está como "Qualquer pessoa"?).'); return 1
    if not j.get('ok'): print('Receptor recusou: ' + str(j.get('erro'))); return 1
    print('ok · ' + ' · '.join(f'{k}: {v}' for k, v in j['arquivos'].items())); return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
