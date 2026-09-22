import {createHash, randomUUID} from "node:crypto";

import {FieldValue, Firestore, getFirestore, Timestamp} from "firebase-admin/firestore";
import {defineSecret} from "firebase-functions/params";
import {HttpsError, onCall} from "firebase-functions/https";
import {onSchedule} from "firebase-functions/v2/scheduler";

const fourEventsToken = defineSecret("FOUR_EVENTS_TOKEN");
const grobExperienceApiKey = defineSecret("GROB_EXPERIENCE_API_KEY");
const endpoint = "https://api.4.events/attendees/2/search";
const venoEndpoint = "https://southamerica-east1-praxisagendamentos.cloudfunctions.net/sendGrobExperienceTemplate";
const templateName = "notificacao_chegada";
const automationConfigPath = "configuracoes/checagemPresenca4Events";
const allowedIntervals = [5, 10, 15, 30, 60] as const;
const executionLeaseMilliseconds = 12 * 60 * 1000;

type CheckSource = "manual" | "automatica";

type PresenceCheckResult = {
  checked: number;
  attending: number;
  attendeesSaved: number;
  notificationsSent: number;
  notificationsSkipped: number;
  notificationFailures: {id: string; message: string}[];
};

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
  let phone = typeof value === "string" ? value.replace(/\D/g, "") : "";
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

function registrationNotificationId(attendee: ApiAttendee) {
  const identity = attendee.id4Events ? `id:${attendee.id4Events}` : `qr:${attendee.qrCode}`;
  return documentId([attendee.email, identity]);
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

async function sendPresenceTemplate(to: string, coordinator: string, visitor: string, company: string, visitorPhone: string, idempotencyKey: string) {
  const response = await fetch(venoEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${grobExperienceApiKey.value()}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      template: templateName,
      idioma: "en",
      nome: coordinator,
      numero: phoneWithoutCountry(to),
      parametros: {
        "body:visitor": visitor,
        "body:empresa": company,
        "body:numero": visitorPhone,
      },
    }),
  });
  const payload = asRecord(await response.json().catch(() => ({})));
  if (!response.ok) {
    const error = typeof payload.error === "string" ? payload.error : "A VENO recusou a notificação de chegada.";
    const message = typeof payload.message === "string" && payload.message ? ` — ${payload.message}` : "";
    throw new Error(`${response.status}: ${error}${message}`);
  }
  const messageId = typeof payload.messageId === "string" ? payload.messageId : "";
  if (payload.accepted !== true || !messageId.startsWith("wamid.")) {
    throw new Error("A VENO não confirmou o envio com um identificador da Meta.");
  }
  return {messageId, status: "accepted"};
}

async function getAdminFirestore(request: {auth?: {uid: string}}) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para consultar a 4 Events.");
  const firestore = getFirestore();
  const user = await firestore.doc(`users/${request.auth.uid}`).get();
  if (!user.exists || user.data()?.active === false || user.data()?.roles?.admin !== true) throw new HttpsError("permission-denied", "Somente administradores podem consultar a 4 Events.");
  return firestore;
}

function timestamp(value: unknown) {
  return value instanceof Timestamp ? value : null;
}

async function acquirePresenceCheck(firestore: Firestore, source: CheckSource, onlyWhenDue: boolean) {
  const configRef = firestore.doc(automationConfigPath);
  const runId = randomUUID();
  const now = Timestamp.now();
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(configRef);
    const data = snapshot.data() ?? {};
    if (onlyWhenDue && data.ativa !== true) return null;
    const nextCheck = timestamp(data.proximaChecagemEm);
    if (onlyWhenDue && nextCheck && nextCheck.toMillis() > now.toMillis()) return null;
    const runningSince = timestamp(data.execucaoIniciadaEm);
    const activeLease = typeof data.execucaoId === "string" && runningSince && now.toMillis() - runningSince.toMillis() < executionLeaseMilliseconds;
    if (activeLease) return null;
    transaction.set(configRef, {
      execucaoId: runId,
      execucaoIniciadaEm: now,
      ultimaChecagemIniciadaEm: now,
      ultimaOrigem: source,
      ultimoErro: FieldValue.delete(),
    }, {merge: true});
    return runId;
  });
}

async function finishPresenceCheck(firestore: Firestore, runId: string, source: CheckSource, result?: PresenceCheckResult, error?: unknown) {
  const configRef = firestore.doc(automationConfigPath);
  const now = Timestamp.now();
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(configRef);
    const data = snapshot.data() ?? {};
    if (data.execucaoId !== runId) return;
    const interval = allowedIntervals.includes(data.intervaloMinutos) ? data.intervaloMinutos as number : 5;
    const update: Record<string, unknown> = {
      execucaoId: FieldValue.delete(),
      execucaoIniciadaEm: FieldValue.delete(),
      ultimaChecagemEm: now,
      ultimaOrigem: source,
      ultimoResultado: result ?? FieldValue.delete(),
      ultimoErro: error ? (error instanceof Error ? error.message : "Falha inesperada na checagem.") : FieldValue.delete(),
      proximaChecagemEm: data.ativa === true ? Timestamp.fromMillis(now.toMillis() + interval * 60 * 1000) : FieldValue.delete(),
    };
    transaction.set(configRef, update, {merge: true});
  });
}

async function runPresenceCheck(firestore: Firestore): Promise<PresenceCheckResult> {
    const references = await firestore.collection("visitantesEstrategicos").get();
    const attendeesByEmail = new Map<string, ApiAttendee[]>();
    let checked = 0; let attending = 0; let attendeesSaved = 0; let notificationsSent = 0; let notificationsSkipped = 0;
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
      const presentAttendees = attendees.filter((attendee) => attendee.presente === true);
      const present = presentAttendees.length > 0;
      await reference.ref.set({attendeeAttendingEvent: present, presenceCheckedAt: FieldValue.serverTimestamp()}, {merge: true});
      checked += 1;
      if (!present) continue;
      attending += 1;

      // Envios antigos eram controlados pela linha de referência, não pela inscrição.
      const legacyMessageId = typeof data.presenceNotificationMessageId === "string" ? data.presenceNotificationMessageId : "";
      const legacyMessage = legacyMessageId ? await firestore.collection("whatsappMensagens").doc(legacyMessageId).get() : null;
      const legacyAttendeeIds = new Set(Array.isArray(legacyMessage?.data()?.visitantes4EventsIds)
        ? legacyMessage.data()?.visitantes4EventsIds as string[] : []);

      for (const attendee of presentAttendees) {
        const attendeeId = documentId([attendee.email, attendee.qrCode, attendee.dataParticipacao ?? ""]);
        const attendeeRef = firestore.collection("visitantes4Events").doc(attendeeId);
        if (legacyAttendeeIds.has(attendeeId)) { notificationsSkipped += 1; continue; }
        const notificationId = registrationNotificationId(attendee);
        const notificationRef = reference.ref.collection("notificacoesChegada").doc(notificationId);
        const reservationId = randomUUID();
        const notification = await firestore.runTransaction(async (transaction) => {
          const [currentReference, currentNotification] = await Promise.all([
            transaction.get(reference.ref), transaction.get(notificationRef),
          ]);
          const currentData = currentReference.data() ?? {};
          const notificationData = currentNotification.data() ?? {};
          const reservedAt = timestamp(notificationData.reservedAt);
          const activeReservation = typeof notificationData.reservationId === "string" && reservedAt && Timestamp.now().toMillis() - reservedAt.toMillis() < executionLeaseMilliseconds;
          if (notificationData.messageId || notificationData.sentAt || activeReservation) return null;
          const coordinatorPhone = coordinatorDestination(currentData.whatsappCoordenador);
          const coordinator = typeof currentData.coordenador === "string" ? currentData.coordenador.trim() : "";
          const visitorName = typeof currentData.nome === "string" ? currentData.nome.trim() : "";
          const company = typeof currentData.empresa === "string" ? currentData.empresa.trim() : "";
          const visitorPhone = phoneWithoutCountry(currentData.whatsapp);
          if (!coordinatorPhone || !coordinator || !visitorName || !company || !visitorPhone) return null;
          transaction.set(notificationRef, {reservationId, reservedAt: Timestamp.now(), attendeeId, id4Events: attendee.id4Events}, {merge: true});
          return {coordinatorPhone, coordinator, visitorName, company, visitorPhone};
        });
        if (!notification) { notificationsSkipped += 1; continue; }
        try {
          const idempotencyKey = `notificacao_chegada_${documentId([reference.id, notificationId])}`;
          const result = await sendPresenceTemplate(notification.coordinatorPhone, notification.coordinator, notification.visitorName, notification.company, notification.visitorPhone, idempotencyKey);
          const now = FieldValue.serverTimestamp();
          const batch = firestore.batch();
          batch.set(firestore.collection("whatsappMensagens").doc(result.messageId), {preInscritoId: null, destinatarioWhatsApp: notification.coordinatorPhone, template: templateName, categoria: "notificacao-presenca", status: "aceito", statusMeta: result.status, visitanteEstrategicoId: reference.id, visitantes4EventsIds: [attendeeId], solicitadoEm: now});
          batch.set(firestore.collection("whatsappEventos").doc(eventId(result.messageId)), {tipo: "envio", messageId: result.messageId, preInscritoId: null, whatsapp: notification.coordinatorPhone, template: templateName, categoria: "notificacao-presenca", visitanteEstrategicoId: reference.id, ocorridoEm: now, registradoEm: FieldValue.serverTimestamp()});
          batch.set(notificationRef, {status: "aceito", messageId: result.messageId, sentAt: now, reservationId: FieldValue.delete(), reservedAt: FieldValue.delete(), error: FieldValue.delete()}, {merge: true});
          batch.set(attendeeRef, {notificacaoWhatsAppStatus: "aceito", notificacaoWhatsAppMensagemId: result.messageId, notificacaoWhatsAppErro: FieldValue.delete(), notificacaoWhatsAppAtualizadoEm: now}, {merge: true});
          await batch.commit();
          notificationsSent += 1;
        } catch (error) {
          await firestore.runTransaction(async (transaction) => {
            const [currentNotification, currentAttendee] = await Promise.all([
              transaction.get(notificationRef), transaction.get(attendeeRef),
            ]);
            if (currentNotification.data()?.reservationId !== reservationId) return;
            const errorMessage = error instanceof Error ? error.message : "Não foi possível enviar a notificação.";
            transaction.set(notificationRef, {status: "falhou", error: errorMessage, updatedAt: FieldValue.serverTimestamp(), reservationId: FieldValue.delete(), reservedAt: FieldValue.delete()}, {merge: true});
            if (!currentAttendee.data()?.notificacaoWhatsAppMensagemId) {
              transaction.set(attendeeRef, {notificacaoWhatsAppStatus: "falhou", notificacaoWhatsAppErro: errorMessage, notificacaoWhatsAppAtualizadoEm: FieldValue.serverTimestamp()}, {merge: true});
            }
          });
          notificationFailures.push({id: `${reference.id}/${notificationId}`, message: error instanceof Error ? error.message : "Não foi possível enviar a notificação."});
        }
      }
    }
    return {checked, attending, attendeesSaved, notificationsSent, notificationsSkipped, notificationFailures};
}

async function executeTrackedPresenceCheck(firestore: Firestore, source: CheckSource, onlyWhenDue: boolean) {
  const runId = await acquirePresenceCheck(firestore, source, onlyWhenDue);
  if (!runId) return null;
  try {
    const result = await runPresenceCheck(firestore);
    await finishPresenceCheck(firestore, runId, source, result);
    return result;
  } catch (error) {
    await finishPresenceCheck(firestore, runId, source, undefined, error);
    throw error;
  }
}

export const check4EventsPresence = onCall(
  {secrets: [fourEventsToken, grobExperienceApiKey], timeoutSeconds: 540},
  async (request) => {
    const firestore = await getAdminFirestore(request);
    const result = await executeTrackedPresenceCheck(firestore, "manual", false);
    if (!result) throw new HttpsError("aborted", "Já existe uma checagem de presença em andamento.");
    return result;
  },
);

export const configure4EventsPresenceAutomation = onCall(async (request) => {
  const firestore = await getAdminFirestore(request);
  const input = asRecord(request.data);
  const active = input.ativa === true;
  const interval = Number(input.intervaloMinutos);
  if (!allowedIntervals.includes(interval as typeof allowedIntervals[number])) {
    throw new HttpsError("invalid-argument", "Escolha um intervalo de 5, 10, 15, 30 ou 60 minutos.");
  }
  const now = Timestamp.now();
  await firestore.doc(automationConfigPath).set({
    ativa: active,
    intervaloMinutos: interval,
    proximaChecagemEm: active ? now : FieldValue.delete(),
    atualizadoEm: now,
    atualizadoPor: request.auth?.uid,
  }, {merge: true});
  return {ativa: active, intervaloMinutos: interval, proximaChecagemEm: active ? now.toMillis() : null};
});

export const scheduled4EventsPresenceCheck = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "America/Sao_Paulo",
    secrets: [fourEventsToken, grobExperienceApiKey],
    timeoutSeconds: 540,
  },
  async () => {
    const result = await executeTrackedPresenceCheck(getFirestore(), "automatica", true);
    if (result) console.log("Checagem automática da 4 Events concluída.", result);
  },
);

export const search4Events = onCall({secrets: [fourEventsToken]}, async (request) => {
  const firestore = await getAdminFirestore(request);
  void firestore;
  const email = typeof asRecord(request.data).email === "string" ? String(asRecord(request.data).email).trim().toLowerCase() : "";
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpsError("invalid-argument", "Informe um e-mail válido.");
  return {email, occurrences: apiAttendees(await query4EventsByEmail(email), email)};
});
