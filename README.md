# GROB Experience 2026

Sistema operacional do **GROB Experience 2026**.

Ele organiza a jornada completa do visitante: pré-inscrição, confirmação de data pelo WhatsApp, inscrição no 4Events, acompanhamento da participação no evento e coleta presencial de leads.

> Projeto interno e específico do evento. Não é uma plataforma genérica de gestão de eventos.

## O que o sistema faz

- importa e organiza pré-inscritos;
- cria links individuais de confirmação de data;
- dispara templates aprovados pela WhatsApp Cloud API;
- acompanha aceitação, entrega, leitura e falha de mensagens;
- processa respostas e botões recebidos pelo WhatsApp;
- sincroniza e consulta participantes do 4Events;
- complementa participantes do 4Events com dados importados de planilhas Excel;
- realiza sorteios auditáveis de brindes entre participantes presentes;
- apoia o acompanhamento de visitantes estratégicos;
- registra presença por QR Code;
- permite coleta de leads em modo offline;
- organiza vendedores, assistentes e atividades do evento.

## Fluxo principal

```mermaid
flowchart TD
  A["Pré-inscrito"] --> B["Painel administrativo"]
  B --> C["WhatsApp Cloud API"]
  C --> D["Link ou resposta no WhatsApp"]
  D --> E["Confirmação da data"]
  E --> F["4Events e operação do evento"]
  F --> G["QR Code, presença e leads"]
```

## Áreas da aplicação

| Área | Finalidade |
| --- | --- |
| `/app/` | Painel administrativo de pré-inscritos, confirmações e mensagens |
| `/confirmar/` | Página pública para seleção da data pelo convidado |
| `/participantes-4events/` | Consulta dos participantes sincronizados do 4Events |
| `/sorteio-4events/` | Sorteio administrativo de brindes, com modo teste e telão |
| `/gestao-evento/` | Gestão de atividades e equipe de coleta |
| `/coleta-atividades/` | Leitura de QR Codes para atividades presenciais |
| `/coleta-leads/` | Captação de leads, inclusive sem conexão |
| `/webhooks/` | Monitoramento dos eventos recebidos do WhatsApp |
| `/login/` | Acesso da equipe interna |

## Arquitetura

```mermaid
flowchart LR
  H["Firebase Hosting<br/>HTML, CSS e JS"] --> A["Firebase Auth"]
  H --> F["Cloud Functions<br/>TypeScript"]
  H --> D["Cloud Firestore"]
  F --> D
  F --> W["WhatsApp Cloud API"]
  W --> F
  F --> E["4Events API"]
```

### Tecnologias

- Frontend: HTML, CSS e JavaScript com ES Modules
- Backend: Node.js 20, TypeScript e Firebase Functions
- Dados e autenticação: Cloud Firestore e Firebase Authentication
- Integrações: WhatsApp Cloud API (Meta) e 4Events
- Infraestrutura: Firebase Hosting e Google Secret Manager

## WhatsApp

Os envios são realizados exclusivamente pelo backend. O navegador nunca recebe o token da Meta.

O sistema registra o ciclo de uma mensagem:

```text
aceito → enviado → entregue → lido
                    └──────→ falhou
```

O webhook recebe status e respostas dos participantes. Requisições `POST` da Meta são verificadas pela assinatura `X-Hub-Signature-256`, com HMAC SHA-256 e comparação segura.

## Dados no Firestore

| Coleção | Conteúdo |
| --- | --- |
| `preInscritos` | Pré-inscritos, convites, confirmação e histórico de envio |
| `linksPublicos` | Convites por token para confirmação pública |
| `inscritos` | Registros internos de inscrição |
| `participantes4Events` | Participantes sincronizados do 4Events |
| `participantes4EventsComplementos` | País, estado, cidade, endereço e dados profissionais importados por Excel |
| `integracoes4Events` | Última sincronização da presença por EID |
| `sorteios4Events` | Histórico definitivo dos sorteios de brindes |
| `sorteios4EventsVencedores` | Bloqueios que impedem nova vitória na mesma categoria |
| `sorteios4EventsTestes` | Sessões isoladas, presenças simuladas e resultados de ensaio |
| `visitantesEstrategicos` | Visitantes que exigem acompanhamento especial |
| `whatsappMensagens` | Estado atual das mensagens enviadas |
| `whatsappEventos` | Histórico de eventos do WhatsApp |
| `whatsappRecebidas` | Mensagens recebidas dos participantes |
| `coletaAtividades` | Atividades presenciais e responsáveis |
| `coletaAtividadesRegistros` | Leituras de QR Code por atividade |
| `coletaLeads` | Leads coletados pela equipe |
| `retrospectivasEvento` | Resumo estatístico e texto gerado para a retrospectiva administrativa |
| `users` | Perfis e papéis internos |

### Retrospectiva do evento com Gemini

A página `/gestao-evento/retrospectiva/` mostra publicamente a última retrospectiva concluída dos dias 22 a 24 de setembro de 2026. Visitantes sem login recebem apenas uma projeção de leitura da Cloud Function `getPublicEventRetrospective`: números agregados e comentários, sem nomes de vendedores, amostras ou textos de mensagens recebidas. O documento completo no Firestore e o histórico de versões continuam restritos a administradores, que também são os únicos a ver o botão de geração. A Cloud Function `generateEventRetrospective` calcula leituras e revisitas nas atividades; inscrições e presenças da 4Events por dia, categoria e recorte de visitantes; distribuições das respostas de múltipla escolha da pesquisa; leads e respostas estruturadas; e volumes de WhatsApp enviados e recebidos. O WhatsApp usa o histórico completo: envios de campanhas, notificações de chegada, lembretes de presença e outros envios são contados uma vez pelo identificador da mensagem, sem envios de teste; as recebidas vêm do webhook. Não há métrica de respostas. A função oculta nomes aparentes, telefones, e-mails, links e números dos textos recebidos antes de exibir até 40 mensagens recentes a administradores ou enviar uma amostra de até 200 textos distintos ao Gemini. O modelo identifica dúvidas, problemas e motivos explícitos de não participação ou desistência, sempre associados aos IDs dos textos usados como evidência. Códigos QR, nomes de participantes, contatos e respostas abertas da pesquisa não são enviados ao Gemini. O resultado fica salvo em `retrospectivasEvento/grob-experience-2026`, com histórico em `versoes`; abrir a página novamente não relê todas as coleções nem chama o modelo. Se uma atualização falhar, a última análise concluída permanece disponível. Se ainda não houver análise concluída, os números calculados continuam visíveis para administradores e uma nova tentativa reaproveita esse resumo.

Antes de publicar a função, configure uma chave da Gemini Developer API no Secret Manager do Firebase com `firebase functions:secrets:set GEMINI_API_KEY --project grobexperience`. A chave não deve ser colocada no código nem no navegador. O modelo configurado no código é `gemini-3.8-flash`. A função e a página exigem um usuário administrador; a coleção de resultados permite somente leitura administrativa pelo cliente.

### Complementos dos participantes 4 Events

Administradores podem importar uma planilha Excel em `/participantes-4events/` para preencher País, Estado, Cidade, Endereço, Empresa, Cargo, Nível e Setor Industrial. Cada linha deve ter pelo menos um identificador: ID participante, QRCODE, e-mail ou CPF.

Os registros ficam em `participantes4EventsComplementos`. Novas importações atualizam chaves já existentes e adicionam as demais. A correlação usa IDs de documento determinísticos e leituras diretas; portanto, não exige índice composto no Firestore.

### Sorteio de brindes 4 Events

Administradores usam `/sorteio-4events/` para ensaiar ou realizar o sorteio final do evento fixo de EID `2`. No modo final, somente participantes marcados como presentes pela API e pertencentes à categoria do dia em `America/Sao_Paulo` são elegíveis. Resultados e bloqueios ficam em coleções próprias e nunca são gravados em `participantes4Events`.

O modo teste aceita categorias futuras e permite presença simulada. Cada sessão mantém vencedores e resultados isolados. O administrador pode limpar os resultados e bloqueios da sessão de teste atual, preservando a presença simulada e sem alterar o histórico final. A escolha ocorre em uma Cloud Function com aleatoriedade criptográfica e gravação transacional; a animação do telão apenas revela o resultado já persistido. Após a revelação, uma contagem regressiva configurável ajuda os apresentadores a aguardar a manifestação do vencedor, sem executar desclassificação ou qualquer outra ação automática.

## Papéis internos

| Papel | Acesso principal |
| --- | --- |
| Administrador | Gestão do evento, mensagens, equipe, dados e integrações |
| Assistente de coleta | Atividades presenciais sob sua responsabilidade |
| Vendedor | Coleta e consulta dos próprios leads |

As regras do Firestore protegem o acesso direto do cliente; operações privilegiadas são concentradas nas Cloud Functions.

## Desenvolvimento local

Pré-requisitos:

- Node.js 20
- Firebase CLI
- acesso ao projeto Firebase correspondente

```bash
git clone https://github.com/evertaraujo-lgtm/GrobExperience2026.git
cd GrobExperience2026/functions
npm install
npm run build
```

Para iniciar os emuladores:

```bash
npm run serve
```

## Deploy

```bash
firebase deploy --only hosting
firebase deploy --only firestore:rules
firebase deploy --only functions
```

Para publicar tudo:

```bash
firebase deploy
```

## Secrets necessários

As credenciais devem existir apenas no Firebase Secret Manager:

```text
META_WHATSAPP_ACCESS_TOKEN
META_APP_SECRET
META_WEBHOOK_VERIFY_TOKEN
FOUR_EVENTS_TOKEN
```

Nunca versione tokens, contas de serviço, planilhas de participantes, exportações ou arquivos `.env`.

## Segurança e privacidade

- Tokens de confirmação são aleatórios e a listagem pública de convites é bloqueada.
- O painel requer autenticação.
- As mensagens são enviadas pelo backend.
- O webhook valida a assinatura da Meta.
- Dados de participantes devem permanecer no Firestore e nas fontes autorizadas — não no Git.
- Arquivos de importação e exportação são locais e descartáveis.

## Estrutura resumida

```text
public/                 interfaces web
functions/src/          Cloud Functions em TypeScript
firestore.rules         regras de acesso
firestore.indexes.json  índices do Firestore
firebase.json           configuração de deploy
agent.md                runbook técnico e operacional
```

## Status

O sistema foi construído para apoiar a operação real do GROB Experience 2026, reduzindo trabalho manual em confirmações, mensagens, presença e captação de oportunidades no evento.
