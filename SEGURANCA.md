# Segurança do telão

Os dados do telão (faturamento, margem, estoque) são sensíveis. Estas são as camadas, da mais importante para a menos.

## 1. Ninguém chega na página sem passar pelo Cloudflare Access
- O site não tem tela de login própria: quem pede a identidade é o Cloudflare Access, **antes** de qualquer arquivo ser entregue (HTML e os `.json` de dados). Não existe senha nossa para quebrar por força bruta.
- Login: **Google Workspace da empresa (SSO com verificação em 2 etapas obrigatória)**. Desligar o One-time PIN depois que o SSO estiver ativo.
- Política `Equipe`: só e-mails `@domuscommerce.com` **e** que estejam no grupo `Equipe telão` (as duas condições: *Include* grupo + *Require* domínio).
- Sessão das pessoas: **24 h**. Sessão do computador do telão: Bypass só pelo IP fixo do escritório.
- **Fechar as portas laterais (bypass de login)**:
  - Proteger também `telao-weaxis.pages.dev` e `*.telao-weaxis.pages.dev` (prévias de cada commit) na mesma aplicação do Access.
  - Pages → Settings → **Access policy para prévias: ligado**.
  - No GitHub, **GitHub Pages desligado** no repositório (senão vira um segundo endereço sem proteção).
- Cabeçalhos de segurança (`_headers`): sem indexação em buscadores, sem incorporar o telão em outro site (frame-ancestors), sem referer para fora, HSTS e CSP que só aceita arquivos do próprio site.

## 2. O código pode até vazar; os dados e as chaves não
- Repositório **privado** na organização. Nenhuma senha ou token no código: o token do Apps Script fica em *Propriedades do script*; o da rotina, em variável de ambiente.
- Tokens **fine-grained**, só do repositório `telao-weaxis`, só *Contents: read/write*, com validade de 1 ano. Um token por automação, para revogar um sem derrubar o outro.
- Organização no GitHub: **2FA obrigatório** para todos os membros, **secret scanning + push protection** ligados, branch `main` protegida (ninguém apaga histórico; force-push bloqueado).
- As PACs e a planilha de metas continuam com o compartilhamento atual: só contas da empresa.

## 3. O que entra no telão é filtrado
- Publicações do formulário passam por limpeza de HTML (`esc()`), têm limite de tamanho e só aceitam vídeo/imagem até 25 MB. Com `APROVACAO_AUTOMATICA: false`, nada vai ao ar sem um "sim" na planilha.
- O formulário só aceita respostas de contas da empresa (Configurações → Respostas → *Restringir a usuários da Domus Commerce*).

## 4. Rotina de revisão
- Mensal: Zero Trust → **Logs → Access** (quem entrou, de onde, falhas de login) e conferir o grupo `Equipe telão`.
- Saída de alguém: tirar do grupo + **Revoke sessions**.
- Anual: renovar os dois tokens do GitHub.
- Se um token vazar: revogar no GitHub na hora, gerar outro e trocar na propriedade do script / variável da rotina.
