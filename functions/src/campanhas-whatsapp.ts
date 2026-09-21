import {createHash, randomUUID} from "node:crypto";

import {FieldValue, Firestore, Timestamp, getFirestore} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/https";
import {defineSecret} from "firebase-functions/params";

const metaWhatsAppAccessToken = defineSecret("META_WHATSAPP_ACCESS_TOKEN");
const phoneNumberId = "1289110394284226";
const graphVersion = "v23.0";
const campaignsCollection = "campanhasWhatsapp";
const messagesCollection = "campanhasWhatsappMensagens";
const eventsCollection = "campanhasWhatsappEventos";
const previewsCollection = "campanhasWhatsappPreviews";
const dailyControlCollection = "campanhasWhatsappControleDiario";
const maximumImportSize = 10000;
const previewLifetimeMs = 15 * 60 * 1000;

type CampaignDefinition = {
  id: string;
  name: string;
  templateName: string;
  category: string;
  language: string;
  templateSignature: string;
  confirmationCode: string;
  dailyLimit: number;
  batchSize: number;
  variables: string[];
  fixedButtons: string[];
};

type Sender = {
  uid: string;
  name: string | null;
  email: string | null;
};

type ImportedParticipant = {
  nome: string;
  nomeOrdenacao: string;
  whatsapp: string;
};

const campaigns: Record<string, CampaignDefinition> = {
  "participacao-chegando": {
    id: "participacao-chegando",
    name: "Participação chegando",
    templateName: "participacao_chegando",
    category: "UTILIDADE",
    language: "en",
    templateSignature: "participacao_chegando|en|body:nome|url-fixa:ver-no-mapa,baixar-o-app|v1",
    confirmationCode: "PARTICIPACAO CHEGANDO",
    dailyLimit: 500,
    batchSize: 250,
    variables: ["nome"],
    fixedButtons: ["Ver no mapa", "Baixar o app"],
  },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function campaignDefinition(value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  const campaign = campaigns[id];
  if (!campaign) throw new HttpsError("invalid-argument", "Campanha de WhatsApp não autorizada.");
  return campaign;
}

function normalizedSortName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
}

function normalizedPhone(value: unknown) {
  let phone = typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\D/g, "")
    : "";
  if (phone.startsWith("55") && (phone.length === 12 || phone.length === 13)) phone = phone.slice(2);
  return phone;
}

function participantInput(value: unknown): ImportedParticipant {
  const input = asRecord(value);
  const nome = typeof input.nome === "string" ? input.nome.trim().replace(/\s+/g, " ") : "";
  const whatsapp = normalizedPhone(input.whatsapp);
  if (!nome || whatsapp.length < 10 || whatsapp.length > 11) {
    throw new HttpsError("invalid-argument", "Cada participante precisa de nome e WhatsApp com DDD.");
  }
  return {nome, nomeOrdenacao: normalizedSortName(nome), whatsapp};
}

function dateKeyInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function eventId(prefix: string, messageId: string) {
  return `${prefix}_${createHash("sha256").update(messageId).digest("hex")}`;
}

function dailyControlId(campaignId: string, dateKey: string) {
  return `${campaignId}_${dateKey}`;
}

function participantsCollection(firestore: Firestore, campaignId: string) {
  return firestore.collection(campaignsCollection).doc(campaignId).collection("destinatarios");
}

async function adminSender(request: {auth?: {uid: string; token: {email?: string}}}): Promise<Sender> {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para continuar.");
  const profile = await getFirestore().collection("users").doc(request.auth.uid).get();
  const data = profile.data();
  if (!profile.exists || data?.active === false || data?.roles?.admin !== true) {
    throw new HttpsError("permission-denied", "Somente administradores podem usar esta campanha.");
  }
  return {
    uid: request.auth.uid,
    name: typeof data.name === "string" ? data.name : null,
    email: typeof data.email === "string" ? data.email : request.auth.token.email ?? null,
  };
}

async function commitOperations(
  firestore: Firestore,
  operations: ((batch: FirebaseFirestore.WriteBatch) => void)[],
) {
  for (let index = 0; index < operations.length; index += 400) {
    const batch = firestore.batch();
    operations.slice(index, index + 400).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

async function sendTemplate(campaign: CampaignDefinition, nome: string, whatsapp: string) {
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${metaWhatsAppAccessToken.value()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: `55${whatsapp}`,
      type: "template",
      template: {
        name: campaign.templateName,
        language: {code: campaign.language},
        components: [{
          type: "body",
          parameters: [{type: "text", parameter_name: "nome", text: nome}],
        }],
      },
    }),
  });
  const payload = asRecord(await response.json());
  if (!response.ok) {
    const error = asRecord(payload.error);
    throw new Error(typeof error.message === "string" ? error.message : "A Meta recusou o envio do template.");
  }
  const message = asRecord(Array.isArray(payload.messages) ? payload.messages[0] : undefined);
  const messageId = typeof message.id === "string" ? message.id : "";
  if (!messageId) throw new Error("A Meta não retornou o identificador da mensagem.");
  return {messageId, status: typeof message.message_status === "string" ? message.message_status : "accepted"};
}

async function saveAcceptedMessage(
  campaign: CampaignDefinition,
  participantId: string | null,
  nome: string,
  whatsapp: string,
  response: {messageId: string; status: string},
  sender: Sender,
  options: {batchId: string; group: number | null; dateKey: string; test: boolean; previewId: string | null},
) {
  const firestore = getFirestore();
  const now = FieldValue.serverTimestamp();
  const batch = firestore.batch();
  batch.set(firestore.collection(messagesCollection).doc(response.messageId), {
    campanhaId: campaign.id,
    participanteId: participantId,
    nome,
    destinatarioWhatsApp: whatsapp,
    template: campaign.templateName,
    templateAssinatura: campaign.templateSignature,
    teste: options.test,
    lote: options.group,
    loteEnvioId: options.batchId,
    previewId: options.previewId,
    dataOperacao: options.dateKey,
    status: "aceito",
    statusMeta: response.status,
    enviadoPorUid: sender.uid,
    enviadoPorNome: sender.name,
    enviadoPorEmail: sender.email,
    solicitadoEm: now,
  });
  batch.set(firestore.collection(eventsCollection).doc(eventId("envio", response.messageId)), {
    tipo: "envio",
    messageId: response.messageId,
    campanhaId: campaign.id,
    participanteId: participantId,
    nome,
    whatsapp,
    template: campaign.templateName,
    teste: options.test,
    lote: options.group,
    loteEnvioId: options.batchId,
    previewId: options.previewId,
    dataOperacao: options.dateKey,
    ocorridoEm: now,
    registradoEm: now,
  });
  if (participantId) {
    batch.set(participantsCollection(firestore, campaign.id).doc(participantId), {
      statusMensagem: "aceito",
      ultimaMensagemId: response.messageId,
      ultimoEnvioEm: now,
      statusMensagemEm: now,
      loteEnvioId: options.batchId,
      previewId: options.previewId,
      erroEnvio: FieldValue.delete(),
    }, {merge: true});
    batch.set(firestore.collection(campaignsCollection).doc(campaign.id), {
      statusOperacional: "em_andamento",
      enviosAceitos: FieldValue.increment(1),
      ultimoEnvioEm: now,
    }, {merge: true});
  }
  await batch.commit();
}

async function reserveParticipant(
  campaign: CampaignDefinition,
  participantId: string,
  batchId: string,
  dateKey: string,
  listVersion: string,
) {
  const firestore = getFirestore();
  const participantRef = participantsCollection(firestore, campaign.id).doc(participantId);
  const quotaRef = firestore.collection(dailyControlCollection).doc(dailyControlId(campaign.id, dateKey));
  return firestore.runTransaction(async (transaction) => {
    const [participant, quota] = await Promise.all([
      transaction.get(participantRef),
      transaction.get(quotaRef),
    ]);
    if (!participant.exists || participant.data()?.versaoLista !== listVersion) return {kind: "skip" as const};
    const data = participant.data() ?? {};
    if (![undefined, null, "pendente", "falhou"].includes(data.statusMensagem)) return {kind: "skip" as const};
    const attempts = typeof quota.data()?.tentativas === "number" ? quota.data()?.tentativas as number : 0;
    if (attempts >= campaign.dailyLimit) return {kind: "quota" as const};
    transaction.set(quotaRef, {
      campanhaId: campaign.id,
      data: dateKey,
      limite: campaign.dailyLimit,
      tentativas: attempts + 1,
      atualizadoEm: FieldValue.serverTimestamp(),
    }, {merge: true});
    transaction.set(participantRef, {
      statusMensagem: "processando",
      loteEnvioId: batchId,
      reservaEm: FieldValue.serverTimestamp(),
      erroEnvio: FieldValue.delete(),
    }, {merge: true});
    return {
      kind: "reserved" as const,
      nome: typeof data.nome === "string" ? data.nome : "participante",
      whatsapp: typeof data.whatsapp === "string" ? data.whatsapp : participant.id,
    };
  });
}

async function markFailure(campaignId: string, participantId: string, batchId: string, message: string) {
  const firestore = getFirestore();
  const reference = participantsCollection(firestore, campaignId).doc(participantId);
  await firestore.runTransaction(async (transaction) => {
    const participant = await transaction.get(reference);
    if (participant.data()?.loteEnvioId !== batchId) return;
    transaction.set(reference, {
      statusMensagem: "falhou",
      erroEnvio: message,
      statusMensagemEm: FieldValue.serverTimestamp(),
    }, {merge: true});
  });
}

export const importWhatsAppCampaignParticipants = onCall(
  {region: "us-central1", timeoutSeconds: 300},
  async (request) => {
    const sender = await adminSender(request);
    const input = asRecord(request.data);
    const campaign = campaignDefinition(input.campanhaId);
    const entries = input.participantes;
    if (!Array.isArray(entries) || !entries.length || entries.length > maximumImportSize) {
      throw new HttpsError("invalid-argument", `Envie entre 1 e ${maximumImportSize} participantes.`);
    }
    const fileName = typeof input.arquivoNome === "string" ? input.arquivoNome.trim().slice(0, 200) : "planilha.xlsx";
    const fileHash = typeof input.arquivoHash === "string" && /^[a-f0-9]{64}$/.test(input.arquivoHash)
      ? input.arquivoHash
      : "nao-informado";
    const unique = new Map<string, ImportedParticipant>();
    entries.map(participantInput).forEach((participant) => unique.set(participant.whatsapp, participant));
    const participants = [...unique.values()].sort((first, second) =>
      first.nomeOrdenacao.localeCompare(second.nomeOrdenacao, "pt-BR") || first.whatsapp.localeCompare(second.whatsapp));
    const listVersion = randomUUID();
    const listHash = createHash("sha256").update(JSON.stringify(participants)).digest("hex");
    const firestore = getFirestore();
    const campaignRef = firestore.collection(campaignsCollection).doc(campaign.id);
    const campaignDocument = await campaignRef.get();
    const campaignData = campaignDocument.data() ?? {};
    if ((campaignData.enviosAceitos ?? 0) > 0) {
      throw new HttpsError("failed-precondition", "Esta campanha já possui envios. A lista não pode mais ser substituída.");
    }
    const existing = await participantsCollection(firestore, campaign.id).get();
    if (existing.docs.some((document) => ![undefined, null, "pendente"].includes(document.data().statusMensagem))) {
      throw new HttpsError("failed-precondition", "Esta campanha já iniciou o processamento. A lista não pode mais ser substituída.");
    }
    const incomingIds = new Set(participants.map((participant) => participant.whatsapp));
    const operations: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
    existing.docs.filter((document) => !incomingIds.has(document.id))
      .forEach((document) => operations.push((batch) => batch.delete(document.ref)));
    participants.forEach((participant, index) => {
      const reference = participantsCollection(firestore, campaign.id).doc(participant.whatsapp);
      operations.push((batch) => batch.set(reference, {
        ...participant,
        lote: Math.floor(index / campaign.batchSize) + 1,
        ordem: index + 1,
        versaoLista: listVersion,
        statusMensagem: "pendente",
        importadoEm: FieldValue.serverTimestamp(),
        importadoPorUid: sender.uid,
      }));
    });
    await commitOperations(firestore, operations);
    const hasCurrentTest = campaignData.testeTemplateAssinatura === campaign.templateSignature
      && typeof campaignData.testeMensagemId === "string";
    const hasApprovedCurrentTest = hasCurrentTest && Boolean(campaignData.testeAprovadoEm);
    await campaignRef.set({
      campanhaId: campaign.id,
      nome: campaign.name,
      template: campaign.templateName,
      categoria: campaign.category,
      idioma: campaign.language,
      templateAssinatura: campaign.templateSignature,
      variaveis: campaign.variables,
      botoesFixos: campaign.fixedButtons,
      codigoConfirmacao: campaign.confirmationCode,
      limiteDiario: campaign.dailyLimit,
      tamanhoLote: campaign.batchSize,
      statusOperacional: hasApprovedCurrentTest ? "pronta" : hasCurrentTest ? "teste_enviado" : "rascunho",
      versaoLista: listVersion,
      listaHash: listHash,
      arquivoNome: fileName,
      arquivoHash: fileHash,
      totalDestinatarios: participants.length,
      totalLotes: Math.ceil(participants.length / campaign.batchSize),
      enviosAceitos: 0,
      importadoEm: FieldValue.serverTimestamp(),
      importadoPorUid: sender.uid,
      importadoPorNome: sender.name,
      ...(hasCurrentTest ? {} : {
        testeMensagemId: FieldValue.delete(),
        testeTemplateAssinatura: FieldValue.delete(),
        testeEnviadoEm: FieldValue.delete(),
        testeAprovadoEm: FieldValue.delete(),
        testeAprovadoPorUid: FieldValue.delete(),
      }),
    }, {merge: true});
    return {
      campanhaId: campaign.id,
      importados: participants.length,
      duplicadosIgnorados: entries.length - participants.length,
      lotes: Math.ceil(participants.length / campaign.batchSize),
      versaoLista: listVersion,
      listaHash: listHash,
      arquivoHash: fileHash,
    };
  },
);

export const sendWhatsAppCampaignTest = onCall(
  {region: "us-central1", secrets: [metaWhatsAppAccessToken]},
  async (request) => {
    const sender = await adminSender(request);
    const input = asRecord(request.data);
    const campaign = campaignDefinition(input.campanhaId);
    const nome = typeof input.nome === "string" ? input.nome.trim().replace(/\s+/g, " ") : "";
    const whatsapp = normalizedPhone(input.whatsapp);
    if (!nome || whatsapp.length < 10 || whatsapp.length > 11) {
      throw new HttpsError("invalid-argument", "Informe nome e WhatsApp com DDD para o teste.");
    }
    const campaignRef = getFirestore().collection(campaignsCollection).doc(campaign.id);
    const response = await sendTemplate(campaign, nome, whatsapp);
    const batchId = `teste_${randomUUID()}`;
    await saveAcceptedMessage(campaign, null, nome, whatsapp, response, sender, {
      batchId,
      group: null,
      dateKey: dateKeyInSaoPaulo(),
      test: true,
      previewId: null,
    });
    await campaignRef.set({
      statusOperacional: "teste_enviado",
      template: campaign.templateName,
      categoria: campaign.category,
      idioma: campaign.language,
      templateAssinatura: campaign.templateSignature,
      variaveis: campaign.variables,
      botoesFixos: campaign.fixedButtons,
      testeMensagemId: response.messageId,
      testeTemplateAssinatura: campaign.templateSignature,
      testeEnviadoEm: FieldValue.serverTimestamp(),
      testeEnviadoPorUid: sender.uid,
      testeAprovadoEm: FieldValue.delete(),
      testeAprovadoPorUid: FieldValue.delete(),
    }, {merge: true});
    return {
      messageId: response.messageId,
      status: response.status,
      template: campaign.templateName,
      botoesFixos: campaign.fixedButtons,
    };
  },
);

export const approveWhatsAppCampaignTest = onCall({region: "us-central1"}, async (request) => {
  const sender = await adminSender(request);
  const input = asRecord(request.data);
  const campaign = campaignDefinition(input.campanhaId);
  const messageId = typeof input.messageId === "string" ? input.messageId : "";
  if (input.confirmado !== true || !messageId) {
    throw new HttpsError("invalid-argument", "Confirme o recebimento e a revisão do teste.");
  }
  const firestore = getFirestore();
  const campaignRef = firestore.collection(campaignsCollection).doc(campaign.id);
  const [campaignDocument, message] = await Promise.all([
    campaignRef.get(),
    firestore.collection(messagesCollection).doc(messageId).get(),
  ]);
  if (campaignDocument.data()?.testeMensagemId !== messageId
    || message.data()?.campanhaId !== campaign.id
    || message.data()?.templateAssinatura !== campaign.templateSignature
    || message.data()?.teste !== true) {
    throw new HttpsError("failed-precondition", "O teste informado não corresponde à versão atual desta campanha.");
  }
  if (!["entregue", "lido"].includes(message.data()?.status)) {
    throw new HttpsError("failed-precondition", "Aguarde o webhook confirmar a entrega do teste antes de aprová-lo.");
  }
  await campaignRef.set({
    statusOperacional: "pronta",
    testeTemplateAssinatura: campaign.templateSignature,
    testeAprovadoEm: FieldValue.serverTimestamp(),
    testeAprovadoPorUid: sender.uid,
    testeAprovadoPorNome: sender.name,
  }, {merge: true});
  return {campanhaId: campaign.id, statusOperacional: "pronta"};
});

export const previewWhatsAppCampaignBatch = onCall({region: "us-central1"}, async (request) => {
  const sender = await adminSender(request);
  const input = asRecord(request.data);
  const campaign = campaignDefinition(input.campanhaId);
  const group = Number(input.lote);
  if (!Number.isInteger(group) || group < 1) throw new HttpsError("invalid-argument", "Informe um lote válido.");
  const firestore = getFirestore();
  const campaignRef = firestore.collection(campaignsCollection).doc(campaign.id);
  const campaignDocument = await campaignRef.get();
  const campaignData = campaignDocument.data() ?? {};
  if (!campaignDocument.exists || !campaignData.versaoLista || !campaignData.testeAprovadoEm
    || campaignData.testeTemplateAssinatura !== campaign.templateSignature) {
    throw new HttpsError("failed-precondition", "A campanha precisa de uma planilha e de um teste aprovado.");
  }
  if (campaignData.templateAssinatura !== campaign.templateSignature) {
    throw new HttpsError("failed-precondition", "A configuração do template mudou. Faça um novo teste antes de enviar.");
  }
  const snapshot = await participantsCollection(firestore, campaign.id).where("lote", "==", group).get();
  const ordered = snapshot.docs.sort((first, second) => Number(first.data().ordem ?? 0) - Number(second.data().ordem ?? 0));
  const eligible = ordered.filter((document) =>
    document.data().versaoLista === campaignData.versaoLista
      && [undefined, null, "pendente", "falhou"].includes(document.data().statusMensagem));
  const dateKey = dateKeyInSaoPaulo();
  const quota = await firestore.collection(dailyControlCollection).doc(dailyControlId(campaign.id, dateKey)).get();
  const usedToday = typeof quota.data()?.tentativas === "number" ? quota.data()?.tentativas as number : 0;
  const availableToday = Math.max(0, campaign.dailyLimit - usedToday);
  const selected = eligible.slice(0, Math.min(campaign.batchSize, availableToday));
  const recipients = selected.map((document) => ({
    id: document.id,
    nome: document.data().nome,
    whatsapp: document.data().whatsapp,
    ordem: document.data().ordem,
  }));
  const previewId = randomUUID();
  const expiresAt = Timestamp.fromMillis(Date.now() + previewLifetimeMs);
  await firestore.collection(previewsCollection).doc(previewId).set({
    previewId,
    campanhaId: campaign.id,
    campanhaNome: campaign.name,
    template: campaign.templateName,
    templateAssinatura: campaign.templateSignature,
    versaoLista: campaignData.versaoLista,
    listaHash: campaignData.listaHash,
    arquivoNome: campaignData.arquivoNome,
    arquivoHash: campaignData.arquivoHash,
    lote: group,
    destinatarioIds: recipients.map((recipient) => recipient.id),
    totalDestinatarios: recipients.length,
    status: "valida",
    criadoEm: FieldValue.serverTimestamp(),
    expiraEm: expiresAt,
    criadoPorUid: sender.uid,
    criadoPorNome: sender.name,
  });
  return {
    previewId,
    campaign: {
      id: campaign.id,
      nome: campaign.name,
      template: campaign.templateName,
      idioma: campaign.language,
      codigoConfirmacao: campaign.confirmationCode,
      botoesFixos: campaign.fixedButtons,
    },
    file: {nome: campaignData.arquivoNome, hash: campaignData.arquivoHash},
    group,
    recipients,
    skipped: ordered.length - eligible.length,
    notIncludedByLimit: Math.max(0, eligible.length - recipients.length),
    usedToday,
    availableToday,
    dailyLimit: campaign.dailyLimit,
    expiresAt: expiresAt.toMillis(),
  };
});

export const sendWhatsAppCampaignBatch = onCall(
  {region: "us-central1", secrets: [metaWhatsAppAccessToken], timeoutSeconds: 540},
  async (request) => {
    const sender = await adminSender(request);
    const input = asRecord(request.data);
    const previewId = typeof input.previewId === "string" ? input.previewId : "";
    const confirmationCode = typeof input.codigoConfirmacao === "string"
      ? input.codigoConfirmacao.trim().replace(/\s+/g, " ").toUpperCase()
      : "";
    if (!previewId) throw new HttpsError("invalid-argument", "Gere uma prévia válida antes de enviar.");
    const firestore = getFirestore();
    const previewRef = firestore.collection(previewsCollection).doc(previewId);
    const prepared = await firestore.runTransaction(async (transaction) => {
      const preview = await transaction.get(previewRef);
      if (!preview.exists) throw new HttpsError("not-found", "A prévia não existe mais.");
      const previewData = preview.data() ?? {};
      const campaign = campaignDefinition(previewData.campanhaId);
      if (confirmationCode !== campaign.confirmationCode) {
        throw new HttpsError("failed-precondition", "O código de confirmação da campanha está incorreto.");
      }
      const campaignRef = firestore.collection(campaignsCollection).doc(campaign.id);
      const campaignDocument = await transaction.get(campaignRef);
      const campaignData = campaignDocument.data() ?? {};
      const expiresAt = previewData.expiraEm;
      if (previewData.status !== "valida"
        || !(expiresAt instanceof Timestamp)
        || expiresAt.toMillis() < Date.now()) {
        throw new HttpsError("failed-precondition", "A prévia expirou ou já foi utilizada. Gere uma nova prévia.");
      }
      if (!campaignData.testeAprovadoEm
        || campaignData.testeTemplateAssinatura !== campaign.templateSignature
        || previewData.templateAssinatura !== campaign.templateSignature
        || campaignData.templateAssinatura !== campaign.templateSignature
        || previewData.versaoLista !== campaignData.versaoLista
        || previewData.listaHash !== campaignData.listaHash) {
        throw new HttpsError("failed-precondition", "A lista ou o template mudou depois da prévia. Gere uma nova prévia.");
      }
      const recipientIds = Array.isArray(previewData.destinatarioIds)
        ? previewData.destinatarioIds.filter((id): id is string => typeof id === "string")
        : [];
      if (!recipientIds.length || recipientIds.length > campaign.batchSize) {
        throw new HttpsError("failed-precondition", "A prévia não contém um lote válido.");
      }
      const batchId = randomUUID();
      transaction.update(previewRef, {
        status: "processando",
        loteEnvioId: batchId,
        confirmadoEm: FieldValue.serverTimestamp(),
        confirmadoPorUid: sender.uid,
      });
      return {
        campaign,
        recipientIds,
        batchId,
        listVersion: String(campaignData.versaoLista),
        group: Number(previewData.lote),
      };
    });
    const dateKey = dateKeyInSaoPaulo();
    let sent = 0;
    let skipped = 0;
    let quotaReached = false;
    const failures: {id: string; message: string}[] = [];
    for (const participantId of prepared.recipientIds) {
      const reservation = await reserveParticipant(
        prepared.campaign,
        participantId,
        prepared.batchId,
        dateKey,
        prepared.listVersion,
      );
      if (reservation.kind === "quota") { quotaReached = true; break; }
      if (reservation.kind === "skip") { skipped += 1; continue; }
      try {
        const response = await sendTemplate(prepared.campaign, reservation.nome, reservation.whatsapp);
        await saveAcceptedMessage(
          prepared.campaign,
          participantId,
          reservation.nome,
          reservation.whatsapp,
          response,
          sender,
          {
            batchId: prepared.batchId,
            group: prepared.group,
            dateKey,
            test: false,
            previewId,
          },
        );
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Não foi possível enviar a mensagem.";
        await markFailure(prepared.campaign.id, participantId, prepared.batchId, message);
        failures.push({id: participantId, message});
      }
    }
    const quota = await firestore.collection(dailyControlCollection)
      .doc(dailyControlId(prepared.campaign.id, dateKey)).get();
    await previewRef.set({
      status: "concluida",
      concluidoEm: FieldValue.serverTimestamp(),
      enviados: sent,
      ignorados: skipped,
      falhas: failures.length,
      cotaAtingida: quotaReached,
    }, {merge: true});
    return {
      previewId,
      batchId: prepared.batchId,
      campaignId: prepared.campaign.id,
      group: prepared.group,
      sent,
      skipped,
      failures,
      quotaReached,
      usedToday: quota.data()?.tentativas ?? 0,
      dailyLimit: prepared.campaign.dailyLimit,
    };
  },
);
