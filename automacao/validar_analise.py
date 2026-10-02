"""Valida colunas/telacheia/analise.json antes de publicar (a rotina roda isto; se falhar, corrige e roda de novo).
    python3 automacao/validar_analise.py colunas/telacheia/analise.json
"""
import json, sys, re
TIPOS = {'linha', 'colunas', 'barras', 'cascata', 'comparacao'}
CORES = {'lima', 'ciano', 'coral', 'laranja', 'lilas', 'cinza', 'branco'}
LIM = {'titulo': 40, 'subtitulo': 38, 'numero': 12, 'insight': 70, 'escopo': 12}
erros = []
a = json.load(open(sys.argv[1]))
cenas = a.get('cenas', [])
if not 2 <= len(cenas) <= 8: erros.append(f'quero de 2 a 8 cenas (veio {len(cenas)})')
for i, c in enumerate(cenas, 1):
    p = f'cena {i} ({c.get("titulo", "?")})'
    if c.get('tipo') not in TIPOS: erros.append(f'{p}: tipo inválido {c.get("tipo")}')
    for k, n in LIM.items():
        if len(str(c.get(k, ''))) > n: erros.append(f'{p}: "{k}" passa de {n} caracteres')
    for k in ('titulo', 'numero', 'insight'):
        if not c.get(k): erros.append(f'{p}: falta "{k}"')
    if c.get('tom') not in ('bem', 'melhoria', 'alerta', 'neutro'): erros.append(f'{p}: tom deve ser bem/melhoria/alerta/neutro')
    t = c.get('tipo')
    itens = c.get('itens', [])
    if t == 'barras' and not 2 <= len(itens) <= 6: erros.append(f'{p}: barras pede 2 a 6 itens')
    if t == 'colunas' and not 2 <= len(itens) <= 14: erros.append(f'{p}: colunas pede 2 a 14 itens')
    if t == 'cascata' and not 2 <= len(itens) <= 6: erros.append(f'{p}: cascata pede 2 a 6 itens')
    for x in itens:
        if not isinstance(x.get('valor'), (int, float)): erros.append(f'{p}: item "{x.get("rotulo")}" sem valor numérico')
        if len(str(x.get('rotulo', ''))) > 16: erros.append(f'{p}: rótulo "{x.get("rotulo")}" passa de 16 caracteres')
        if x.get('cor') and x['cor'] not in CORES: erros.append(f'{p}: cor {x["cor"]} fora da paleta')
    if t == 'linha':
        ss = c.get('series', [])
        if not 1 <= len(ss) <= 3: erros.append(f'{p}: linha pede 1 a 3 séries')
        if any(len(s.get('valores', [])) < 3 for s in ss): erros.append(f'{p}: cada série precisa de 3+ pontos')
    if t == 'comparacao':
        if not 2 <= len(c.get('grupos', [])) <= 3: erros.append(f'{p}: comparação pede 2 ou 3 grupos')
        if not 1 <= len(c.get('metricas', [])) <= 4: erros.append(f'{p}: comparação pede 1 a 4 métricas')
    if re.search(r'\s[—–]\s', json.dumps(c, ensure_ascii=False)): erros.append(f'{p}: sem travessão como enfeite')
if erros: print('ERROS:\n- ' + '\n- '.join(erros)); sys.exit(1)
print(f'ok · {len(cenas)} cenas')
