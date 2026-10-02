"""Gera colunas/meta/dados.json (faturamento por filial e por canal) a partir do Preço Certo.

A rotina diária salva 3 respostas do MCP sales_summary por filial numa pasta e roda:
    python3 automacao/atualizar_meta.py <pasta> <ontem AAAA-MM-DD>

Arquivos esperados na pasta (um trio por filial de FILIAIS):
    <filial>_dia.json          sales_summary(company_id, date_after=<1º do mês>, date_before=<ontem>, group_by="day")
    <filial>_canal_mes.json    sales_summary(company_id, date_after=<1º do mês>, date_before=<ontem>, group_by="channel")
    <filial>_canal_ontem.json  sales_summary(company_id, date_after=<ontem>,     date_before=<ontem>, group_by="channel")
"""
import json, sys, os, datetime

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# filiais = empresas do Preço Certo (list_companies)
FILIAIS = {
    'itajai':   {'nome': 'Itajaí',   'company_id': 31540},
    'londrina': {'nome': 'Londrina', 'company_id': 31639},
}

# canais do Preço Certo agrupados por marketplace (o que não casar vai para "Outros")
GRUPOS = [
    ('Mercado Livre', ('mercado livre', 'ml_', 'ml ')),
    ('Shopee',        ('shopee',)),
    ('Magalu',        ('magalu', 'magazine')),
    ('Amazon',        ('amazon',)),
    ('TikTok Shop',   ('tiktok',)),
]

def grupo(canal):
    c = canal.lower()
    for nome, chaves in GRUPOS:
        if any(c.startswith(k) or k in c for k in chaves): return nome
    return 'Outros'

def canais(por_filial):
    """{filial: results} -> [{canal, itajai, londrina, total, pedidos}] ordenado pelo total."""
    """Todos os marketplaces aparecem sempre (mesmo zerados). Para cada canal: receita e margem por filial e no total."""
    zero = lambda: {'receita': 0.0, 'margem': 0.0, 'pedidos': 0}
    acc = {g: {'canal': g, **{k: zero() for k in FILIAIS}, 'total': zero()} for g, _ in GRUPOS}
    for f, res in por_filial.items():
        for r in res:
            g = grupo(r['group'])
            a = acc.setdefault(g, {'canal': g, **{k: zero() for k in FILIAIS}, 'total': zero()})
            for alvo in (a[f], a['total']):
                alvo['receita'] += r['revenue']; alvo['margem'] += r.get('margin', 0) or 0; alvo['pedidos'] += r['orders_count']
    out = sorted(acc.values(), key=lambda a: (a['canal'] == 'Outros', -a['total']['receita']))
    for a in out:
        for k in list(FILIAIS) + ['total']:
            v = a[k]; v['receita'] = round(v['receita'], 2); v['margem'] = round(v['margem'], 2)
            v['margem_pct'] = round(v['margem'] / v['receita'] * 100, 2) if v['receita'] else None
    if acc.get('Outros') and not acc['Outros']['total']['receita']: out = [a for a in out if a['canal'] != 'Outros']
    return out

def main(pasta, ref):
    mes = ref[:7]
    metas = json.load(open(os.path.join(RAIZ, 'colunas/meta/metas.json')))
    m = metas.get(mes)
    if not m: sys.exit(f'Sem meta cadastrada para {mes} em colunas/meta/metas.json')
    ler = lambda f, t: json.load(open(os.path.join(pasta, f'{f}_{t}.json')))['results']

    dias, fil, cm, co = {}, {}, {}, {}
    for f in FILIAIS:
        d = [x for x in ler(f, 'dia') if x['group'][:7] == mes and x['group'] <= ref]
        for x in d:
            dd = dias.setdefault(x['group'], {'data': x['group'], **{k: 0.0 for k in FILIAIS}, 'receita': 0.0, 'pedidos': 0})
            dd[f] += x['revenue']; dd['receita'] += x['revenue']; dd['pedidos'] += x['orders_count']
        o = next((x for x in d if x['group'] == ref), None)
        rm = sum(x['revenue'] for x in d); mg = sum(x.get('margin', 0) or 0 for x in d)
        fil[f] = {'nome': FILIAIS[f]['nome'],
                  'realizado_mes': round(rm, 2), 'margem_mes': round(mg, 2), 'margem_pct_mes': round(mg / rm * 100, 2) if rm else None,
                  'ontem': {'receita': round(o['revenue'], 2) if o else 0, 'pedidos': o['orders_count'] if o else 0,
                            'ticket': round(o['average_ticket'], 2) if o else 0, 'margem_pct': round(o['margin_percent'], 2) if o else 0}}
        cm[f] = ler(f, 'canal_mes'); co[f] = ler(f, 'canal_ontem')

    if ref not in dias: sys.exit(f'Preço Certo ainda sem dados de {ref} (D+1). Não publiquei.')
    dias = [dict(v, **{k: round(v[k], 2) for k in list(FILIAIS) + ['receita']}) for _, v in sorted(dias.items())]
    o = dias[-1]
    tot_ped = o['pedidos']
    out = {
        '_info': 'Coluna 1 · Faturamento e margem: empresa (Itajaí + Londrina), por filial e por canal. Gerado pela rotina diária (Preço Certo, D+1). A meta (da empresa) vem de metas.json.',
        'atualizado_em': datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-3))).isoformat(timespec='seconds'),
        'referencia': ref, 'mes': mes, 'meta_mes': m['meta'], 'meta_exemplo': bool(m.get('exemplo')),
        'escopo': 'Domus · ' + ' + '.join(v['nome'] for v in FILIAIS.values()),
        'realizado_mes': round(sum(d['receita'] for d in dias), 2),
        'margem_mes': round(sum(v['margem_mes'] for v in fil.values()), 2),
        'filiais': fil,
        'dias': dias,
        'ontem': {'data': ref, 'receita': o['receita'], 'pedidos': tot_ped,
                  'ticket': round(o['receita'] / tot_ped, 2) if tot_ped else 0},
        'canais_mes': canais(cm),
        'canais_ontem': canais(co),
    }
    # conferência: canais somados = total por dia (Preço Certo agrega pelos mesmos pedidos)
    out['margem_pct_mes'] = round(out['margem_mes'] / out['realizado_mes'] * 100, 2) if out['realizado_mes'] else None
    soma_c = sum(c['total']['receita'] for c in out['canais_ontem'])
    if abs(soma_c - o['receita']) > 1: print(f'AVISO: canais de ontem somam {soma_c:.2f}, total do dia é {o["receita"]:.2f}')
    arq = os.path.join(RAIZ, 'colunas/meta/dados.json')
    if os.path.exists(arq):
        a = json.load(open(arq))
        if a.get('mes_anterior'): out['mes_anterior'] = a['mes_anterior']
    json.dump(out, open(arq, 'w'), ensure_ascii=False, indent=1)
    print(f"ok · {mes}: R$ {out['realizado_mes']:,.2f} de R$ {m['meta']:,.0f} ({out['realizado_mes'] / m['meta'] * 100:.1f}%) · "
          + ' · '.join(f"{v['nome']} R$ {v['realizado_mes']:,.2f}" for v in fil.values()))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
