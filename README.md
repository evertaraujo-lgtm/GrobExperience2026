# GROB Experience 2026

Sistema web para gerenciamento de pré-inscritos do **GROB Experience 2026**, confirmação de participação por data e integração com a **WhatsApp Cloud API da Meta**.

O projeto centraliza o fluxo de confirmação dos participantes, permitindo acompanhar o status das mensagens enviadas pelo WhatsApp, respostas recebidas e confirmações realizadas pelo link público ou diretamente pelos botões da mensagem.

---

## Visão geral

O sistema foi criado para resolver o fluxo de participantes que já realizaram uma pré-inscrição no evento, mas ainda precisam selecionar uma das datas disponíveis.

O processo funciona assim:

```text
Pré-inscrito
    │
    ▼
Painel administrativo
    │
    ├── gera link individual de confirmação
    │
    └── envia template pela WhatsApp Cloud API
                     │
                     ▼
               WhatsApp / Meta
                     │
          ┌──────────┴──────────┐
          │                     │
       Status               Resposta
 sent / delivered        botão / mensagem
 read / failed                 │
          │                     │
          └──────────┬──────────┘
                     ▼
              Firebase Webhook
                     │
                     ▼
                 Firestore
                     │
          ┌──────────┴──────────┐
          │                     │
   Monitoramento          Confirmação
                          da inscrição
```

---

# Funcionalidades

## Painel administrativo

O painel permite gerenciar os participantes pré-inscritos e acompanhar o andamento das confirmações.

Entre as funcionalidades atuais:

* visualização dos pré-inscritos;
* importação de participantes;
* acompanhamento do status de confirmação;
* geração de links públicos individuais;
* envio de mensagens pelo WhatsApp;
* acompanhamento de envio, entrega e leitura;
* visualização de falhas retornadas pela Meta;
* monitoramento das mensagens recebidas;
* confirmação automática por botão do WhatsApp.

---

## Confirmação pública

Cada participante pode receber um link individual semelhante a:

```text
https://grobexperience.web.app/confirmar/?token=...
```

O token identifica exclusivamente o convite.

A página pública permite selecionar uma das datas disponíveis:

* 22 de setembro de 2026
* 23 de setembro de 2026
* 24 de setembro de 2026

Após a escolha, o sistema atualiza simultaneamente:

```text
linksPublicos/{token}
preInscritos/{whatsapp}
```

evitando inconsistência entre o convite público e o registro administrativo.

Os links usam tokens aleatórios de alta entropia e não podem ser enumerados através do Firestore.

---

# WhatsApp Cloud API

A integração utiliza diretamente a API oficial da Meta.

Não existe Twilio ou outro intermediário.

O envio acontece através da API:

```text
POST /{PHONE_NUMBER_ID}/messages
```

O backend envia um template previamente aprovado pela Meta contendo informações como:

```text
nome do participante
nome do evento
link de confirmação
```

O access token utilizado para enviar mensagens fica armazenado no **Secret Manager**, nunca no frontend.

---

## Fluxo de envio

```text
Browser
   │
   ▼
Firebase Callable Function
   │
   ├── valida autenticação
   ├── verifica permissão administrativa
   └── carrega participante no Firestore
             │
             ▼
       WhatsApp Cloud API
             │
             ▼
       mensagem aceita
             │
             ▼
         Firestore
```

Uma resposta `accepted` da API significa apenas que a Meta aceitou a solicitação.

Os estados posteriores chegam através do webhook.

---

# Webhook do WhatsApp

A Cloud Function responsável pelos callbacks da Meta recebe:

* status das mensagens;
* mensagens recebidas;
* respostas a botões;
* respostas a listas interativas.

Estados monitorados:

```text
sent        → enviado
delivered   → entregue
read        → lido
failed      → falhou
deleted     → apagado
```

Cada atualização gera um evento independente no Firestore.

Isso permite acompanhar a sequência completa:

```text
aceito
  ↓
enviado
  ↓
entregue
  ↓
lido
```

---

## Segurança do webhook

Os `POST` recebidos da Meta são validados através da assinatura:

```text
X-Hub-Signature-256
```

O backend calcula:

```text
HMAC-SHA256(rawBody, META_APP_SECRET)
```

e compara o valor usando comparação segura contra ataques de timing.

Requisições com assinatura inválida recebem:

```text
HTTP 401
```

---

# Confirmação pelo WhatsApp

Além do link público, o sistema pode reconhecer respostas através de botões.

Payload esperado:

```text
data_YYYY_MM_DD
```

Exemplo:

```text
data_2026_09_22
```

Quando um botão válido é recebido, o webhook identifica o participante pelo número do WhatsApp e atualiza automaticamente:

```text
dataSelecionada
status
origemConfirmacao
confirmacaoWhatsAppEm
```

O convite público relacionado também passa para o estado confirmado.

---

# Arquitetura

A aplicação utiliza uma arquitetura serverless baseada no ecossistema Firebase.

```text
┌─────────────────────────────┐
│      Firebase Hosting       │
│                             │
│  /                          │
│  /login/                    │
│  /app/                      │
│  /confirmar/                │
│  /webhooks/                 │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│       Firebase Auth         │
└─────────────┬───────────────┘
              │
       ┌──────┴───────┐
       │              │
       ▼              ▼
┌───────────────┐ ┌────────────────┐
│   Firestore   │ │ Cloud Functions│
└───────────────┘ └───────┬────────┘
                           │
                           ▼
                 ┌─────────────────┐
                 │ WhatsApp Cloud  │
                 │      API        │
                 └────────┬────────┘
                          │
                          ▼
                    Meta Webhook
```

---

# Tecnologias

## Frontend

* HTML5
* CSS
* JavaScript ES Modules
* Firebase Web SDK

## Backend

* Node.js 20
* TypeScript
* Firebase Functions
* Firebase Admin SDK

## Infraestrutura

* Firebase Hosting
* Firebase Authentication
* Cloud Firestore
* Google Secret Manager
* WhatsApp Cloud API
* Meta Graph API

---

# Estrutura do projeto

```text
GrobExperience2026/
│
├── public/
│   ├── app/
│   │   └── index.html
│   │
│   ├── confirmar/
│   │   └── index.html
│   │
│   ├── login/
│   │   └── index.html
│   │
│   ├── privacidade/
│   │   └── index.html
│   │
│   ├── webhooks/
│   │   └── index.html
│   │
│   ├── teste-whatsapp/
│   │   └── index.html
│   │
│   ├── css/
│   ├── img/
│   │
│   └── js/
│       ├── auth.js
│       ├── firebase-client.js
│       ├── confirmacao.js
│       ├── pre-inscritos.js
│       ├── teste-whatsapp.js
│       └── webhooks.js
│
├── functions/
│   ├── src/
│   │   ├── index.ts
│   │   ├── mensagens.ts
│   │   ├── pre-inscritos.ts
│   │   ├── send-whatsapp-template.ts
│   │   └── whatsapp-webhook.ts
│   │
│   ├── package.json
│   └── tsconfig.json
│
├── firestore.rules
├── firebase.json
├── .firebaserc
├── .gitignore
└── agent.md
```

---

# Principais coleções do Firestore

## `preInscritos`

Armazena os participantes.

Exemplo conceitual:

```text
preInscritos/{whatsapp}
```

Campos possíveis:

```text
nome
email
empresa
whatsapp
status
dataSelecionada
tokenPublico
linkPublico
statusEnvioWhatsApp
ultimaMensagemWhatsAppId
whatsappEnviadoEm
whatsappEntregueEm
whatsappLidoEm
```

---

## `linksPublicos`

Relaciona o token público ao participante.

```text
linksPublicos/{token}
```

A consulta pública permite apenas acesso direto ao documento.

Listagem da coleção é bloqueada pelas Firestore Rules.

---

## `whatsappMensagens`

Mantém o estado atual conhecido de cada mensagem enviada.

```text
whatsappMensagens/{wamid}
```

---

## `whatsappEventos`

Funciona como histórico de eventos do WhatsApp.

Pode conter:

```text
envio
status
mensagem
```

Uma mesma mensagem pode possuir diversos eventos:

```text
enviado
entregue
lido
```

---

## `whatsappRecebidas`

Armazena mensagens enviadas pelos participantes ao número do evento.

---

## `users`

Contém informações e permissões dos usuários internos.

Exemplo:

```json
{
  "active": true,
  "roles": {
    "admin": true
  }
}
```

---

# Secrets

Os seguintes valores não devem ser armazenados no Git:

```text
META_WHATSAPP_ACCESS_TOKEN
META_APP_SECRET
META_WEBHOOK_VERIFY_TOKEN
```

Eles devem ser cadastrados usando Firebase Secrets:

```bash
firebase functions:secrets:set META_WHATSAPP_ACCESS_TOKEN
firebase functions:secrets:set META_APP_SECRET
firebase functions:secrets:set META_WEBHOOK_VERIFY_TOKEN
```

Nunca inclua tokens reais em:

```text
Git
README
issues
logs
prints
scripts versionados
arquivos .env públicos
```

---

# Instalação

Clone o projeto:

```bash
git clone https://github.com/evertaraujo-lgtm/GrobExperience2026.git

cd GrobExperience2026
```

Instale as dependências das Functions:

```bash
cd functions
npm install
```

Compile o TypeScript:

```bash
npm run build
```

---

# Firebase CLI

Caso necessário:

```bash
npm install -g firebase-tools
```

Faça login:

```bash
firebase login
```

Confira o projeto:

```bash
firebase use
```

---

# Execução local

Para iniciar o emulador das Functions:

```bash
cd functions
npm run serve
```

Também é possível iniciar os emuladores diretamente:

```bash
firebase emulators:start
```

---

# Deploy

## Hosting

```bash
firebase deploy --only hosting
```

## Firestore Rules

```bash
firebase deploy --only firestore:rules
```

## Functions

```bash
firebase deploy --only functions
```

## Projeto completo

```bash
firebase deploy
```

---

# Build das Functions

Antes de cada deploy das Functions, o Firebase executa:

```bash
npm run build
```

O TypeScript compilado é gerado em:

```text
functions/lib/
```

Essa pasta não deve ser versionada.

---

# Configuração do webhook na Meta

O funcionamento completo do webhook depende de duas configurações diferentes.

## 1. Callback do aplicativo

No painel Meta Developers:

```text
WhatsApp
→ Configuration
→ Webhooks
```

Configure:

```text
Callback URL
Verify Token
```

e assine o campo:

```text
messages
```

---

## 2. Inscrição da WABA

O aplicativo também precisa estar inscrito na **WhatsApp Business Account que realmente possui o número usado no envio**.

A inscrição pode ser conferida através de:

```text
GET /{WABA_ID}/subscribed_apps
```

e criada através de:

```text
POST /{WABA_ID}/subscribed_apps
```

O teste de webhook do painel da Meta não garante que esta configuração esteja correta.

Ele apenas verifica se a Callback URL responde.

---

# Monitoramento

A página:

```text
/webhooks/
```

apresenta os eventos recebidos da Meta.

Ela pode ser utilizada para conferir:

* envio;
* entrega;
* leitura;
* falhas;
* mensagens recebidas;
* respostas aos botões.

Eventos reais usam identificadores `wamid`.

Testes locais devem usar identificadores claramente artificiais.

---

# Segurança

O projeto possui algumas medidas importantes de proteção:

* access token da Meta armazenado em Secret Manager;
* webhook validado com HMAC SHA-256;
* comparação de assinatura com `timingSafeEqual`;
* envio realizado pelo backend;
* painel protegido por Firebase Authentication;
* ações administrativas protegidas por perfil;
* regras específicas para Firestore;
* links públicos não enumeráveis;
* tokens públicos aleatórios;
* arquivos CSV/XLS/XLSX ignorados pelo Git;
* arquivos `.env` e credenciais ignorados;
* service accounts não devem ser versionadas.

---

# Dados pessoais

O repositório não deve conter arquivos com dados reais de participantes.

O `.gitignore` bloqueia por padrão:

```text
*.csv
*.xls
*.xlsx
```

Dados pessoais devem permanecer exclusivamente nos ambientes adequados, como o Firestore e fontes autorizadas para importação.

---

# Observações sobre status do WhatsApp

Um envio aceito pela API não significa que a mensagem chegou ao aparelho.

Fluxo possível:

```text
accepted
   ↓
sent
   ↓
delivered
   ↓
read
```

Nem sempre todos os estados aparecerão.

Por exemplo, se o usuário desativar recibos de leitura, o último estado observado poderá ser:

```text
delivered
```

---

# Documentação operacional

O arquivo:

```text
agent.md
```

contém informações mais aprofundadas sobre:

* configuração da Meta;
* WABA;
* Phone Number ID;
* webhook;
* diagnóstico;
* consultas na Graph API;
* funcionamento dos status;
* testes locais;
* decisões técnicas já tomadas.

Ele funciona como um runbook técnico para manutenção do sistema.

---

# Objetivo do projeto

O objetivo do GROB Experience 2026 não é ser uma plataforma genérica de eventos.

Ele foi desenvolvido para resolver de forma simples e confiável um fluxo específico:

```text
pré-inscrição
      ↓
seleção de data
      ↓
confirmação
      ↓
acompanhamento
```

A arquitetura privilegia:

* simplicidade;
* rastreabilidade;
* baixo custo operacional;
* segurança;
* facilidade de manutenção.

Sem microserviços para confirmar se alguém prefere terça, quarta ou quinta. A civilização ainda pode ser salva.

---

## Projeto

**GROB Experience 2026**

Firebase + TypeScript + WhatsApp Cloud API
