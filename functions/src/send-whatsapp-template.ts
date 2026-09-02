import {createHash} from "node:crypto";

import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/https";
import {defineSecret} from "firebase-functions/params";

const metaWhatsAppAccessToken = defineSecret("META_WHATSAPP_ACCESS_TOKEN");
const phoneNumberId = "1289110394284226";
const graphVersion = "v23.0";
const templateName = "confirmar_data_participacao";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function messageEventId(messageId: string) {
  return `envio_${createHash("sha256").update(messageId).digest("hex")}`;
}

export const sendWhatsAppTemplate = onCall(
  {region: "us-central1", secrets: [metaWhatsAppAccessToken]},
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para enviar mensagens.");

    const firestore = getFirestore();
    const senderRef = firestore.collection("users").doc(request.auth.uid);
    const sender = await senderRef.get();
    const senderData = sender.data();
    const isAdmin = sender.exists && senderData?.active !== false && senderData?.roles?.admin === true;
    if (!isAdmin) throw new HttpsError("permission-denied", "Somente administradores podem enviar pela API.");

    const data = asRecord(request.data);
    const requestedParticipantId = typeof data.preInscritoId === "string" ? data.preInscritoId.replace(/\D/g, "") : "";
    if (requestedParticipantId.length < 10 || requestedParticipantId.length > 11) {
      throw new HttpsError("invalid-argument", "Pré-inscrito inválido.");
    }

    const participantRef = firestore.collection("preInscritos").doc(requestedParticipantId);
    const participant = await participantRef.get();
    if (!participant.exists) throw new HttpsError("not-found", "Pré-inscrito não encontrado.");

    const participantData = participant.data() ?? {};
    const nome = typeof participantData.nome === "string" && participantData.nome.trim()
      ? participantData.nome.trim()
      : "participante";
    const link = typeof participantData.linkPublico === "string" ? participantData.linkPublico : "";
    if (!link) throw new HttpsError("failed-precondition", "Este pré-inscrito não possui link de confirmação.");

    const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${metaWhatsAppAccessToken.value()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: `55${requestedParticipantId}`,
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
    const metaResponse = asRecord(await response.json());
    if (!response.ok) {
      const error = asRecord(metaResponse.error);
      console.error("A Meta recusou o envio do template.", {code: error.code, type: error.type});
      throw new HttpsError("internal", "A Meta recusou o envio do template. Confira o template e tente novamente.");
    }

    const messages = Array.isArray(metaResponse.messages) ? metaResponse.messages : [];
    const message = asRecord(messages[0]);
    const messageId = typeof message.id === "string" ? message.id : "";
    if (!messageId) throw new HttpsError("internal", "A Meta não retornou o identificador da mensagem.");

    const senderName = typeof senderData?.name === "string" ? senderData.name : null;
    const senderEmail = typeof senderData?.email === "string" ? senderData.email : request.auth.token.email ?? null;
    const sentAt = FieldValue.serverTimestamp();
    const batch = firestore.batch();
    batch.set(firestore.collection("whatsappMensagens").doc(messageId), {
      preInscritoId: participant.id,
      destinatarioWhatsApp: requestedParticipantId,
      template: templateName,
      status: "aceito",
      statusMeta: typeof message.message_status === "string" ? message.message_status : "accepted",
      enviadoPorUid: request.auth.uid,
      enviadoPorNome: senderName,
      enviadoPorEmail: senderEmail,
      solicitadoEm: sentAt,
    }, {merge: true});
    batch.set(firestore.collection("whatsappEventos").doc(messageEventId(messageId)), {
      tipo: "envio",
      messageId,
      preInscritoId: participant.id,
      whatsapp: requestedParticipantId,
      template: templateName,
      enviadoPorUid: request.auth.uid,
      enviadoPorNome: senderName,
      enviadoPorEmail: senderEmail,
      ocorridoEm: sentAt,
      registradoEm: FieldValue.serverTimestamp(),
    }, {merge: true});
    batch.set(participantRef, {
      ultimaMensagemWhatsAppId: messageId,
      ultimoEnvioWhatsAppPorUid: request.auth.uid,
      ultimoEnvioWhatsAppPorNome: senderName,
      ultimoEnvioWhatsAppPorEmail: senderEmail,
      ultimoEnvioWhatsAppEm: sentAt,
      primeiroEnvioWhatsAppEm: participantData.primeiroEnvioWhatsAppEm ?? sentAt,
      templateWhatsApp: templateName,
    }, {merge: true});
    await batch.commit();

    return {messageId, status: message.message_status ?? "accepted"};
  },
);
