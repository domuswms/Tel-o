# Rotina diária do telão (tarefa agendada do Claude)

Roda todo dia às 06h15 (horário de Brasília), sem intervenção. Atualiza a coluna 1 (meta), a coluna 2 (notícias) e a **Análise do dia** (gráficos em tela cheia) com git push direto no `domuswms/Tel-o`. O Cloudflare Pages publica sozinho em ~1 minuto. A coluna 3 (estoque e mural), a Análise Gold, as metas e o e-mail das 07h30 são do Apps Script (`Codigo.gs`), que grava os próprios arquivos no mesmo repositório.

## Requisitos

- Conector Preço Certo habilitado na conta que roda a tarefa.
- Escrita da tarefa no `domuswms/Tel-o`: Claude GitHub App instalado na organização com acesso ao Tel-o e o repositório vinculado à tarefa. O commit sai com o autor da sessão (o prompt não troca o autor).

## Prompt da tarefa (copiado na tarefa agendada)

```
Você mantém o telão WeAxis. Responda e escreva em português do Brasil. Trabalhe sem pedir confirmação.

1. PREPARAR
   git clone https://github.com/domuswms/Tel-o.git telao && cd telao
   (se o clone pedir credencial e existir $GH_TOKEN no ambiente, use https://x-access-token:$GH_TOKEN@github.com/domuswms/Tel-o.git)
   Não altere git config user.name nem user.email: o commit sai com o autor da sessão.
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
   - Pesquise na web notícias das últimas 48 h que afetem sellers de marketplaces no Brasil: comissões e tarifas (prioridade máxima), políticas e regulação, tributário, logística, ads, campanhas sazonais, movimentos de mercado e eventos do setor. Plataformas: Mercado Livre, Shopee, TikTok Shop, Amazon, Magalu (e Americanas, Shein e Correios quando afetarem sellers).
   - BASE DE PESQUISA AMPLA: faça pelo menos 8 buscas, nunca só uma. Uma por plataforma (ML, Shopee, TikTok Shop, Amazon, Magalu) e uma por tema (tributário/reforma tributária e importados, logística e frete/Correios, Black Friday e campanhas, regulação como Anvisa e Procon, ads). Leia o resultado de cada busca e abra (WebFetch) a matéria de cada candidato.
   - Fontes, por ordem de confiança:
     1) Oficial: comunicados e Central do Vendedor das plataformas (Mercado Livre, Shopee, TikTok Shop, Amazon, Magalu), RI, órgãos públicos (Anvisa, Receita, gov.br, Correios).
     2) Imprensa de negócios: Valor, Exame, InfoMoney, Estadão, Folha, NeoFeed, Brazil Journal, Forbes Brasil, Money Times, PEGN.
     3) Imprensa do setor: E-Commerce Brasil, Mercado&Consumo, Central do Varejo, Mundo Logística, Transporte Moderno, DGABC e jornais regionais (para inaugurações).
     4) Analistas de mercado (Itaú BBA, XP, BTG) valem quando citados por veículo do grupo 2.
   - ASSERTIVIDADE (regras que não se quebram):
     - Todo item precisa de uma "url" aberta e lida por você. Se não abriu a matéria (403, erro), não usa o item, ou troca por outra fonte que confirme.
     - Confira número, data e plataforma na própria matéria. Pegue a data de publicação da matéria e confirme o ano: matéria de 2024 ou 2025 que a busca devolve como recente é descartada.
     - Comissão, tarifa e prazo (prioridade máxima): só entra com 2 fontes que concordam, sendo uma oficial ou de imprensa de negócios. Com uma fonte só, entra apenas se for o comunicado oficial.
     - Blogs de calculadora, consultorias, SEO e agregadores servem para achar a pista, não como fonte. Ache a matéria original.
     - Notícia com mais de 48 h só entra se ainda vale hoje (vigência que começou agora, prazo em curso, campanha futura). Informe a data real em "data_fonte", sem maquiar.
     - Projeção ou estimativa de analista vai com o nome de quem projetou. Rumor e "segundo fontes" sem veículo confiável ficam fora.
     - Não invente URL. Se não achou fonte para um tema, deixe o tema de fora.
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
   - "mais_links": de 3 a 6 leituras que passaram nas mesmas regras de assertividade e não entraram nos itens.

4. ANÁLISE DO DIA · GRÁFICOS EM TELA CHEIA (liberdade criativa)
   Você é o analista da Domus hoje. Olhe os dados, encontre as 3 a 6 histórias mais úteis para a equipe e escolha o gráfico certo para cada uma. Varie de um dia para o outro: não repita a mesma cena se o dado não mudou.
   Fontes:
   - Faturamento e margem: colunas/meta/dados.json (gerado no passo 2) e, se precisar, mais chamadas ao Preço Certo:
     sales_summary por month (últimos 6 meses), por day, por channel, por filial; products_summary para produtos que puxaram ou derrubaram o mês.
   - Análise Gold da PAC (gerada pelo Apps Script às 06h): colunas/telacheia/dados.json (escopos itajai, londrina, domus com
     ruptura_pct, mvd_perdida, dio, dpo, dso, ccc, nwc, estoque, excesso, sem_giro, curvas (com estoque, congelado e dio por curva),
     top_ruptura, congelados, campeoes, azaroes e o Gold+: pct_congelado, pct_excesso, cobertura_faixas, lento_valor, lentos,
     vai_romper, vai_romper_skus, vai_romper_giro, oc_valor, oc_acima_emax, nivel_servico, concentracao_top20, ruptura_aa_a)
     e colunas/mural/estoque.json. Se a data da PAC for mais velha que 3 dias, diga isso no subtitulo.
   Pelo menos metade das cenas do dia é de estoque (ruptura, congelado, lento, excesso, cobertura, caixa). Temas da semana:
   - Faturamento: ritmo × Meta 1, Meta 2 e Meta 3 (em metas.json: meta, super, mega), mês a mês, dia a dia, canal, filial, margem por canal.
   - Ruptura: % da demanda perdida por filial e curva, R$/dia perdido, quem mais pesa (AA/A primeiro), rupturas sem OC.
   - Congelamento: estoque sem giro, lento (cobertura > 120 d) e excesso acima do Emax, em R$ e % do estoque, por filial; maiores itens parados;
     cobertura_faixas em colunas; OCs que vão chegar acima do Emax.
   - Reposição: vai_romper (acaba antes do lead time e sem OC), nível de serviço por filial, AA/A sem estoque (ruptura_aa_a).
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

5. ENTREGAR (git push direto)
   - Rode python3 automacao/tem_pedido.py --feito
   - git add colunas/meta/dados.json colunas/meta/metas.json colunas/noticias/dados.json colunas/telacheia/analise.json automacao/ultima_execucao.json
   - Se houver mudança: git commit -m "rotina: meta <ontem> + notícias + análise <hoje>" e git push origin main.
   - Se o push for recusado porque o remoto andou (o Apps Script grava estoque e mural no mesmo repositório): git pull --rebase origin main e git push de novo.
   - Se o push falhar por permissão, não tente outros caminhos: diga o erro exato no resumo.

6. Termine com um resumo de 4 linhas: faturamento do mês e % da meta (total, Itajaí, Londrina); quantas notícias; quais cenas de análise você escolheu e por quê (uma linha); e qualquer falha.

```

## Atualização forçada (pedido manual)

Qualquer pessoa da planilha "Telão WeAxis · metas e mural" usa o menu **Telão → Pedir notícias e análises novas**. Isso grava `automacao/pedido.json` no repositório.

Uma segunda tarefa agendada (de hora em hora, 08h às 19h) clona o repositório, roda `python3 automacao/tem_pedido.py` e, se houver pedido, executa os passos 2 a 6.

Também dá para forçar direto pelo app do Claude: **Tarefas agendadas → Rotina do telão → Executar agora**.
