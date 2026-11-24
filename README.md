# HL GARAGEM — site, agendamento e painel do administrador

Site de estética automotiva com agendamento online que salva em banco de dados, painel só seu (visitas, agendamentos, clientes, serviços e preços) e backups.

Não precisa instalar nada além do Node.js 22.13 ou mais novo. Não há pacotes externos para baixar.

## O que já funciona

| Parte | O que faz |
|---|---|
| Site público (`/`) | Visual preto/grafite com laranja, 8 serviços com comparação antes/depois, agendamento em 4 passos, WhatsApp, contato, política de privacidade |
| Agendamento | Escolhe serviço, veículo, dia e horário. Horário ocupado não aparece e o servidor recusa se alguém tentar o mesmo horário ao mesmo tempo |
| Painel (`/admin`) | Login com senha. Visão geral com **quantas pessoas acessaram o link**, leads, agendamentos, clientes, serviços (preço, duração, fotos, ativar/desativar), mensagens, depoimentos, horários, backups e registro de atividades |
| Preços | Em Serviços você muda o valor e o site público já mostra o novo |
| WhatsApp | Botão flutuante, botão de confirmar no fim do agendamento e, no painel, mensagem pronta com os dados de cada cliente |

## Rodar no seu computador (teste)

1. Instale o Node.js (nodejs.org, versão LTS recente).
2. Abra a pasta do projeto no terminal e rode:
   ```
   npm start
   ```
3. Na primeira vez o terminal mostra o usuário e uma **senha gerada**. Anote.
4. Abra `http://localhost:3000` (site) e `http://localhost:3000/admin` (painel).

Para escolher a senha inicial, copie `.env.example` para `.env`, preencha `ADMIN_PASSWORD` (mínimo 10 caracteres) e apague a pasta `data` antes de iniciar. Depois que o painel existe, troque a senha em Configurações.

## Colocar no ar (o que falta ser feito por você)

O site precisa de um servidor que fique ligado e de um **disco que não apague** (o banco de dados e as fotos ficam na pasta `data`). Hospedagem comum só de arquivos (como GitHub Pages) não serve.

1. **Hospedagem.** Escolha um serviço que rode Node.js com disco persistente, por exemplo Railway, Render ou Fly.io (confira se o plano escolhido inclui disco persistente). Em qualquer um:
   - Comando de início: `npm start`
   - Variáveis de ambiente: copie as de `.env.example`. Use `NODE_ENV=production` e `TRUST_PROXY=1`.
   - `DATA_DIR`: caminho do disco persistente (por exemplo `/var/data`).
2. **Domínio.** Compre um (registro.br para `.com.br`) e aponte para a hospedagem. A hospedagem emite o certificado HTTPS sozinha. Com `NODE_ENV=production`, o site já força HTTPS e usa cookies seguros.
3. **Primeiro acesso.** Defina `ADMIN_USER` e `ADMIN_PASSWORD` antes do primeiro início. Depois remova `ADMIN_PASSWORD` das variáveis.
4. **Dados da empresa.** No painel, em Configurações: confira o WhatsApp, o e-mail (ou use a variável `CONTACT_EMAIL`), o endereço, o Instagram e os horários de atendimento.
5. **Preços.** Os valores que vêm no sistema são só ponto de partida. Revise cada um em Serviços antes de divulgar.
6. **Fotos reais.** Em Serviços, envie a foto do antes e a do depois de cada trabalho (JPG, PNG ou WEBP, até 6 MB). Enquanto não houver foto, o site mostra uma ilustração.
7. **Política de privacidade.** O texto em `public/privacidade.html` é um modelo. Peça a um advogado para revisar.
8. **Backups.** O sistema cria um por dia e guarda 14. De vez em quando baixe um em Configurações e guarde em outro lugar (ou use o backup do disco da hospedagem). Teste um backup com `npm run verify-backup -- data/backups/ARQUIVO.db`.
9. **Monitoramento.** Cadastre `https://SEU-SITE/healthz` em um serviço gratuito de monitoramento (UptimeRobot, por exemplo) para receber aviso se o site cair.

## Segurança

- Senha do painel com hash `scrypt` e sal individual. Nunca fica guardada em texto.
- Sessão por cookie `HttpOnly`, `SameSite=Strict` e `Secure` (em produção), que expira em 8 horas. Proteção contra CSRF em toda ação de escrita.
- Limite de tentativas de login (por IP e por usuário) e limite de agendamentos e mensagens por IP.
- Todas as consultas ao banco usam parâmetros (sem SQL Injection). Todo texto de cliente é mostrado como texto (sem XSS) e há política de segurança de conteúdo (CSP) restritiva.
- Validação no navegador e no servidor. Envio de fotos só aceita imagens reais, verificadas pelo conteúdo do arquivo.
- Contagem de visitas sem guardar IP: só um código que muda todo dia. Robôs e suas próprias visitas logado não contam.
- Registro de atividades do administrador (login, mudanças de preço, exclusões, backups).
- LGPD: política de privacidade, consentimento nos formulários, exportação e exclusão de cliente no painel.

## Limites desta versão

- Há um único administrador. Se precisar de mais pessoas com permissões diferentes, dá para adicionar.
- Não há envio automático de e-mail ou WhatsApp pelo servidor: a confirmação sai pelo botão do WhatsApp no painel. Pagamento online, assinaturas e webhooks não foram incluídos porque o negócio é de agendamento de serviços; se quiser cobrar sinal por Pix, isso depende de uma conta em um provedor de pagamento.
- O rastreio de acessos conta pessoas diferentes por dia a partir de IP e navegador. Quem troca de rede ou aparelho conta de novo.

## Testes

```
npm test
```

Roda 14 testes automáticos do servidor: agendamento, horário ocupado, validações, tentativa de SQL Injection, login e proteção CSRF, troca de preço refletindo no site, contagem de acessos, fluxo de confirmar/concluir, upload de fotos (inclusive a foto principal), capacidade, backup, limite de login e arquivos protegidos.

## Estrutura

```
server.js          servidor, API, banco (SQLite), segurança
public/            site (index.html), painel (admin.html), estilos e scripts
scripts/           backup e verificação de backup
tests/             testes automáticos
data/              criada sozinha: banco, fotos enviadas e backups (não envie para o GitHub)
```
