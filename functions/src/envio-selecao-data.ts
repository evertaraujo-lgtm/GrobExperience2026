import {createHash, randomUUID} from "node:crypto";

import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/https";
import {defineSecret} from "firebase-functions/params";

const metaWhatsAppAccessToken = defineSecret("META_WHATSAPP_ACCESS_TOKEN");
const phoneNumberId = "1289110394284226";
const graphVersion = "v23.0";
const templateName = "selecao_de_data";
const marketingMessageCostCents = 34;

type Sender = {uid: string; name: string | null; email: string | null};
type Recipient = {id: string; nome: string; whatsapp: string};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function eventId(messageId: string) {
  return `envio_${createHash("sha256").update(messageId).digest("hex")}`;
}

async function admin(uid: string, email: string | undefined): Promise<Sender> {
  const profile = await getFirestore().collection("users").doc(uid).get();
  const data = profile.data();
  if (!profile.exists || data?.active === false || data?.roles?.admin !== true) {
    throw new HttpsError("permission-denied", "Somente administradores podem enviar mensagens de marketing.");
  }
  return {uid, name: typeof data.name === "string" ? data.name : null, email: typeof data.email === "string" ? data.email : email ?? null};
}

function eligible(data: Record<string, unknown>, id: string): Recipient | null {
  const nome = typeof data.nome === "string" ? data.nome.trim() : "";
  const whatsapp = typeof data.whatsapp === "string" ? data.whatsapp.replace(/\D/g, "") : id;
  const deliveryStatuses = ["enviado", "entregue", "lido"];
  const receivedFirstMessage = Boolean(data.primeiroEnvioWhatsAppEm || data.ultimoEnvioWhatsAppEm)
    || deliveryStatuses.includes(typeof data.statusEnvioWhatsApp === "string" ? data.statusEnvioWhatsApp : "");
  const hasSelectedDate = typeof data.dataSelecionada === "string" && data.dataSelecionada.length > 0;
  if (!receivedFirstMessage || hasSelectedDate || data.marketingSelecaoDataEnviadoEm || data.marketingSelecaoDataReservaId || !nome || whatsapp.length < 10 || whatsapp.length > 11) return null;
  return {id, nome, whatsapp};
}

async function sendTemplate(to: string, nome: string) {
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {Authorization: `Bearer ${metaWhatsAppAccessToken.value()}`, "Content-Type": "application/json"},
    body: JSON.stringify({
      messaging_product: "whatsapp", to: `55${to}`, type: "template",
      template: {
        name: templateName, language: {code: "en"},
        components: [{
          type: "body",
          parameters: [
            {type: "text", parameter_name: "nome", text: nome},
            {type: "text", parameter_name: "evento", text: "GROB Experience 2026"},
          ],
        }],
      },
    }),
  });
  const payload = asRecord(await response.json());
  if (!response.ok) {
    const error = asRecord(payload.error);
    throw new Error(typeof error.message === "string" ? error.message : "A Meta recusou o template de marketing.");
  }
  const message = asRecord(Array.isArray(payload.messages) ? payload.messages[0] : undefined);
  const messageId = typeof message.id === "string" ? message.id : "";
  if (!messageId) throw new Error("A Meta não retornou o identificador da mensagem.");
  return {messageId, status: typeof message.message_status === "string" ? message.message_status : "accepted"};
}

export const marketingMessageStats = onCall({region: "us-central1"}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para consultar o contador.");
  await admin(request.auth.uid, request.auth.token.email);
  const sent = await getFirestore().collection("whatsappMensagens").where("template", "==", templateName).count().get();
  const count = sent.data().count;
  return {count, costCents: count * marketingMessageCostCents, unitCostCents: marketingMessageCostCents};
});

export const sendSelecaoDataMarketing = onCall(
  {region: "us-central1", secrets: [metaWhatsAppAccessToken], timeoutSeconds: 300},
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para enviar mensagens.");
    const sender = await admin(request.auth.uid, request.auth.token.email);
    const id = typeof asRecord(request.data).preInscritoId === "string"
      ? String(asRecord(request.data).preInscritoId).replace(/\D/g, "") : "";
    if (id.length < 10 || id.length > 11) throw new HttpsError("invalid-argument", "Pré-inscrito inválido.");
    const reservationId = randomUUID();
    const ref = getFirestore().collection("preInscritos").doc(id);
    const recipient = await getFirestore().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const eligibleRecipient = snapshot.exists ? eligible(snapshot.data() ?? {}, snapshot.id) : null;
      if (!eligibleRecipient) return null;
      transaction.update(ref, {marketingSelecaoDataReservaId: reservationId, marketingSelecaoDataReservadoEm: FieldValue.serverTimestamp()});
      return eligibleRecipient;
    });
    if (!recipient) throw new HttpsError("failed-precondition", "Este pré-inscrito não está elegível para o template de marketing.");
    try {
      const result = await sendTemplate(recipient.whatsapp, recipient.nome);
      const now = FieldValue.serverTimestamp();
      const firestore = getFirestore(); const batch = firestore.batch();
      batch.set(firestore.collection("whatsappMensagens").doc(result.messageId), {preInscritoId: id, destinatarioWhatsApp: recipient.whatsapp, template: templateName, categoria: "marketing", custoCentavos: marketingMessageCostCents, status: "aceito", statusMeta: result.status, enviadoPorUid: sender.uid, enviadoPorNome: sender.name, enviadoPorEmail: sender.email, solicitadoEm: now});
      batch.set(firestore.collection("whatsappEventos").doc(eventId(result.messageId)), {tipo: "envio", messageId: result.messageId, preInscritoId: id, whatsapp: recipient.whatsapp, template: templateName, categoria: "marketing", custoCentavos: marketingMessageCostCents, enviadoPorUid: sender.uid, enviadoPorNome: sender.name, enviadoPorEmail: sender.email, ocorridoEm: now, registradoEm: FieldValue.serverTimestamp()});
      batch.set(ref, {marketingSelecaoDataEnviadoEm: now, marketingSelecaoDataMensagemId: result.messageId, marketingSelecaoDataCustoCentavos: marketingMessageCostCents, marketingSelecaoDataReservaId: FieldValue.delete(), marketingSelecaoDataReservadoEm: FieldValue.delete(), ultimaMensagemWhatsAppId: result.messageId, ultimoEnvioWhatsAppEm: now, templateWhatsApp: templateName, statusEnvioWhatsApp: "aceito", statusEnvioWhatsAppEm: now}, {merge: true});
      await batch.commit();
      return {messageId: result.messageId, status: result.status};
    } catch (error) {
      await getFirestore().runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (snapshot.data()?.marketingSelecaoDataReservaId === reservationId) {
          transaction.update(ref, {marketingSelecaoDataReservaId: FieldValue.delete(), marketingSelecaoDataReservadoEm: FieldValue.delete()});
        }
      });
      throw new HttpsError("internal", error instanceof Error ? error.message : "Não foi possível enviar a mensagem.");
    }
  },
);
