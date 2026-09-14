# Manual de uso — GROB Experience 2026

Este manual orienta a equipe na operação do sistema durante a preparação e a realização do evento.

> **Como inserir os prints:** em cada bloco `[PRINT]`, substitua o texto pela imagem correspondente. No GitHub, arraste a imagem diretamente para o editor do arquivo; ele gera o link automaticamente.

---

## Sumário

1. [Acesso ao sistema](#1-acesso-ao-sistema)
2. [Painel de pré-inscritos](#2-painel-de-pré-inscritos)
3. [Confirmação de data pelo participante](#3-confirmação-de-data-pelo-participante)
4. [Envio e acompanhamento pelo WhatsApp](#4-envio-e-acompanhamento-pelo-whatsapp)
5. [Participantes e 4Events](#5-participantes-e-4events)
6. [Atividades e presença por QR Code](#6-atividades-e-presença-por-qr-code)
7. [Coleta de leads](#7-coleta-de-leads)
8. [Rotina recomendada de operação](#8-rotina-recomendada-de-operação)
9. [Solução de problemas](#9-solução-de-problemas)

---

## 1. Acesso ao sistema

Acesse a página de login e entre com o e-mail e a senha fornecidos pela administração.

O sistema identifica o seu perfil automaticamente:

| Perfil | Acesso |
| --- | --- |
| Administrador | Gestão completa, mensagens, integrações, equipe e dados |
| Assistente de coleta | Atividades presenciais atribuídas a ele |
| Vendedor | Coleta e consulta dos próprios leads |

### Passo a passo

1. Abra a página de login.
2. Informe e-mail e senha.
3. Clique em **Entrar**.
4. Confirme se foi direcionado à área correspondente ao seu perfil.

> **[PRINT 01 — Tela de login]**
>
> Cole aqui um print da página `/login/`.

> **[PRINT 02 — Painel inicial após login]**
>
> Cole aqui um print da área `/app/`.

---

## 2. Painel de pré-inscritos

A área administrativa concentra as pessoas que demonstraram interesse no evento e ainda precisam ser acompanhadas até a confirmação.

### Consultar e localizar um pré-inscrito

1. Acesse o painel de pré-inscritos.
2. Use a busca para localizar por nome, empresa, e-mail ou WhatsApp.
3. Confira o status de confirmação e o status da última mensagem enviada.
4. Abra o registro quando precisar revisar os dados ou executar uma ação individual.

> **[PRINT 03 — Lista e filtros de pré-inscritos]**
>
> Cole aqui um print da listagem com a barra de busca e os indicadores.

### Importar pré-inscritos

Use a importação apenas com a lista autorizada pela organização.

1. Prepare a planilha de acordo com o formato aceito pela tela.
2. Revise nomes e números de WhatsApp antes de enviar.
3. Importe a lista.
4. Confira a quantidade processada e pesquise alguns registros para validar o resultado.

> **Importante:** não suba a planilha para o repositório Git nem a encaminhe por canais não autorizados.

> **[PRINT 04 — Importação de pré-inscritos]**
>
> Cole aqui um print da área de importação e do formato esperado.

### Gerar ou conferir convite

Cada pré-inscrito recebe um convite individual com link próprio para selecionar uma data.

1. Localize a pessoa.
2. Gere ou confira o convite disponível no registro.
3. Antes de enviar, verifique nome e WhatsApp.
4. Use o envio individual quando for necessário tratar um caso específico.

> **[PRINT 05 — Detalhe de um pré-inscrito / convite individual]**
>
> Cole aqui um print com dados fictícios ou ocultados.

---

## 3. Confirmação de data pelo participante

O participante recebe um link individual pelo WhatsApp. Nele, escolhe uma das datas habilitadas para o evento.

### O que acontece após a escolha

1. A pessoa abre o link.
2. Vê o próprio nome e as opções de data disponíveis.
3. Seleciona uma data e confirma.
4. O sistema atualiza o convite e o registro administrativo.
5. O painel passa a mostrar a confirmação e a data escolhida.

A confirmação também pode acontecer ao responder a um botão do WhatsApp, quando esse formato estiver habilitado no template.

> **[PRINT 06 — Página pública de confirmação]**
>
> Cole aqui um print da página `/confirmar/` com dados pessoais ocultados.

> **[PRINT 07 — Confirmação concluída]**
>
> Cole aqui um print do estado de sucesso após a escolha da data.

---

## 4. Envio e acompanhamento pelo WhatsApp

Os envios são feitos pelo sistema usando templates previamente aprovados pela Meta.

### Enviar em lote

1. No painel, filtre ou selecione os pré-inscritos que devem receber a mensagem.
2. Revise a quantidade, o template e a finalidade do envio.
3. Use a prévia quando ela estiver disponível.
4. Confirme o envio.
5. Aguarde o retorno de processamento e registre eventuais falhas.

Evite reenviar para pessoas já atendidas sem necessidade. Um status **aceito** significa que a Meta recebeu a solicitação; não significa, por si só, que a pessoa recebeu a mensagem.

> **[PRINT 08 — Seleção e prévia de lote]**
>
> Cole aqui um print da seleção de destinatários.

> **[PRINT 09 — Confirmação ou resultado do envio]**
>
> Cole aqui um print do retorno do lote.

### Interpretar os status

| Status | Significado |
| --- | --- |
| Aceito | A Meta aceitou a solicitação de envio |
| Enviado | A mensagem saiu para a rede do WhatsApp |
| Entregue | A mensagem chegou ao aparelho |
| Lido | A pessoa abriu a mensagem, quando recibos estão disponíveis |
| Falhou | A Meta não conseguiu entregar ou processar o envio |

### Monitorar eventos recebidos

A página de webhooks permite acompanhar mudanças de status, respostas e eventuais erros informados pela Meta.

1. Acesse **Webhooks**.
2. Atualize a listagem.
3. Procure pelo participante, telefone ou identificador da mensagem.
4. Em caso de falha, leia o motivo antes de tentar novo envio.

> **[PRINT 10 — Monitoramento de webhooks]**
>
> Cole aqui um print da tela `/webhooks/`.

---

## 5. Participantes e 4Events

O sistema também mantém uma base de participantes vinda do 4Events para apoio à operação do evento.

### Sincronizar participantes

Esta ação é exclusiva de administradores.

1. Acesse a área de participantes do 4Events.
2. Execute a sincronização ou atualização disponível.
3. Aguarde o processamento.
4. Confira se os participantes esperados aparecem na consulta.

> **[PRINT 11 — Participantes 4Events]**
>
> Cole aqui um print da tela `/participantes-4events/`.

### Visitantes estratégicos

Visitantes estratégicos podem ser acompanhados separadamente para que a equipe seja avisada ou tome a ação combinada quando houver presença identificada.

1. Cadastre ou localize o visitante estratégico.
2. Confira os dados de referência usados para encontrá-lo na base do evento.
3. Acompanhe os registros de presença e as notificações relacionadas.

> **[PRINT 12 — Acompanhamento de visitante estratégico]**
>
> Cole aqui um print da área correspondente, com dados ocultados.

---

## 6. Atividades e presença por QR Code

A gestão de atividades permite associar responsáveis e registrar participação durante o evento.

### Criar uma atividade — administrador

1. Acesse **Gestão do evento**.
2. Clique em **Cadastrar atividade**.
3. Informe nome e descrição.
4. Selecione os assistentes responsáveis.
5. Salve.

> **[PRINT 13 — Cadastro de atividade]**
>
> Cole aqui um print do formulário de atividade.

### Cadastrar assistente — administrador

1. Na mesma área, clique em **Cadastrar assistente**.
2. Informe nome, e-mail e a senha inicial.
3. Compartilhe as credenciais apenas pelo canal interno definido pela organização.
4. Atribua o assistente às atividades necessárias.

> **[PRINT 14 — Cadastro de assistente]**
>
> Cole aqui um print do formulário, sem mostrar senha.

### Registrar presença — assistente

1. Entre com a conta de assistente.
2. Abra a atividade atribuída.
3. Autorize o uso da câmera quando solicitado.
4. Leia o QR Code do participante.
5. Confira a confirmação exibida na tela.
6. Se necessário, sincronize quando a conexão voltar.

> **[PRINT 15 — Leitura de QR Code]**
>
> Cole aqui um print da tela `/coleta-atividades/`.

---

## 7. Coleta de leads

A coleta de leads é destinada à equipe comercial. Ela pode continuar funcionando temporariamente sem internet após uma primeira conexão bem-sucedida no aparelho.

### Antes de começar

1. Entre uma vez com internet no aparelho que será usado.
2. Confirme que os campos de coleta foram carregados.
3. Verifique se o modo offline está pronto, quando aplicável.
4. Mantenha o aparelho carregado e com permissão de câmera.

### Registrar um lead

1. Entre com a conta de vendedor.
2. Abra **Coleta de leads**.
3. Leia o QR Code do participante ou localize-o conforme o fluxo disponível.
4. Preencha os campos definidos pela administração.
5. Salve o registro.
6. Confira a confirmação na tela.

> **[PRINT 16 — Tela de coleta de leads]**
>
> Cole aqui um print da tela `/coleta-leads/`.

### Sincronizar dados offline

Quando houver conexão novamente:

1. Abra a área de coleta.
2. Aguarde a sincronização automática ou use o comando disponível.
3. Confirme que não há registros pendentes.
4. Não apague dados do navegador antes de verificar a sincronização.

> **[PRINT 17 — Estado offline / sincronização pendente]**
>
> Cole aqui um print do indicador de sincronização.

---

## 8. Rotina recomendada de operação

### Antes do evento

- Importar e revisar pré-inscritos.
- Gerar os convites necessários.
- Validar template, número remetente e link de confirmação com um teste interno.
- Disparar lotes com acompanhamento de falhas.
- Sincronizar a base do 4Events.
- Criar atividades, assistentes e vendedores.
- Testar QR Code, câmera e modo offline nos aparelhos que serão usados.

### Durante o evento

- Acompanhar os participantes e visitantes estratégicos.
- Registrar presença nas atividades.
- Garantir que vendedores sincronizem os leads periodicamente.
- Consultar o painel de webhooks apenas para investigar mensagens relevantes ou falhas.
- Usar contas individuais; nunca compartilhar o login de administrador.

### Após o evento

- Confirmar que todos os aparelhos sincronizaram os registros offline.
- Exportar ou consolidar os leads pelo procedimento interno autorizado.
- Revisar métricas de confirmação, presença e coleta.
- Revogar acessos temporários da equipe.

> **[PRINT 18 — Checklist operacional]**
>
> Cole aqui um print de um checklist preenchido ou da visão geral do painel.

---

## 9. Solução de problemas

| Situação | O que fazer |
| --- | --- |
| Não consigo entrar | Confira e-mail, senha e se a conta foi criada pela administração |
| Não vejo uma área esperada | Seu perfil pode não ter a permissão necessária; solicite ajuda a um administrador |
| Mensagem está “aceita”, mas não chegou | Aguarde os próximos status. Verifique falha ou entrega na área de webhooks |
| Participante não consegue confirmar | Confira se o link é o correto e se o convite ainda está pendente |
| Câmera não abre | Permita o acesso à câmera no navegador e recarregue a página |
| Coleta ficou sem internet | Continue registrando somente se o modo offline estiver pronto; sincronize assim que a conexão voltar |
| Lead não aparece para o vendedor | Confira se o registro foi salvo/sincronizado e se está associado ao usuário correto |
| QR Code não é reconhecido | Limpe a lente, melhore a iluminação e confira se o QR pertence ao evento correto |

## Boas práticas

- Nunca registre dados pessoais em prints, planilhas públicas ou conversas abertas.
- Oculte nome, e-mail, telefone, QR Code e token de convite antes de compartilhar capturas de tela.
- Faça envios em lote somente após revisar o público e o template.
- Não use a conta de outra pessoa.
- Não apague dados do navegador de aparelhos de coleta antes de confirmar a sincronização.
- Em caso de dúvida operacional, pare a ação que pode duplicar envios ou dados e peça apoio ao administrador.
