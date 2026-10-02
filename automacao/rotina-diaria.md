# Rotina diária do telão (tarefa agendada do Claude)

Roda todo dia às 06h15 (horário de Brasília), sem intervenção. Atualiza as colunas 1 (meta) e 2 (notícias) no GitHub; o Cloudflare Pages publica sozinho em ~1 minuto. A coluna 3 (estoque por filial e mural) e o e-mail das 07h30 são do Apps Script, não desta rotina.

## Prompt da tarefa (copiado na tarefa agendada)

```
Você mantém o telão WeAxis. Responda e escreva em português do Brasil. Trabalhe sem pedir confirmação.

1. Clone o repositório: git clone https://x-access-token:$GH_TOKEN@github.com/<ORG>/telao-weaxis.git && cd telao-weaxis
   Configure: git config user.name "Rotina do telão"; git config user.email "telao@domuscommerce.com"

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
   - Escolha de 5 a 8 itens. Escreva colunas/noticias/dados.json no formato abaixo (o mesmo do Jornal da Bomus), mantendo "_info":
     {"data": "<hoje AAAA-MM-DD>", "atualizado_em": "<ISO>", "itens": [
       {"categoria": "comissao|politica|tributario|logistica|ads|campanha|evento|movimento",
        "plataforma": "mercadolivre|shopee|tiktokshop|amazon|magalu|geral",
        "manchete": "<= 62 caracteres", "detalhe": "<= 62 caracteres (vai no e-mail)",
        "numero": "curto: 10%, R$ 100 mi, 28/10", "legenda": "<= 24 caracteres",
        "fonte": "Nome da fonte", "data_fonte": "DD/MM", "url": "https://..."}]}
   - Regras de texto: português correto, sem travessão como enfeite, sem ponto final na manchete, tom competente e direto.
   - Se a pesquisa falhar, mantenha o arquivo do dia anterior.

4. Valide os dois JSON (python3 -m json.tool). Rode python3 automacao/tem_pedido.py --feito. Faça commit só do que mudou ("rotina: meta <ontem> + notícias <hoje>") e git push.

5. Termine com um resumo de 3 linhas: faturamento do mês e % da meta (total, Itajaí e Londrina), quantas notícias publicadas, e qualquer falha.
```

## Requisitos do ambiente

- Conector Preço Certo habilitado na conta (já está).
- Variável de ambiente `GH_TOKEN` no ambiente da tarefa: token *fine-grained* do GitHub com acesso só ao repositório `telao-weaxis`, permissão **Contents: Read and write**.

## Atualização forçada (pedido manual)

Qualquer pessoa da planilha "Telão WeAxis · metas e mural" usa o menu **Telão → Pedir notícias e análises novas**. Isso grava `automacao/pedido.json` no repositório.

Uma segunda tarefa agendada roda **de hora em hora, das 08h às 19h** e é barata quando não há pedido:

```
Clone o repositório (mesmo comando da rotina diária). Rode: python3 automacao/tem_pedido.py
Se a saída for "sem pedido novo", pare aqui sem fazer mais nada.
Se houver pedido, execute exatamente a "Rotina diária do telão" (passos 2 a 5 de automacao/rotina-diaria.md), com uma diferença: nas notícias, priorize o que saiu desde a última execução.
```

Também dá para forçar direto pelo app do Claude: **Tarefas agendadas → Rotina do telão → Executar agora**, ou pedindo "atualiza o telão agora" numa conversa.

Estoque, mural e metas (Google) não dependem disso: o menu **Telão → Atualizar tudo agora** roda na hora.
