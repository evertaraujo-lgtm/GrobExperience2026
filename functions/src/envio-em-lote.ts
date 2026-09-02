import {randomUUID, createHash} from "node:crypto";

import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/https";
import {defineSecret} from "firebase-functions/params";

const metaWhatsAppAccessToken = defineSecret("META_WHATSAPP_ACCESS_TOKEN");
const phoneNumberId = "1289110394284226";
const graphVersion = "v23.0";
const templateName = "confirmar_data_participacao";
const maximumBatchSize = 50;

type Sender = {
  uid: string;
  name: string | null;
  email: string | null;
};

type Recipient = {
  id: string;
  nome: string;
  whatsapp: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function messageEventId(messageId: string) {
  return `envio_${createHash("sha256").update(messageId).digest("hex")}`;
}

function requestedLimit(value: unknown) {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1 || value > maximumBatchSize) {
    throw new HttpsError("invalid-argument", `Informe uma quantidade entre 1 e ${maximumBatchSize}.`);
  }
  return value;
}

async function getAdminSender(uid: string, email: string | undefined): Promise<Sender> {
  const profile = await getFirestore().collection("users").doc(uid).get();
  const data = profile.data();
  if (!profile.exists || data?.active === false || data?.roles?.admin !== true) {
    throw new HttpsError("permission-denied", "Somente administradores podem enviar mensagens pela API.");
  }
  return {
    uid,
    name: typeof data.name === "string" ? data.name : null,
    email: typeof data.email === "string" ? data.email : email ?? null,
  };
}

function isPending(data: Record<string, unknown>) {
  return !data.statusEnvioWhatsApp || data.statusEnvioWhatsApp === "pendente";
}

async function pendingRecipients(limit: number): Promise<Recipient[]> {
  const participants = await getFirestore().collection("preInscritos").orderBy("nomeOrdenacao").get();
  const recipients: Recipient[] = [];

  for (const participant of participants.docs) {
    const data = participant.data();
    const nome = typeof data.nome === "string" ? data.nome.trim() : "";
    const whatsapp = typeof data.whatsapp === "string" ? data.whatsapp.replace(/\D/g, "") : participant.id;
    if (!isPending(data) || !nome || whatsapp.length < 10 || whatsapp.length > 11) continue;
    recipients.push({id: participant.id, nome, whatsapp});
    if (recipients.length === limit) break;
  }
  return recipients;
}

function requestedIds(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > maximumBatchSize) {
    throw new HttpsError("invalid-argument", `Envie entre 1 e ${maximumBatchSize} pré-inscritos.`);
  }
  const ids = value.map((id) => typeof id === "string" ? id.replace(/\D/g, "") : "");
  if (ids.some((id) => id.length < 10 || id.length > 11) || new Set(ids).size !== ids.length) {
    throw new HttpsError("invalid-argument", "A lista de pré-inscritos é inválida.");
  }
  return ids;
}

async function reserveRecipient(id: string, batchId: string) {
  const firestore = getFirestore();
  const reference = firestore.collection("preInscritos").doc(id);
  return firestore.runTransaction(async (transaction) => {
    const participant = await transaction.get(reference);
    if (!participant.exists || !isPending(participant.data() ?? {})) return null;
    const data = participant.data() ?? {};
    const nome = typeof data.nome === "string" && data.nome.trim() ? data.nome.trim() : "participante";
    const link = typeof data.linkPublico === "string" ? data.linkPublico : "";
    if (!link) {
      transaction.update(reference, {
        statusEnvioWhatsApp: "falhou",
        erroEnvioWhatsApp: "Pré-inscrito sem link de confirmação.",
        statusEnvioWhatsAppEm: FieldValue.serverTimestamp(),
      });
      return null;
    }
    transaction.update(reference, {
      statusEnvioWhatsApp: "processando",
      loteEnvioWhatsAppId: batchId,
      reservaEnvioWhatsAppEm: FieldValue.serverTimestamp(),
      erroEnvioWhatsApp: FieldValue.delete(),
    });
    return {reference, nome, link};
  });
}

async function markFailure(id: string, batchId: string, message: string) {
  const firestore = getFirestore();
  const reference = firestore.collection("preInscritos").doc(id);
  await firestore.runTransaction(async (transaction) => {
    const participant = await transaction.get(reference);
    if (participant.data()?.loteEnvioWhatsAppId !== batchId) return;
    transaction.update(reference, {
      statusEnvioWhatsApp: "falhou",
      erroEnvioWhatsApp: message,
      statusEnvioWhatsAppEm: FieldValue.serverTimestamp(),
    });
  });
}

async function sendTemplate(id: string, nome: string, link: string) {
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${metaWhatsAppAccessToken.value()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: `55${id}`,
      type: "template",
      template: {
        name: templateName,
        language: {code: "en"},
        components: [{
          type: "body",
          parameters: [
            {type: "text", parameter_name: "nome", text: nome},
            {type: "text", parameter_name: "evento", text: "GROB Experience 2026"},
            {type: "text", parameter_name: "link", text: link},
          ],
        }],
      },
    }),
  });
  const payload = asRecord(await response.json());
  if (!response.ok) {
    const error = asRecord(payload.error);
    const detail = typeof error.message === "string" ? error.message : "A Meta recusou o envio do template.";
    throw new Error(detail);
  }
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const message = asRecord(messages[0]);
  const messageId = typeof message.id === "string" ? message.id : "";
  if (!messageId) throw new Error("A Meta não retornou o identificador da mensagem.");
  return {messageId, status: typeof message.message_status === "string" ? message.message_status : "accepted"};
}

async function saveAcceptedMessage(id: string, messageId: string, metaStatus: string, batchId: string, sender: Sender) {
  const firestore = getFirestore();
  const sentAt = FieldValue.serverTimestamp();
  const batch = firestore.batch();
  batch.set(firestore.collection("whatsappMensagens").doc(messageId), {
    preInscritoId: id,
    destinatarioWhatsApp: id,
    template: templateName,
    status: "aceito",
    statusMeta: metaStatus,
    loteEnvioWhatsAppId: batchId,
    enviadoPorUid: sender.uid,
    enviadoPorNome: sender.name,
    enviadoPorEmail: sender.email,
    solicitadoEm: sentAt,
  }, {merge: true});
  batch.set(firestore.collection("whatsappEventos").doc(messageEventId(messageId)), {
    tipo: "envio",
    messageId,
    preInscritoId: id,
    whatsapp: id,
    template: templateName,
    loteEnvioWhatsAppId: batchId,
    enviadoPorUid: sender.uid,
    enviadoPorNome: sender.name,
    enviadoPorEmail: sender.email,
    ocorridoEm: sentAt,
    registradoEm: FieldValue.serverTimestamp(),
  }, {merge: true});
  batch.set(firestore.collection("preInscritos").doc(id), {
    statusEnvioWhatsApp: "aceito",
    ultimaMensagemWhatsAppId: messageId,
    ultimoEnvioWhatsAppPorUid: sender.uid,
    ultimoEnvioWhatsAppPorNome: sender.name,
    ultimoEnvioWhatsAppPorEmail: sender.email,
    ultimoEnvioWhatsAppEm: sentAt,
    primeiroEnvioWhatsAppEm: sentAt,
    statusEnvioWhatsAppEm: sentAt,
    templateWhatsApp: templateName,
  }, {merge: true});
  await batch.commit();
}

export const previewWhatsAppBatch = onCall({region: "us-central1"}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para visualizar o lote.");
  await getAdminSender(request.auth.uid, request.auth.token.email);
  const limit = requestedLimit(asRecord(request.data).limit);
  return {recipients: await pendingRecipients(limit)};
});

export const sendWhatsAppBatch = onCall(
  {region: "us-central1", secrets: [metaWhatsAppAccessToken], timeoutSeconds: 300},
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para enviar mensagens.");
    const sender = await getAdminSender(request.auth.uid, request.auth.token.email);
    const ids = requestedIds(asRecord(request.data).preInscritoIds);
    const batchId = randomUUID();
    let sent = 0;
    let skipped = 0;
    const failures: {id: string; message: string}[] = [];

    for (const id of ids) {
      const reservation = await reserveRecipient(id, batchId);
      if (!reservation) {
        skipped += 1;
        continue;
      }
      try {
        const response = await sendTemplate(id, reservation.nome, reservation.link);
        await saveAcceptedMessage(id, response.messageId, response.status, batchId, sender);
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Não foi possível enviar a mensagem.";
        console.error("Falha no envio em lote do WhatsApp.", {preInscritoId: id, message});
        await markFailure(id, batchId, message);
        failures.push({id, message});
      }
    }
    return {batchId, sent, skipped, failures};
  },
);
