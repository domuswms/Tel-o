# Rotina diária do telão (rotina "Radar" no Claude Code)

Roda todo dia às 06h15 (Brasília). Atualiza a coluna 1 (faturamento), a coluna 2 (notícias) e a Análise do dia em tela cheia, com git push direto no `domuswms/Tel-o`. Estoque (Análise Gold), mural, metas e e-mail são do Apps Script (`Codigo.gs`).

A lógica completa fica em **`automacao/prompt-radar.md`**: fontes de dados, regras da Análise Gold, Gold+, faturamento, notícias, formato dos gráficos e entrega. Para mudar a rotina, altere esse arquivo e suba no repositório. A rotina usa a versão nova na próxima execução, sem mexer no prompt dela.

## Prompt da rotina (curto)

```
Você mantém o telão WeAxis. Escreva em português do Brasil e trabalhe sem pedir confirmação.
Clone o repositório: git clone https://github.com/domuswms/Tel-o.git telao && cd telao
(se pedir credencial e existir $GH_TOKEN: https://x-access-token:$GH_TOKEN@github.com/domuswms/Tel-o.git)
Leia automacao/prompt-radar.md inteiro e siga exatamente, do passo 2 ao 7.
```

Se preferir, cole o conteúdo de `automacao/prompt-radar.md` inteiro no lugar do prompt curto: ele funciona sozinho.

## Requisitos

- Conector Preço Certo habilitado na conta da rotina.
- Escrita no `domuswms/Tel-o` (Claude GitHub App com acesso ao repositório). O commit sai com o autor da sessão.

## Atualização forçada

Menu **Telão → Pedir notícias e análises novas** na planilha grava `automacao/pedido.json`. Também dá para rodar a rotina na hora pelo botão de executar dela.
