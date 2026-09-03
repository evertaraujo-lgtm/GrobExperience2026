import {createHash, randomUUID} from "node:crypto";

import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {defineSecret} from "firebase-functions/params";
import {HttpsError, onCall} from "firebase-functions/https";

const fourEventsToken = defineSecret("FOUR_EVENTS_TOKEN");
const metaWhatsAppAccessToken = defineSecret("META_WHATSAPP_ACCESS_TOKEN");
const endpoint = "https://api.4.events/attendees/2/search";
const phoneNumberId = "1289110394284226";
const graphVersion = "v23.0";
const templateName = "notificacao_presenca_wpp";

type ApiAttendee = {
  id4Events: string | null;
  qrCode: string;
  email: string;
  nome: string | null;
  dataParticipacao: string | null;
  presente: boolean | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function firstText(data: Record<string, unknown>, keys: string[]) {
  const value = keys.map((key) => data[key]).find((item) => typeof item === "string" || typeof item === "number");
  return value === undefined ? null : String(value);
}

function attendance(value: unknown): boolean | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) { const found = attendance(item); if (found !== undefined) return found; }
    return undefined;
  }
  const data = value as Record<string, unknown>;
  if (data.attendee_attending_event === true || data.attendee_attending_event === "1") return true;
  if (data.attendee_attending_event === false || data.attendee_attending_event === "0") return false;
  for (const item of Object.values(data)) { const found = attendance(item); if (found !== undefined) return found; }
  return undefined;
}

function recordsWithQrCode(value: unknown, found: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => recordsWithQrCode(item, found));
    return found;
  }
  if (!value || typeof value !== "object") return found;
  const data = value as Record<string, unknown>;
  const qrCode = firstText(data, ["qrcode", "qr_code", "qrCode", "attendee_qrcode", "attendee_qr_code"]);
  if (qrCode) found.push(data);
  Object.values(data).forEach((item) => recordsWithQrCode(item, found));
  return found;
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function phoneWithoutCountry(value: unknown) {
  let phone = typeof value === "string" ? value.replace(/D/g, "") : "";
  if (phone.startsWith("55") && (phone.length === 12 || phone.length === 13)) phone = phone.slice(2);
  return phone;
}

function coordinatorDestination(value: unknown) {
  const phone = phoneWithoutCountry(value);
  return phone.length === 10 || phone.length === 11 ? `55${phone}` : "";
}

function documentId(values: string[]) {
  return createHash("sha256").update(values.join("|")).digest("hex");
}

function eventId(messageId: string) {
  return `envio_${createHash("sha256").update(messageId).digest("hex")}`;
}

function apiAttendees(payload: unknown, referenceEmail: string): ApiAttendee[] {
  const unique = new Map<string, ApiAttendee>();
  for (const data of recordsWithQrCode(payload)) {
    const qrCode = firstText(data, ["qrcode", "qr_code", "qrCode", "attendee_qrcode", "attendee_qr_code"]);
    if (!qrCode) continue;
    const email = normalizeEmail(firstText(data, ["email", "attendee_email", "attendeeEmail"])) || referenceEmail;
    const attendee: ApiAttendee = {
      id4Events: firstText(data, ["id", "attendee_id", "attendeeId"]),
      qrCode,
      email,
      nome: firstText(data, ["name", "nome", "attendee_name", "attendee_full_name"]),
      dataParticipacao: firstText(data, ["date", "event_date", "attendee_date", "attendee_event_date", "date_event", "eventDate"]),
      presente: attendance(data) ?? null,
    };
    unique.set(documentId([attendee.email, attendee.qrCode, attendee.dataParticipacao ?? ""]), attendee);
  }
  return [...unique.values()];
}

async function query4EventsByEmail(email: string) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {Authorization: `Bearer ${fourEventsToken.value()}`, "Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({search_by: email, page_size: "100", page: "1", get_type: "", status: ""}),
  });
  if (!response.ok) throw new HttpsError("internal", `A 4 Events retornou erro ${response.status}.`);
  return response.json();
}

async function sendPresenceTemplate(to: string, coordinator: string, visitor: string, company: string, visitorPhone: string) {
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {Authorization: `Bearer ${metaWhatsAppAccessToken.value()}`, "Content-Type": "application/json"},
    body: JSON.stringify({
      messaging_product: "whatsapp", to, type: "template",
      template: {
        name: templateName, language: {code: "en"},
        components: [{type: "body", parameters: [
          {type: "text", parameter_name: "nome", text: coordinator},
          {type: "text", parameter_name: "visitor", text: visitor},
          {type: "text", parameter_name: "empresa", text: company},
          {type: "text", parameter_name: "numero", text: visitorPhone},
        ]}],
      },
    }),
  });
  const payload = asRecord(await response.json());
  if (!response.ok) {
    const error = asRecord(payload.error);
    throw new Error(typeof error.message === "string" ? error.message : "A Meta recusou a notificação de presença.");
  }
  const message = asRecord(Array.isArray(payload.messages) ? payload.messages[0] : undefined);
  const messageId = typeof message.id === "string" ? message.id : "";
  if (!messageId) throw new Error("A Meta não retornou o identificador da mensagem.");
  return {messageId, status: typeof message.message_status === "string" ? message.message_status : "accepted"};
}

async function getAdminFirestore(request: {auth?: {uid: string}}) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para consultar a 4 Events.");
  const firestore = getFirestore();
  const user = await firestore.doc(`users/${request.auth.uid}`).get();
  if (!user.exists || user.data()?.active === false || user.data()?.roles?.admin !== true) throw new HttpsError("permission-denied", "Somente administradores podem consultar a 4 Events.");
  return firestore;
}

export const check4EventsPresence = onCall(
  {secrets: [fourEventsToken, metaWhatsAppAccessToken], timeoutSeconds: 540},
  async (request) => {
    const firestore = await getAdminFirestore(request);
    const references = await firestore.collection("visitantesEstrategicos").get();
    const attendeesByEmail = new Map<string, ApiAttendee[]>();
    let checked = 0; let attendeesSaved = 0; let notificationsSent = 0; let notificationsSkipped = 0;
    const notificationFailures: {id: string; message: string}[] = [];

    for (const reference of references.docs) {
      const email = normalizeEmail(reference.data().email);
      if (!email || attendeesByEmail.has(email)) continue;
      const attendees = apiAttendees(await query4EventsByEmail(email), email);
      attendeesByEmail.set(email, attendees);
      for (const attendee of attendees) {
        const attendeeRef = firestore.collection("visitantes4Events").doc(documentId([attendee.email, attendee.qrCode, attendee.dataParticipacao ?? ""]));
        await attendeeRef.set({...attendee, consultadoEm: FieldValue.serverTimestamp()}, {merge: true});
        attendeesSaved += 1;
      }
    }

    for (const reference of references.docs) {
      const data = reference.data();
      const email = normalizeEmail(data.email);
      const attendees = attendeesByEmail.get(email) ?? [];
      const presentAttendeeIds = attendees.filter((attendee) => attendee.presente === true)
        .map((attendee) => documentId([attendee.email, attendee.qrCode, attendee.dataParticipacao ?? ""]));
      const present = presentAttendeeIds.length > 0;
      await reference.ref.set({attendeeAttendingEvent: present, presenceCheckedAt: FieldValue.serverTimestamp()}, {merge: true});
      checked += 1;
      if (!present) continue;

      const reservationId = randomUUID();
      const notification = await firestore.runTransaction(async (transaction) => {
        const current = await transaction.get(reference.ref);
        const currentData = current.data() ?? {};
        if (currentData.presenceNotificationSentAt || currentData.presenceNotificationReservationId) return null;
        const coordinatorPhone = coordinatorDestination(currentData.whatsappCoordenador);
        const coordinator = typeof currentData.coordenador === "string" ? currentData.coordenador.trim() : "";
        const visitorName = typeof currentData.nome === "string" ? currentData.nome.trim() : "";
        const company = typeof currentData.empresa === "string" ? currentData.empresa.trim() : "";
        const visitorPhone = phoneWithoutCountry(currentData.whatsapp);
        if (!coordinatorPhone || !coordinator || !visitorName || !company || !visitorPhone) return null;
        transaction.update(reference.ref, {presenceNotificationReservationId: reservationId, presenceNotificationReservedAt: FieldValue.serverTimestamp()});
        return {coordinatorPhone, coordinator, visitorName, company, visitorPhone};
      });
      if (!notification) { notificationsSkipped += 1; continue; }
      try {
        const result = await sendPresenceTemplate(notification.coordinatorPhone, notification.coordinator, notification.visitorName, notification.company, notification.visitorPhone);
        const now = FieldValue.serverTimestamp();
        const batch = firestore.batch();
        batch.set(firestore.collection("whatsappMensagens").doc(result.messageId), {preInscritoId: null, destinatarioWhatsApp: notification.coordinatorPhone, template: templateName, categoria: "notificacao-presenca", status: "aceito", statusMeta: result.status, visitanteEstrategicoId: reference.id, visitantes4EventsIds: presentAttendeeIds, solicitadoEm: now});
        batch.set(firestore.collection("whatsappEventos").doc(eventId(result.messageId)), {tipo: "envio", messageId: result.messageId, preInscritoId: null, whatsapp: notification.coordinatorPhone, template: templateName, categoria: "notificacao-presenca", visitanteEstrategicoId: reference.id, ocorridoEm: now, registradoEm: FieldValue.serverTimestamp()});
        batch.set(reference.ref, {presenceNotificationSentAt: now, presenceNotificationMessageId: result.messageId, presenceNotificationReservationId: FieldValue.delete(), presenceNotificationReservedAt: FieldValue.delete()}, {merge: true});
        presentAttendeeIds.forEach((attendeeId) => batch.set(firestore.collection("visitantes4Events").doc(attendeeId), {notificacaoWhatsAppStatus: "aceito", notificacaoWhatsAppMensagemId: result.messageId, notificacaoWhatsAppAtualizadoEm: now}, {merge: true}));
        await batch.commit();
        notificationsSent += 1;
      } catch (error) {
        await firestore.runTransaction(async (transaction) => {
          const current = await transaction.get(reference.ref);
          if (current.data()?.presenceNotificationReservationId === reservationId) transaction.update(reference.ref, {presenceNotificationReservationId: FieldValue.delete(), presenceNotificationReservedAt: FieldValue.delete()});
        });
        await Promise.all(presentAttendeeIds.map((attendeeId) => firestore.collection("visitantes4Events").doc(attendeeId).set({notificacaoWhatsAppStatus: "falhou", notificacaoWhatsAppErro: error instanceof Error ? error.message : "Não foi possível enviar a notificação.", notificacaoWhatsAppAtualizadoEm: FieldValue.serverTimestamp()}, {merge: true})));
        notificationFailures.push({id: reference.id, message: error instanceof Error ? error.message : "Não foi possível enviar a notificação."});
      }
    }
    return {checked, attendeesSaved, notificationsSent, notificationsSkipped, notificationFailures};
  },
);

export const search4Events = onCall({secrets: [fourEventsToken]}, async (request) => {
  const firestore = await getAdminFirestore(request);
  void firestore;
  const email = typeof asRecord(request.data).email === "string" ? String(asRecord(request.data).email).trim().toLowerCase() : "";
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpsError("invalid-argument", "Informe um e-mail válido.");
  return {email, occurrences: apiAttendees(await query4EventsByEmail(email), email)};
});
