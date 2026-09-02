import {createHash, createHmac, timingSafeEqual} from "node:crypto";

import {FieldValue, Timestamp, getFirestore} from "firebase-admin/firestore";
import {defineSecret} from "firebase-functions/params";
import {onRequest} from "firebase-functions/https";

const metaAppSecret = defineSecret("META_APP_SECRET");
const metaWebhookVerifyToken = defineSecret("META_WEBHOOK_VERIFY_TOKEN");

type RequestWithRawBody = {
  get(name: string): string | undefined;
  rawBody?: Buffer;
};

const statusLabels: Record<string, string> = {
  sent: "enviado",
  delivered: "entregue",
  read: "lido",
  failed: "falhou",
  deleted: "apagado",
};

function normalizedParticipantId(value: unknown) {
  let phone = typeof value === "string" ? value.replace(/\D/g, "") : "";
  if (phone.startsWith("55") && (phone.length === 12 || phone.length === 13)) phone = phone.slice(2);
  return phone;
}

function eventTimestamp(value: unknown) {
  const seconds = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(seconds) ? Timestamp.fromMillis(seconds * 1000) : Timestamp.now();
}

function signatureIsValid(request: RequestWithRawBody) {
  const received = request.get("x-hub-signature-256");
  if (!received?.startsWith("sha256=") || !request.rawBody) return false;

  const expected = createHmac("sha256", metaAppSecret.value())
    .update(request.rawBody)
    .digest("hex");
  const receivedValue = received.slice("sha256=".length);
  if (receivedValue.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(receivedValue), Buffer.from(expected));
}

function dateFromButtonPayload(value: unknown) {
  if (typeof value !== "string") return undefined;
  const match = value.match(/^data_(\d{4})_(\d{2})_(\d{2})$/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  if (/^2026-09-(22|23|24)$/.test(value)) return value;

  // Templates de resposta rápida podem devolver o ID configurado no botão ou
  // somente o título visível para a pessoa (por exemplo, "22 de setembro").
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b22\b.*setembro/.test(normalized)) return "2026-09-22";
  if (/\b23\b.*setembro/.test(normalized)) return "2026-09-23";
  if (/\b24\b.*setembro/.test(normalized)) return "2026-09-24";
  return undefined;
}

function buttonPayloads(message: Record<string, unknown>) {
  const button = message.button as Record<string, unknown> | undefined;
  const interactive = message.interactive as Record<string, unknown> | undefined;
  const buttonReply = interactive?.button_reply as Record<string, unknown> | undefined;
  const listReply = interactive?.list_reply as Record<string, unknown> | undefined;
  return [button?.payload, button?.text, buttonReply?.id, buttonReply?.title, listReply?.id, listReply?.title]
    .filter((value): value is string => typeof value === "string");
}

function eventId(prefix: string, values: unknown[]) {
  return `${prefix}_${createHash("sha256").update(JSON.stringify(values)).digest("hex")}`;
}

async function saveStatus(status: Record<string, unknown>) {
  const messageId = typeof status.id === "string" ? status.id : "";
  if (!messageId) return;

  const statusName = typeof status.status === "string" ? status.status : "";
  const translatedStatus = (statusLabels[statusName] ?? statusName) || "desconhecido";
  const occurredAt = eventTimestamp(status.timestamp);
  const participantId = normalizedParticipantId(status.recipient_id);
  const firestore = getFirestore();
  const messageRef = firestore.collection("whatsappMensagens").doc(messageId);
  const fallbackParticipantRef = participantId
    ? firestore.collection("preInscritos").doc(participantId)
    : undefined;
  const eventRef = firestore.collection("whatsappEventos").doc(eventId("status", [
    messageId, statusName, status.timestamp, participantId,
  ]));

  await firestore.runTransaction(async (transaction) => {
    const message = await transaction.get(messageRef);
    const savedParticipantId = message.exists ? message.data()?.preInscritoId : undefined;
    const participantRef = typeof savedParticipantId === "string"
      ? firestore.collection("preInscritos").doc(savedParticipantId)
      : fallbackParticipantRef;
    const participant = participantRef ? await transaction.get(participantRef) : undefined;
    const currentTimestamp = message.exists ? message.data()?.statusAtualizadoEm : undefined;

    if (currentTimestamp instanceof Timestamp && currentTimestamp.toMillis() > occurredAt.toMillis()) return;

    const error = Array.isArray(status.errors) ? status.errors[0] as Record<string, unknown> | undefined : undefined;
    const update = {
      preInscritoId: participant?.exists ? participant.id : savedParticipantId ?? null,
      destinatarioWhatsApp: participantId || null,
      status: translatedStatus,
      statusMeta: statusName || null,
      statusAtualizadoEm: occurredAt,
      erroCodigo: typeof error?.code === "number" ? error.code : null,
      erroMensagem: typeof error?.message === "string" ? error.message : null,
    };
    transaction.set(messageRef, update, {merge: true});
    transaction.set(eventRef, {
      tipo: "status",
      messageId,
      preInscritoId: participant?.exists ? participant.id : savedParticipantId ?? null,
      whatsapp: participantId || null,
      status: translatedStatus,
      statusMeta: statusName || null,
      ocorridoEm: occurredAt,
      erroCodigo: update.erroCodigo,
      erroMensagem: update.erroMensagem,
      registradoEm: FieldValue.serverTimestamp(),
    }, {merge: true});

    const participantTimestamp = participant?.exists
      ? participant.data()?.statusEnvioWhatsAppEm
      : undefined;
    if (participant?.exists && participantRef
      && (!(participantTimestamp instanceof Timestamp) || participantTimestamp.toMillis() <= occurredAt.toMillis())) {
      const participantUpdate: Record<string, unknown> = {
        statusEnvioWhatsApp: translatedStatus,
        ultimaMensagemWhatsAppId: messageId,
        statusEnvioWhatsAppEm: occurredAt,
      };
      if (translatedStatus === "enviado") participantUpdate.whatsappEnviadoEm = occurredAt;
      if (translatedStatus === "entregue") participantUpdate.whatsappEntregueEm = occurredAt;
      if (translatedStatus === "lido") participantUpdate.whatsappLidoEm = occurredAt;
      if (translatedStatus === "falhou") {
        participantUpdate.whatsappFalhouEm = occurredAt;
        participantUpdate.erroEnvioWhatsApp = update.erroMensagem ?? "A Meta não informou o motivo.";
      }
      transaction.set(participantRef, participantUpdate, {merge: true});
    }
    const attendeeValues: unknown[] = message.exists && Array.isArray(message.data()?.visitantes4EventsIds)
      ? message.data()?.visitantes4EventsIds as unknown[]
      : [];
    const attendees = attendeeValues.filter((id): id is string => typeof id === "string");
    for (const attendeeId of attendees) {
      transaction.set(firestore.collection("visitantes4Events").doc(attendeeId), {
        notificacaoWhatsAppStatus: translatedStatus,
        notificacaoWhatsAppMensagemId: messageId,
        notificacaoWhatsAppAtualizadoEm: occurredAt,
      }, {merge: true});
    }
  });
}

async function saveIncomingMessage(message: Record<string, unknown>, contacts: Record<string, unknown>[]) {
  const messageId = typeof message.id === "string" ? message.id : "";
  if (!messageId) return;

  const participantId = normalizedParticipantId(message.from);
  const payloads = buttonPayloads(message);
  const payload = payloads[0];
  const chosenDate = payloads.map(dateFromButtonPayload).find((date): date is string => Boolean(date));
  const messageType = typeof message.type === "string" ? message.type : "desconhecido";
  const contact = contacts.find((item) => normalizedParticipantId(item.wa_id) === participantId);
  const profile = contact?.profile as Record<string, unknown> | undefined;
  const text = (message.text as Record<string, unknown> | undefined)?.body;
  const firestore = getFirestore();
  const receivedRef = firestore.collection("whatsappRecebidas").doc(messageId);
  const eventRef = firestore.collection("whatsappEventos").doc(`mensagem_${messageId}`);
  const participantRef = participantId ? firestore.collection("preInscritos").doc(participantId) : undefined;

  await firestore.runTransaction(async (transaction) => {
    const received = await transaction.get(receivedRef);
    if (received.exists) return;
    const participant = participantRef ? await transaction.get(participantRef) : undefined;
    transaction.create(receivedRef, {
      preInscritoId: participant?.exists ? participant.id : null,
      whatsapp: participantId || null,
      tipo: messageType,
      texto: typeof text === "string" ? text : null,
      resposta: typeof payload === "string" ? payload : null,
      recebidoEm: eventTimestamp(message.timestamp),
      nomePerfil: typeof profile?.name === "string" ? profile.name : null,
    });
    transaction.create(eventRef, {
      tipo: "mensagem",
      messageId,
      preInscritoId: participant?.exists ? participant.id : null,
      whatsapp: participantId || null,
      conteudoTipo: messageType,
      texto: typeof text === "string" ? text : null,
      resposta: typeof payload === "string" ? payload : null,
      ocorridoEm: eventTimestamp(message.timestamp),
      registradoEm: FieldValue.serverTimestamp(),
    });

    if (!chosenDate || !participant?.exists || !participantRef) return;
    const data = participant.data() ?? {};
    const inviteRef = typeof data.tokenPublico === "string"
      ? firestore.collection("linksPublicos").doc(data.tokenPublico)
      : undefined;
    transaction.set(participantRef, {
      dataSelecionada: chosenDate,
      status: "confirmado",
      atualizadoEm: FieldValue.serverTimestamp(),
      origemConfirmacao: "whatsapp-botao",
      confirmacaoWhatsAppEm: eventTimestamp(message.timestamp),
    }, {merge: true});
    if (inviteRef) {
      transaction.set(inviteRef, {
        dataSelecionada: chosenDate,
        status: "confirmado",
        confirmadoEm: eventTimestamp(message.timestamp),
      }, {merge: true});
    }
  });
}

export const whatsappWebhook = onRequest(
  {secrets: [metaAppSecret, metaWebhookVerifyToken]},
  async (request, response) => {
    if (request.method === "GET") {
      const mode = request.query["hub.mode"];
      const token = request.query["hub.verify_token"];
      const challenge = request.query["hub.challenge"];
      if (mode === "subscribe" && token === metaWebhookVerifyToken.value() && typeof challenge === "string") {
        response.status(200).send(challenge);
        return;
      }
      response.sendStatus(403);
      return;
    }

    if (request.method !== "POST") {
      response.set("Allow", "GET, POST").sendStatus(405);
      return;
    }
    if (!signatureIsValid(request as RequestWithRawBody)) {
      console.warn("WhatsApp webhook recusado: assinatura inválida.");
      response.sendStatus(401);
      return;
    }

    const payload = request.body as Record<string, unknown>;
    const changes: Record<string, unknown>[] = [];
    if (payload.object === "whatsapp_business_account" && Array.isArray(payload.entry)) {
      for (const entry of payload.entry as Record<string, unknown>[]) {
        if (Array.isArray(entry.changes)) changes.push(...entry.changes as Record<string, unknown>[]);
      }
    } else if (payload.field === "messages" && payload.value && typeof payload.value === "object") {
      // O botão "Teste" do painel da Meta envia somente este objeto de alteração.
      changes.push(payload);
    } else {
      console.warn("WhatsApp webhook recusado: formato de evento não reconhecido.");
      response.sendStatus(400);
      return;
    }

    let processedStatuses = 0;
    let processedMessages = 0;
    for (const change of changes) {
      if (change.field !== "messages" || !change.value || typeof change.value !== "object") continue;
      const value = change.value as Record<string, unknown>;
      const contacts = Array.isArray(value.contacts) ? value.contacts as Record<string, unknown>[] : [];
      const statuses = Array.isArray(value.statuses) ? value.statuses as Record<string, unknown>[] : [];
      const messages = Array.isArray(value.messages) ? value.messages as Record<string, unknown>[] : [];
      for (const status of statuses) await saveStatus(status);
      for (const message of messages) await saveIncomingMessage(message, contacts);
      processedStatuses += statuses.length;
      processedMessages += messages.length;
    }
    console.info("WhatsApp webhook processado.", {statuses: processedStatuses, messages: processedMessages});
    response.sendStatus(200);
  },
);
