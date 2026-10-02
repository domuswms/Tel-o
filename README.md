# Telão WeAxis

Página do telão de LED (2560 × 512) em três colunas **autônomas**:

| Coluna | Pasta | Dados | Quem atualiza | Quando |
|---|---|---|---|---|
| 1 · Meta e faturamento | `colunas/meta/` | `dados.json`, `metas.json` | Rotina do Claude (Preço Certo, D+1) | todo dia 06h15 |
| 2 · Notícias | `colunas/noticias/` | `dados.json` | Rotina do Claude (pesquisa na web) | todo dia 06h15 |
| 3 · Ruptura + mural | `colunas/mural/` | `ruptura.json`, `mural.json`, `midia/` | Apps Script (PAC + formulário) | ruptura 06h00 · mural a cada 10 min |

Cada coluna é uma página independente com código, fonte e dados próprios. Mudar uma não altera as outras; dá até para abrir uma sozinha (`/colunas/meta/`). O `index.html` da raiz só junta as três, e a ordem fica na lista `COLUNAS`.

A meta do mês fica em `colunas/meta/metas.json`. Edite ali (pelo próprio GitHub) e tire `"exemplo": true` quando for a meta oficial.

E-mail das 07h30 (notícias + resumo de meta e ruptura) sai do Apps Script, pela conta Google da empresa de quem instalou o script.

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

Com a conta da empresa que **tem acesso à PAC**:

1. [script.google.com](https://script.google.com) → **Novo projeto** → nome `Telão WeAxis` → cole `automacao/apps-script/Codigo.gs`.
2. No topo do código, preencha `GITHUB_OWNER` (nome da organização) e a lista `EMAILS`.
3. **Configurações do projeto (engrenagem) → Propriedades do script → Adicionar**: `GITHUB_TOKEN` = token do passo 1.3.
4. Selecione a função **configurarTudo** → **Executar** → autorize. O log mostra o link do formulário e da planilha de respostas.
5. Abra o formulário criado → **Adicionar pergunta → Upload de arquivo** → título `Mídia (opcional)` → tipos: vídeo e imagem, até 1 arquivo, 100 MB. (O Apps Script não cria esse tipo de pergunta sozinho.)
6. Envie o link do formulário aos analistas. Para moderar antes de ir ao ar, mude `APROVACAO_AUTOMATICA` para `false` e escreva `sim` na coluna **Aprovado** da planilha.
7. Teste: rode **atualizarRuptura**, **publicarMural** e **enviarEmailDiario** uma vez cada.

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
