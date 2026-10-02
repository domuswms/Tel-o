# Rotina diária do telão (tarefa agendada do Claude)

Roda todo dia às 06h15 (horário de Brasília), sem intervenção. Atualiza a coluna 1 (meta), a coluna 2 (notícias) e a **Análise do dia** (gráficos em tela cheia). O Cloudflare Pages publica sozinho em ~1 minuto. A coluna 3 (estoque e mural), a Análise Gold e o e-mail das 07h30 são do Apps Script.

## Como os dados chegam ao GitHub (sem git push)

A sessão do Claude na nuvem não consegue dar `git push` no `domuswms/Tel-o` (o proxy só libera repositórios vinculados à sessão). Por isso a rotina entrega por um **Receptor**: um Apps Script pequeno e separado (`automacao/apps-script/receptor/`) que recebe os JSON por HTTPS, confere um segredo e grava no GitHub com o token que já fica guardado no Google. O mesmo Receptor devolve os scripts e dados de entrada (`acao: "ler"`), então a rotina funciona com o repositório **privado**.

Requisitos (uma vez):

1. **Admin da organização no Claude**: Configurações de administrador → Capacidades → acesso à rede: liberar `script.google.com` e `script.googleusercontent.com`.
2. **Receptor**: novo projeto em script.google.com ("Telão · Receptor"), colar `Receptor.gs` e `appsscript.json` (mostrar manifesto em Configurações do projeto). Propriedade `GITHUB_TOKEN` (mesmo tipo de token do Codigo.gs). Rodar `gerarSegredo` e `testarReceptor`. Implantar → App da Web, executar como **Eu**, acesso **Qualquer pessoa**. Copiar a URL `/exec`.
3. **Ambiente da tarefa no Claude**: variáveis `TELAO_RECEPTOR_URL` (a URL /exec) e `TELAO_SEGREDO` (o valor do registro do `gerarSegredo`). Nunca no prompt nem no código.

## Prompt da tarefa (copiado na tarefa agendada)

```
Você mantém o telão WeAxis. Responda e escreva em português do Brasil. Trabalhe sem pedir confirmação.

1. PREPARAR
   Se TELAO_RECEPTOR_URL e TELAO_SEGREDO existem no ambiente, baixe os arquivos pelo Receptor:
   crie /tmp/baixar.py com as linhas abaixo (tire os 5 espaços da margem esquerda) e rode: mkdir -p telao && cd telao && python3 /tmp/baixar.py
     import json,os,urllib.request
     u,s=os.environ['TELAO_RECEPTOR_URL'],os.environ['TELAO_SEGREDO']
     q=urllib.request.Request(u,data=json.dumps({'segredo':s,'acao':'ler'}).encode(),headers={'Content-Type':'application/json'})
     r=json.load(urllib.request.urlopen(q,timeout=90)); assert r.get('ok'),r
     for p,t in r['arquivos'].items():
         os.makedirs(os.path.dirname(p),exist_ok=True); open(p,'w',encoding='utf-8').write(t)
     print(len(r['arquivos']),'arquivos')
   Se não existem (ou o Receptor falhar), use: git clone https://x-access-token:$GH_TOKEN@github.com/domuswms/Tel-o.git telao && cd telao
   Trabalhe sempre dentro de telao/.

2. COLUNA 1 · FATURAMENTO (Preço Certo, dado D+1)
   - ontem = data de ontem em America/Sao_Paulo; mes1 = 1º dia do mês de ontem.
   - Para cada filial, chame o MCP Preço Certo sales_summary e salve a resposta JSON inteira em /tmp/pc/:
       itajai   (company_id 31540) e londrina (company_id 31639)
       <filial>_dia.json          group_by="day",     date_after=mes1,  date_before=ontem
       <filial>_canal_mes.json    group_by="channel", date_after=mes1,  date_before=ontem
       <filial>_canal_ontem.json  group_by="channel", date_after=ontem, date_before=ontem
   - Se o mês de ontem não estiver em colunas/meta/metas.json, copie a meta do mês anterior com "exemplo": true e avise no resumo final.
   - Rode: python3 automacao/atualizar_meta.py /tmp/pc <ontem>
   - Se o script disser que ainda não há dados de ontem, espere 20 minutos e tente de novo (até 3 vezes). Depois disso, mantenha o arquivo antigo.
   - Na virada do mês (dia 1), grave "mes_anterior": {"mes": <AAAA-MM>, "receita": <total do mês fechado>} em colunas/meta/dados.json.

3. COLUNA 2 · NOTÍCIAS (Radar marketplaces)
   - Pesquise na web notícias das últimas 48 h que afetem sellers de marketplaces no Brasil: comissões e tarifas (prioridade máxima), políticas, tributário, logística, ads, campanhas sazonais, movimentos de mercado e eventos do setor. Plataformas: Mercado Livre, Shopee, TikTok Shop, Amazon, Magalu.
   - Só fontes confiáveis (comunicados oficiais, Valor, Exame, E-Commerce Brasil, Mercado&Consumo, PEGN, etc.). Confira cada número na fonte. Nada de boato.
   - Escolha de 5 a 8 itens. Escreva colunas/noticias/dados.json mantendo "_info":
     {"data": "<hoje AAAA-MM-DD>", "atualizado_em": "<ISO>", "itens": [
       {"categoria": "comissao|politica|tributario|logistica|ads|campanha|evento|movimento",
        "plataforma": "mercadolivre|shopee|tiktokshop|amazon|magalu|geral",
        "manchete": "<= 62 caracteres", "detalhe": "<= 62 caracteres (vai no e-mail)",
        "numero": "curto: 10%, R$ 100 mi, 28/10", "legenda": "<= 24 caracteres",
        "fonte": "Nome da fonte", "data_fonte": "DD/MM", "url": "https://... (link direto da matéria, obrigatório)"}],
       "mais_links": [ {"titulo": "<= 90 caracteres", "fonte": "Nome", "url": "https://..."} ]}
   - Toda "url" abre a matéria original (https). Sem links de busca, agregador ou encurtados.
   - Português correto, sem travessão como enfeite, sem ponto final na manchete, tom competente e direto.
   - Se a pesquisa falhar, mantenha o arquivo do dia anterior.

4. ANÁLISE DO DIA · GRÁFICOS EM TELA CHEIA (liberdade criativa)
   Você é o analista da Domus hoje. Olhe os dados, encontre as 3 a 6 histórias mais úteis para a equipe e escolha o gráfico certo para cada uma. Varie de um dia para o outro: não repita a mesma cena se o dado não mudou.
   Fontes:
   - Faturamento e margem: colunas/meta/dados.json (gerado no passo 2) e, se precisar, mais chamadas ao Preço Certo:
     sales_summary por month (últimos 6 meses), por day, por channel, por filial; products_summary para produtos que puxaram ou derrubaram o mês.
   - Análise Gold da PAC (gerada pelo Apps Script às 06h): colunas/telacheia/dados.json (escopos itajai, londrina, domus com
     ruptura_pct, mvd_perdida, dio, dpo, dso, ccc, nwc, estoque, excesso, sem_giro, curvas, top_ruptura, congelados, campeoes, azaroes)
     e colunas/mural/estoque.json. Se a data da PAC for mais velha que 3 dias, diga isso no subtitulo.
   Temas que devem aparecer ao longo da semana:
   - Faturamento: ritmo × meta/super/mega, mês a mês, dia a dia, canal, filial, margem por canal.
   - Ruptura: % da demanda perdida por filial e curva, R$/dia perdido, quem mais pesa (AA/A primeiro), rupturas sem OC.
   - Congelamento: estoque sem giro e excesso acima do Emax, em R$, por filial; maiores itens parados.
   - Fluxo de caixa: CCC = DIO + DSO − DPO em cascata, NWC (capital empatado), comparação entre filiais.
   Regras de leitura (Análise Gold): dado faltante não é zero; Domus é recálculo das linhas somadas, nunca média; PI verticalizado fica fora.
   Londrina usa base parcial (só Verticalizados): avise no subtitulo quando a cena mostrar Londrina.
   Formato de colunas/telacheia/analise.json:
     {"_info": "...mantenha...", "data": "<hoje>", "atualizado_em": "<ISO>", "cenas": [ <cena>, ... ]}
     Campos de toda cena: tipo, titulo (<=40), subtitulo (<=38), escopo (<=12: Domus, Itajaí, Londrina, Filiais),
       tom (bem|melhoria|alerta|neutro), numero (<=12, o número herói), insight (<=70, a frase que a equipe deve guardar), formato (brl|pct|dias|num|un).
     Tipos:
       colunas    itens [{rotulo<=16, valor, cor?, destaque?}] 2 a 14; referencia? {valor, rotulo}   (meses, dias, canais)
       barras     itens [{rotulo<=16, valor, cor?, extra? (texto à direita), extra_cor?}] 2 a 6          (ranking)
       linha      series [{nome, valores[3+], cor?}] 1 a 3; eixo_x [rótulos]; referencia?               (evolução)
       cascata    itens [{rotulo, valor (+ soma, − subtrai), cor?}] 2 a 6; total; total_rotulo; cor_total? (ponte: CCC, meta × realizado)
       comparacao grupos [2 a 3 nomes]; metricas [{rotulo, valores[], formato, melhor: menor|maior}] 1 a 4  (filial × filial)
     Cores: lima (Itajaí, destaque bom), ciano (Londrina), coral (alerta), laranja, lilas, cinza (contexto), branco.
     Cor segue a entidade: Itajaí sempre lima, Londrina sempre ciano, quando o gráfico for por filial. Coral só para o que é ruim.
     Um gráfico conta uma coisa. Nada de dois eixos. Números conferidos com a fonte, arredondados como no telão (R$ 1,7 mi; 42%; 65,1 dias).
   Rode: python3 automacao/validar_analise.py colunas/telacheia/analise.json e corrija e repita até "ok".
   Se faltar dado para um tema, escolha outro. Se nada der certo, mantenha o arquivo anterior.

5. ENTREGAR
   - Rode python3 automacao/tem_pedido.py --feito
   - Com o Receptor: python3 automacao/entregar.py colunas/meta/dados.json colunas/noticias/dados.json colunas/telacheia/analise.json automacao/ultima_execucao.json
   - Sem o Receptor (ou se ele falhar com erro de rede): git add, commit ("rotina: meta <ontem> + notícias + análise <hoje>") e git push.
   - Se nenhum dos dois funcionar, diga exatamente o erro no resumo.

6. Termine com um resumo de 4 linhas: faturamento do mês e % da meta (total, Itajaí, Londrina); quantas notícias; quais cenas de análise você escolheu e por quê (uma linha); e qualquer falha.
```

## Atualização forçada (pedido manual)

Qualquer pessoa da planilha "Telão WeAxis · metas e mural" usa o menu **Telão → Pedir notícias e análises novas**. Isso grava `automacao/pedido.json` no repositório.

Uma segunda tarefa agendada (de hora em hora, 08h às 19h) faz o passo 1, roda `python3 automacao/tem_pedido.py` e, se houver pedido, executa os passos 2 a 6.

Também dá para forçar direto pelo app do Claude: **Tarefas agendadas → Rotina do telão → Executar agora**.

## Alternativa sem admin: rodar no seu computador

Se a liberação de rede não sair, a tarefa pode rodar no seu computador (app do Claude aberto, pasta do repositório conectada). Aí o push sai pelo git da sua máquina, com a sua credencial do GitHub. Peça "mude a rotina do telão para rodar no meu computador".
