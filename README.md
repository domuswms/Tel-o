# Telão WeAxis

Página do telão de LED (2560 × 512) em três colunas **autônomas**:

| Coluna | Pasta | Dados | Quem atualiza | Quando |
|---|---|---|---|---|
| 1 · Faturamento e margem (empresa, filial, canal) | `colunas/meta/` | `dados.json`, `metas.json` | Rotina do Claude (Preço Certo, D+1) | todo dia 06h15 |
| 2 · Notícias | `colunas/noticias/` | `dados.json` | Rotina do Claude (pesquisa na web) | todo dia 06h15 |
| 3 · Estoque por filial + mural | `colunas/mural/` | `estoque.json`, `mural.json`, `midia/` | Apps Script (PACs + formulário) | estoque 06h00 · mural a cada 10 min |

Cada coluna é uma página independente com código, fonte e dados próprios. Mudar uma não altera as outras; dá até para abrir uma sozinha (`/colunas/meta/`). O `index.html` da raiz só junta as três, e a ordem fica na lista `COLUNAS`.

## O que o telão mede

Todo slide traz no canto superior direito o **escopo** do número: **Domus** (Itajaí + Londrina somadas), **Itajaí** ou **Londrina**. Cores fixas em todo o telão: Itajaí lima, Londrina azul-claro.

**Faturamento e margem** (coluna 1 · Preço Certo, D+1). Filiais = empresas do Preço Certo: Itajaí (31540) e Londrina (31639). Margem = margem de contribuição do Preço Certo.
1. Realizado no mês da Domus × meta, com margem e o acumulado diário.
2. Filiais no mês: receita, % da empresa e margem de cada uma.
3. Ontem: empresa e cada filial.
4. Canais no mês · Domus: os cinco marketplaces (Shopee, Mercado Livre, Amazon, Magalu, TikTok Shop), sempre todos, com barra empilhada Itajaí + Londrina, receita e margem.
5. Canais no mês · Itajaí e 6. Canais no mês · Londrina: mesma tabela por filial.
7. Um slide de foco por canal: receita e margem da Domus no canal, e de cada filial.
- Agrupamento dos canais do Preço Certo (em `automacao/atualizar_meta.py`): Mercado Livre = "Mercado Livre" + "Mercado Livre Fulfillment - SC" (Meli Full SC) + "Mercado Livre Fulfillment" + "ML_DOMUS UTILIDADES"; Amazon = "Amazon" + "Amazon FBA Onsite"; "Sem canal vinculado" vai para Outros (só no e-mail).

**Estoque** (coluna 3 · PACs): Itajaí = PAC SC, aba Gustavo (estoque inteiro da filial); Londrina = PAC PR, aba COMPRAS. Para cada filial e para a Domus (total):
- Quantidade: valor a custo, unidades e dias de cobertura (valor ÷ venda média diária a custo).
- Qualidade: saudável, em excesso (acima do Emax da PAC) e parado (com estoque e sem venda), em barra.
- Ruptura: % dos SKUs com venda sem estoque, venda perdida por dia a custo, curvas AA e A sem estoque e SKUs em ruptura sem OC.

A meta do mês é da empresa toda e fica em `colunas/meta/metas.json`. Edite ali (pelo próprio GitHub) e tire `"exemplo": true` quando for a meta oficial.

E-mail das 07h30 (notícias + faturamento por canal × filial + estoque por filial) sai do Apps Script, pela conta Google da empresa de quem instalou o script.

---

## Passo a passo de instalação

### 1. GitHub (organização)

1. Na organização, **New repository** → nome `telao-weaxis` → **Private** → Create.
2. **Add file → Upload files** → arraste todo o conteúdo desta pasta → Commit.
3. Crie dois tokens (um para o Apps Script, outro para a rotina do Claude), para poder revogar cada um sozinho:
   *Seu perfil → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token*
   - Resource owner: **a organização**
   - Repository access: **Only select repositories → telao-weaxis**
   - Permissions → Repository → **Contents: Read and write**
   - Expiração: 1 ano (anote a data para renovar)
   - Se a organização exigir aprovação de tokens, um owner aprova em *Org → Settings → Personal access tokens → Pending requests*.

### 2. Cloudflare Pages (hospedagem)

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create → Pages → Connect to Git**.
2. Autorize o app do Cloudflare na **organização** do GitHub e escolha `telao-weaxis`.
3. Build settings: Framework preset **None** · Build command **vazio** · Build output directory **`/`** → **Save and Deploy**.
   Fica no ar em `telao-weaxis.pages.dev`. Cada commit publica sozinho em cerca de 1 minuto.
4. **Domínio próprio**: projeto → **Custom domains → Set up a custom domain** → `telao.domuscommerce.com`.
   - Se o DNS do domuscommerce.com já está no Cloudflare, ele cria o registro sozinho.
   - Se não está, crie no provedor de DNS atual um **CNAME** `telao` → `telao-weaxis.pages.dev`.

### 3. Cloudflare Access (login e um usuário para cada pessoa)

1. No painel, abra **Zero Trust** → escolha o nome da equipe (ex.: `domuscommerce`) → plano **Free** (até 50 usuários; pode pedir um cartão, sem cobrança).
2. **Settings → Authentication → Login methods**: deixe **One-time PIN** ativo (a pessoa digita o e-mail e recebe um código). Se a empresa usa Google Workspace ou Microsoft 365, adicione também como login.
3. **Access → Access Groups → Add a group** → nome `Equipe telão` → Include → **Emails** → um e-mail por pessoa. **Este é o cadastro de usuários**: para incluir ou tirar alguém, edite só este grupo.
4. **Access → Applications → Add an application → Self-hosted**:
   - Nome `Telão` · Session duration **1 month**
   - Public hostname 1: `telao.domuscommerce.com`
   - Public hostname 2: `telao-weaxis.pages.dev` (senão o endereço `.pages.dev` fica aberto)
5. Políticas da aplicação, nesta ordem:
   - `Telão do escritório` · Action **Bypass** · Include **IP ranges** = IP público do escritório (no computador do telão, procure "qual é meu IP"). Assim o telão nunca pede login.
   - `Equipe` · Action **Allow** · Include **Access groups → Equipe telão**.
   - Sem IP fixo no escritório? Pule o Bypass, cadastre um e-mail próprio do telão (ex.: `telao@domuscommerce.com`) no grupo e faça login uma vez por mês no computador do telão.
6. Proteja também as prévias: Pages → projeto → **Settings → General → Access policy → Enable**.
7. Teste numa janela anônima: deve pedir e-mail e código.
8. Para derrubar o acesso de alguém na hora: **My Team → Users → (pessoa) → Revoke sessions**, e tire do grupo.

### 4. Apps Script (ruptura, mural e e-mail)

Com a conta da empresa que **tem acesso às duas PACs** (SC e PR):

1. [script.google.com](https://script.google.com) → **Novo projeto** → nome `Telão WeAxis` → cole `automacao/apps-script/Codigo.gs`.
2. No topo do código, preencha `GITHUB_OWNER` (nome da organização) e a lista `EMAILS`.
3. **Configurações do projeto (engrenagem) → Propriedades do script → Adicionar**: `GITHUB_TOKEN` = token do passo 1.3.
4. Selecione a função **configurarTudo** → **Executar** → autorize. O log mostra o link do formulário e da planilha de respostas.
5. Abra o formulário criado → **Adicionar pergunta → Upload de arquivo** → título `Mídia (opcional)` → tipos: vídeo e imagem, até 1 arquivo, 100 MB. (O Apps Script não cria esse tipo de pergunta sozinho.)
6. Envie o link do formulário aos analistas. Para moderar antes de ir ao ar, mude `APROVACAO_AUTOMATICA` para `false` e escreva `sim` na coluna **Aprovado** da planilha.
7. Teste: rode **atualizarRuptura**, **publicarMural** e **enviarEmailDiario** uma vez cada.

### 4.0 Newsletter Radar Domus (radar@domuscommerce.com)
1. Instale o Apps Script **logado em radar@domuscommerce.com** (o e-mail sai da conta que roda o script). Compartilhe as duas PACs com essa conta (leitura basta).
2. No editor: engrenagem → marque **Mostrar o arquivo appsscript.json** → cole `automacao/apps-script/appsscript.json` (liga a People API e define a página de inscrição só para o domínio).
3. **Implantar → Nova implantação → App da Web** (Executar como: eu · Quem pode acessar: qualquer pessoa em domuscommerce.com). Esse link vai no rodapé de todo e-mail como "Gerenciar inscrição".
4. Lista de envio = aba **Assinantes** da planilha do telão. Cada linha: e-mail · Ativo (sim/não) · Conteúdo (`completo` = notícias + faturamento + estoque; `noticias` = notícias + mural).
   - Menu **Telão → Radar: importar toda a organização** inclui todas as contas @domuscommerce.com como `noticias`.
   - **Radar: adicionar / remover pessoas**, ou edite a planilha. Remover marca Ativo = não (histórico fica).
   - Cada pessoa também entra ou sai sozinha pelo link do rodapé (só com a conta dela da Domus).
5. **Radar: enviar teste só para mim** antes de liberar. Depois o envio é automático às 07h30.

### 4.1 Se o Apps Script não funcionar
Rode a função **diagnostico** e abra **Registro de execução**. Cada linha diz OK ou ERRO com o motivo. Os erros mais comuns:
- **Sem acesso à PAC**: o script roda com a conta da empresa; as PACs precisam estar compartilhadas com ela (hoje podem estar só na conta pessoal).
- **"Este app está bloqueado"** na autorização: o administrador do Google Workspace precisa liberar Apps Script para a sua conta (Admin → Segurança → Controles de API).
- **Nenhum gatilho**: rode **configurarTudo** de novo (não duplica nada).

### 5. Rotina diária do Claude (meta e notícias)

Ver `automacao/rotina-diaria.md`. Precisa da variável `GH_TOKEN` (token do passo 1.3) no ambiente da tarefa agendada.

### 6. Computador do telão

- Chrome em modo quiosque, abrindo sozinho no login do Windows:
  `chrome.exe --kiosk --app=https://telao.domuscommerce.com --window-position=0,0 --window-size=2560,512 --disable-session-crashed-bubble`
- Desligar suspensão e protetor de tela. As colunas recarregam sozinhas às 05h30 e se recuperam se travarem.

---

## Formulário dos analistas

| Campo | Regra | No telão |
|---|---|---|
| Seu nome | obrigatório | ao lado do selo |
| Tipo | Meta batida · Ação tomada · Alerta · Comemoração · Aviso | cor do selo e animação |
| Título | até 40 caracteres | linha principal |
| Texto | até 90 caracteres | linha de apoio |
| Número de destaque | opcional, até 14 caracteres | número grande com contagem |
| Legenda do número | opcional, até 30 caracteres | abaixo do número |
| Mídia | opcional: MP4 horizontal até 20 s, sem som, ou imagem | ocupa a coluna inteira |
| Fica no ar até | data | some sozinho depois |

Animação por tipo (todas saem das elipses do símbolo): **Meta batida** disco lima cresce no canto · **Ação tomada** a elipse vertical, "o próximo passo", atravessa a coluna · **Alerta** anel vermelho pulsando · **Comemoração** as três elipses entram girando · **Aviso** só a revelação do texto.

Medida ideal de vídeo para a coluna: **852 × 512 px** (ou 1704 × 1024).
