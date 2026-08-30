# Guia operacional — GROB Experience / WhatsApp Cloud API

Este documento preserva as decisões, os fatos verificados e os erros de diagnóstico encontrados na configuração do WhatsApp do GROB Experience. Ele deve servir de contexto para qualquer agente ou pessoa que for manter o projeto e produzir um README confiável.

> Nunca registre tokens, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` ou links de confirmação reais neste arquivo, no Git ou em mensagens de chat.

## Objetivo atual

O site Firebase administra pré-inscritos do GROB Experience. Ele cria links públicos para escolha de data, permite disparar templates de WhatsApp pela Cloud API e monitora os callbacks recebidos da Meta:

- status de envio: enviado, entregue, lido, falhou;
- mensagens recebidas;
- resposta a botões de data, que confirma automaticamente a pré-inscrição.

## Arquitetura confirmada

```text
Painel web (Firebase Hosting)
  ├─ preInscritos/{whatsapp}
  ├─ linksPublicos/{token}
  └─ whatsappEventos/{id}  ← página /webhooks/

Meta WhatsApp Cloud API
  ├─ POST /{PHONE_NUMBER_ID}/messages  ← envio de template
  └─ POST webhook                      ← status e respostas recebidas
                                      ↓
Firebase Function whatsappWebhook
  ├─ valida assinatura HMAC
  ├─ grava whatsappEventos
  ├─ atualiza preInscritos
  └─ confirma linksPublicos quando recebe botão de data
```

### Componentes do projeto

- **Firebase Hosting**: publica a interface em `https://grobexperience.web.app`.
- **Cloud Function Gen 2**: `whatsappWebhook`, em `us-central1`; recebe o webhook da Meta.
- **Cloud Firestore**: armazena pré-inscritos, links e eventos.
- **Meta WhatsApp Cloud API**: API oficial usada para enviar mensagens; não há Twilio neste projeto.

Arquivos principais:

- `functions/src/whatsapp-webhook.ts`: endpoint, validação e persistência do webhook.
- `public/app/index.html`, `public/js/pre-inscritos.js`: painel de pré-inscritos.
- `public/webhooks/index.html`, `public/js/webhooks.js`: painel de eventos de WhatsApp.
- `firestore.rules`: permissões do Firestore.

## Siglas e objetos da Meta

| Termo | Definição | Papel neste projeto |
| --- | --- | --- |
| **Meta App / App ID** | Aplicativo cadastrado no Meta for Developers. | Possui a configuração do webhook e as permissões da API. |
| **WABA** | *WhatsApp Business Account*, conta empresarial de WhatsApp. | É a entidade à qual os números de WhatsApp pertencem e à qual o app deve ser inscrito para receber callbacks reais. |
| **Business ID** | Identificador do negócio no Meta Business Manager. | Pode possuir uma ou mais WABAs. Não é o mesmo que WABA ID nem Phone Number ID. |
| **Phone Number ID** | Identificador técnico de um número dentro da Cloud API. | É usado na URL de envio: `/{PHONE_NUMBER_ID}/messages`. |
| **Display phone number** | Número humano exibido no WhatsApp Manager. | Serve para conferência visual; não substitui o Phone Number ID. |
| **Webhook** | Requisição HTTP que a Meta envia ao nosso servidor quando ocorre um evento. | Recebe status, mensagens e cliques em botões. |
| **Campo `messages`** | Assinatura de eventos do WhatsApp dentro do app Meta. | Deve estar ligado no painel de Webhooks. |
| **`subscribed_apps`** | Relação entre uma WABA e apps inscritos para eventos. | Sem esta relação na WABA certa, callbacks reais de status não chegam. |
| **`wamid`** | ID de mensagem do WhatsApp/Meta. | Distingue cada mensagem e seus vários status. |

### Associações verificadas neste ambiente

Estes identificadores não são segredos, mas devem ser conferidos antes de qualquer alteração:

| Entidade | ID / valor | Relação |
| --- | --- | --- |
| Business ID | `3127535030778409` | Negócio que contém as WABAs listadas abaixo. |
| WABA de produção | `1786130085892988` — `GROB Experience` | É a WABA do número de produção. |
| WABA de teste | `1747958919859742` — `Test WhatsApp Business Account` | Não é a WABA usada pelo número de produção. |
| Phone Number ID | `1289110394284226` | Pertence à WABA `GROB Experience`. |
| Número exibido | `+55 11 92704-9127` | Número associado ao Phone Number ID acima. |

Relação correta:

```text
Business ID 3127535030778409
 ├─ WABA 1786130085892988 (GROB Experience)
 │   └─ Phone Number ID 1289110394284226 (+55 11 92704-9127)
 └─ WABA 1747958919859742 (Test WhatsApp Business Account)
```

## Tokens e secrets

### Tokens da Meta

- **Access token de usuário**: criado, por exemplo, no Graph API Explorer. É temporário e útil para testes manuais. Nunca deve ir para o repositório.
- **Access token de System User**: token criado no Business Manager para automação de servidor. É a opção indicada quando o envio passar a ser feito pelo backend; deve ficar em Secret Manager/Firebase Secrets.
- **Access token de app**: representa o app, mas não substitui o token com permissões de WhatsApp para enviar mensagens.
- **Bearer token**: nome do uso HTTP do access token: `Authorization: Bearer <token>`.

### Secrets usados pela Function

- **`META_APP_SECRET`**: App Secret da Meta. É usado para verificar a assinatura HMAC SHA-256 do `POST` recebido. Se a assinatura não conferir, a Function responde `401`.
- **`META_WEBHOOK_VERIFY_TOKEN`**: texto aleatório definido por nós. Só participa da verificação inicial `GET` da Meta (`hub.verify_token`); não é token de envio nem token fornecido pela Meta.

Os dois foram armazenados em Firebase/Google Secret Manager com `firebase functions:secrets:set`. As chaves precisam usar `UPPER_SNAKE_CASE`; valores não podem ser passados como se fossem o nome da chave.

Ao enviar requests de teste pelo terminal, peça o segredo com `read -rsp`, use-o somente em uma variável da sessão e execute `unset` ao final. Nunca cole o valor em chat, arquivo, histórico compartilhado ou shell script versionado.

## Fluxos corretos

### 1. Envio de template

O envio ocorre com:

```text
POST https://graph.facebook.com/{VERSAO}/{PHONE_NUMBER_ID}/messages
Authorization: Bearer <ACCESS_TOKEN>
```

Uma resposta com `message_status: "accepted"` significa somente que a API aceitou o pedido. Não significa que a mensagem foi enviada, entregue ou lida.

Depois, a Meta pode enviar no webhook os status `sent`, `delivered`, `read`, `failed` ou `deleted`. A Function os traduz para português e grava uma linha em `whatsappEventos` para cada combinação de mensagem/status/hora.

### 2. Configuração obrigatória do webhook

São duas configurações independentes:

1. No app Meta, configurar Callback URL e Verify Token e assinar o campo `messages`.
2. Inscrever o app **na WABA que realmente possui o Phone Number ID**:

```text
POST /{WABA_ID_DE_PRODUCAO}/subscribed_apps
```

O segundo item é essencial. O retorno `{"success": true}` só prova que a inscrição foi criada para o ID informado; ele não prova que esse ID é a WABA certa.

### 3. Mensagens recebidas e escolha de data

A Function grava qualquer mensagem recebida em `whatsappRecebidas` e em `whatsappEventos`.

Para um template com botões de data, o payload deve ser `data_YYYY_MM_DD`, por exemplo `data_2026_09_22`. A Function reconhece:

- template quick reply: `type: "button"` e `button.payload`;
- mensagem interativa: `interactive.button_reply.id`;
- lista interativa: `interactive.list_reply.id`.

Quando o payload corresponde a uma data válida e o WhatsApp corresponde a um documento `preInscritos/{whatsapp}`, a Function:

- define `dataSelecionada`;
- muda `status` para `confirmado`;
- atualiza o documento `linksPublicos/{tokenPublico}`.

Uma resposta escrita livremente pela pessoa aparece no monitoramento, mas não altera a data.

## Diagnóstico: falha real encontrada e corrigida

### Sintoma

Mensagens enviadas pela API chegavam ao destinatário, mas a página de eventos permanecia vazia. O teste do painel Meta chegava à Function, o que gerou uma conclusão incompleta de que o webhook inteiro estava funcionando.

### Causa comprovada

O app havia sido inscrito na **WABA de teste**, e não na WABA `GROB Experience` que possui o Phone Number ID usado no envio.

Consulta que expôs o problema:

```text
GET /1786130085892988/subscribed_apps  → {"data":[]}
```

Após inscrever o app na WABA de produção, os callbacks reais apareceram como `Enviado` e `Entregue` no painel.

### Lição crítica

O botão **Teste** da Meta dispara um payload de exemplo diretamente para a Callback URL. Ele prova:

- URL acessível;
- assinatura aceita;
- Function executa.

Ele **não prova** que a WABA de produção está inscrita, nem que status reais serão recebidos. O payload de exemplo pode trazer ID curto e timestamp antigo (por exemplo, data de 2017); não deve ser confundido com retorno de produção.

Também não é correto concluir que a ausência de eventos na interface indica erro de regras do Firestore antes de verificar se a Meta fez um `POST` para a Function. Logs da Function distinguem claramente os casos.

## Consultas seguras de diagnóstico

Use apenas tokens na sua sessão de terminal. Não cole o token nas respostas nem o adicione a arquivos.

Listar WABAs do Business:

```bash
curl -sS -G "https://graph.facebook.com/v23.0/3127535030778409/owned_whatsapp_business_accounts" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "fields=id,name"
```

Conferir os números de uma WABA:

```bash
curl -sS -G "https://graph.facebook.com/v23.0/1786130085892988/phone_numbers" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "fields=id,display_phone_number,verified_name"
```

Ver apps inscritos na WABA:

```bash
curl -sS -G "https://graph.facebook.com/v23.0/1786130085892988/subscribed_apps" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "fields=id,name"
```

Inscrever o app na WABA correta (operação de escrita):

```bash
curl -i -X POST "https://graph.facebook.com/v23.0/1786130085892988/subscribed_apps" \
  -H "Authorization: Bearer $TOKEN"
```

## Tela de monitoramento

`/webhooks/` lê `whatsappEventos`, em ordem de registro decrescente, até 100 itens.

Cada status real é uma linha distinta, mesmo se for para o mesmo número. A chave de deduplicação considera ID da mensagem, status, timestamp e participante. Portanto, uma mensagem pode ter as linhas **Enviado**, **Entregue** e **Lido**.

- Se o destinatário desativar recibos de leitura, é esperado ver no máximo **Entregue**.
- Eventos anteriores à inscrição correta na WABA não são recuperados retroativamente.
- Registros `wamid.TESTE_LOCAL_*` são simulações locais, não retornos da Meta.

## Testes simulados

É possível simular a Meta com `curl`, desde que o corpo seja assinado com `META_APP_SECRET` e enviado com `X-Hub-Signature-256`. Isso testa Function → Firestore → página.

Um teste de status deve usar ID propositalmente identificável, como `wamid.TESTE_LOCAL_...`. Um teste de botão de data altera de verdade o pré-inscrito cujo número aparece no corpo; use um registro de teste ou restaure o estado depois. Teste simulado não substitui a validação com uma mensagem real após a inscrição na WABA correta.

## Deploy e permissões

- Alterou `public/`: `firebase deploy --only hosting`.
- Alterou `functions/`: `firebase deploy --only functions:whatsappWebhook`.
- Alterou `firestore.rules`: `firebase deploy --only firestore:rules`.

Não é necessário fazer deploy de Hosting ao alterar somente a Function, nem deploy da Function ao alterar somente a interface. Faça o menor deploy necessário.

As regras permitem leitura de `whatsappEventos`, `whatsappMensagens` e `whatsappRecebidas` apenas a administradores. Criar pré-inscrito também requer administrador. O modal de cadastro manual gera os mesmos campos essenciais da importação: documento do pré-inscrito, token, link público, mensagem e convite pendente.

## Diretrizes para produzir um README bom

Um README futuro deve:

1. Explicar o fluxo completo antes de listar comandos.
2. Diferenciar explicitamente Business ID, WABA ID e Phone Number ID.
3. Declarar que `accepted` não é entrega e que o teste Meta não prova inscrição na WABA.
4. Listar os secrets apenas pelos nomes, sem valores.
5. Informar os três deploys independentes: Hosting, Function e regras.
6. Descrever os dados gravados no Firestore e a regra de confirmação por botão.
7. Oferecer diagnóstico baseado em evidência: checar logs da Function, mapear Phone Number ID → WABA e então consultar `subscribed_apps`.
8. Incluir uma seção de segurança: tokens, secrets e links públicos não devem ser versionados.

Evite instruções que mandem o operador procurar menus vagos no painel da Meta quando a Graph API pode responder objetivamente. Nunca afirme que uma camada funciona sem especificar qual evidência foi observada: teste de callback, log de `POST`, status real, documento Firestore ou visualização da página são evidências diferentes.
