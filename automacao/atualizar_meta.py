"""Gera colunas/meta/dados.json a partir das respostas do Preço Certo (MCP sales_summary).

Uso (a rotina diária salva as duas respostas do MCP em arquivos e roda):
    python3 automacao/atualizar_meta.py por_dia.json por_canal.json AAAA-MM-DD(referencia = ontem)

por_dia.json   = sales_summary(date_after=<1º dia do mês>, date_before=<ontem>, group_by="day")
por_canal.json = sales_summary(date_after=<ontem>, date_before=<ontem>, group_by="channel")
"""
import json, sys, os, datetime
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dia_f, canal_f, ref = sys.argv[1], sys.argv[2], sys.argv[3]
dias = json.load(open(dia_f))['results']; canais = json.load(open(canal_f))['results']
mes = ref[:7]
metas = json.load(open(os.path.join(RAIZ, 'colunas/meta/metas.json')))
m = metas.get(mes)
if not m: sys.exit(f'Sem meta cadastrada para {mes} em colunas/meta/metas.json')
dias = sorted([d for d in dias if d['group'][:7] == mes and d['group'] <= ref], key=lambda d: d['group'])
if not dias or dias[-1]['group'] != ref: sys.exit(f'Preço Certo ainda sem dados de {ref} (D+1). Não publiquei.')
o = dias[-1]
out = {
 '_info': "Coluna 1 · Meta e faturamento. Gerado pela rotina diária a partir do Preço Certo (D+1). A meta vem de metas.json.",
 'atualizado_em': datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-3))).isoformat(timespec='seconds'),
 'referencia': ref, 'mes': mes, 'meta_mes': m['meta'], 'meta_exemplo': bool(m.get('exemplo')),
 'realizado_mes': round(sum(d['revenue'] for d in dias), 2),
 'dias': [{'data': d['group'], 'receita': round(d['revenue'], 2)} for d in dias],
 'ontem': {'data': ref, 'receita': round(o['revenue'], 2), 'pedidos': o['orders_count'], 'ticket': round(o['average_ticket'], 2), 'margem_pct': round(o['margin_percent'], 2)},
 'canais': sorted([{'canal': c['group'], 'receita': round(c['revenue'], 2), 'pedidos': c['orders_count']} for c in canais], key=lambda c: -c['receita']),
}
anterior = os.path.join(RAIZ, 'colunas/meta/dados.json')
if os.path.exists(anterior):
    a = json.load(open(anterior))
    if a.get('mes_anterior'): out['mes_anterior'] = a['mes_anterior']
json.dump(out, open(anterior, 'w'), ensure_ascii=False, indent=1)
print(f"ok · {mes}: R$ {out['realizado_mes']:,.2f} de R$ {m['meta']:,.0f} ({out['realizado_mes']/m['meta']*100:.1f}%)")
