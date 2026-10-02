"""Diz se há pedido manual de atualização ainda não atendido.
Saída 0 = há pedido (rode a rotina); saída 1 = nada a fazer.
    python3 automacao/tem_pedido.py           (verifica)
    python3 automacao/tem_pedido.py --feito   (marca a execução atual como feita)
"""
import json, os, sys, datetime
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P, U = os.path.join(R, 'automacao/pedido.json'), os.path.join(R, 'automacao/ultima_execucao.json')
ler = lambda f: json.load(open(f)) if os.path.exists(f) else {}
agora = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-3))).isoformat(timespec='seconds')
if '--feito' in sys.argv:
    json.dump({'executado_em': agora, 'pedido_atendido': ler(P).get('pedido_em')}, open(U, 'w'), indent=1); print('marcado', agora); sys.exit(0)
pedido, ultima = ler(P).get('pedido_em'), ler(U).get('executado_em', '')
if pedido and pedido > ultima: print(f'pedido de {ler(P).get("por")} em {pedido}'); sys.exit(0)
print('sem pedido novo'); sys.exit(1)
