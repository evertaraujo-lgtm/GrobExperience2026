import {createHash, randomUUID} from "node:crypto";

import {FieldValue, Firestore, getFirestore} from "firebase-admin/firestore";
import {defineSecret} from "firebase-functions/params";
import {HttpsError, onCall} from "firebase-functions/https";

const metaWhatsAppAccessToken = defineSecret("META_WHATSAPP_ACCESS_TOKEN");
const phoneNumberId = "1289110394284226";
const graphVersion = "v23.0";
const templateName = "lembrete_presenca";
const appLink = "https://grobexperience.web.app/baixar-app/";
const dailyLimit = 500;
const groupSize = 250;
const maximumImportSize = 10000;
const participantsCollection = "lembretePresencaParticipantes";
const messagesCollection = "lembretePresencaMensagens";
const eventsCollection = "lembretePresencaEventos";
const dailyControlCollection = "lembretePresencaControleDiario";

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
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

async function adminSender(request: {auth?: {uid: string; token: {email?: string}}}): Promise<Sender> {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para continuar.");
  const profile = await getFirestore().collection("users").doc(request.auth.uid).get();
  const data = profile.data();
  if (!profile.exists || data?.active === false || data?.roles?.admin !== true) {
    throw new HttpsError("permission-denied", "Somente administradores podem usar este envio.");
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

async function sendTemplate(nome: string, whatsapp: string, link: string) {
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
        name: templateName,
        language: {code: "en"},
        components: [{
          type: "body",
          parameters: [
            {type: "text", parameter_name: "nome", text: nome},
            {type: "text", parameter_name: "link", text: link},
          ],
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
  participantId: string | null,
  nome: string,
  whatsapp: string,
  response: {messageId: string; status: string},
  sender: Sender,
  options: {batchId: string; day: number | null; dateKey: string; test: boolean; link: string},
) {
  const firestore = getFirestore();
  const now = FieldValue.serverTimestamp();
  const batch = firestore.batch();
  batch.set(firestore.collection(messagesCollection).doc(response.messageId), {
    participanteId: participantId,
    nome,
    destinatarioWhatsApp: whatsapp,
    template: templateName,
    link: options.link,
    teste: options.test,
    dia: options.day,
    dataOperacao: options.dateKey,
    loteId: options.batchId,
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
    participanteId: participantId,
    nome,
    whatsapp,
    template: templateName,
    teste: options.test,
    dia: options.day,
    dataOperacao: options.dateKey,
    loteId: options.batchId,
    ocorridoEm: now,
    registradoEm: FieldValue.serverTimestamp(),
  });
  if (participantId) {
    batch.set(firestore.collection(participantsCollection).doc(participantId), {
      statusMensagem: "aceito",
      ultimaMensagemId: response.messageId,
      ultimoEnvioEm: now,
      statusMensagemEm: now,
      erroEnvio: FieldValue.delete(),
    }, {merge: true});
  }
  await batch.commit();
}

async function reserveParticipant(participantId: string, batchId: string, dateKey: string) {
  const firestore = getFirestore();
  const participantRef = firestore.collection(participantsCollection).doc(participantId);
  const quotaRef = firestore.collection(dailyControlCollection).doc(dateKey);
  return firestore.runTransaction(async (transaction) => {
    const [participant, quota] = await Promise.all([
      transaction.get(participantRef),
      transaction.get(quotaRef),
    ]);
    if (!participant.exists) return {kind: "skip" as const};
    const data = participant.data() ?? {};
    if (![undefined, null, "pendente", "falhou"].includes(data.statusMensagem)) return {kind: "skip" as const};
    const attempts = typeof quota.data()?.tentativas === "number" ? quota.data()?.tentativas as number : 0;
    if (attempts >= dailyLimit) return {kind: "quota" as const};
    transaction.set(quotaRef, {
      data: dateKey,
      limite: dailyLimit,
      tentativas: attempts + 1,
      atualizadoEm: FieldValue.serverTimestamp(),
    }, {merge: true});
    transaction.set(participantRef, {
      statusMensagem: "processando",
      loteId: batchId,
      reservaEm: FieldValue.serverTimestamp(),
      erroEnvio: FieldValue.delete(),
    }, {merge: true});
    return {
      kind: "reserved" as const,
      nome: typeof data.nome === "string" ? data.nome : "participante",
      whatsapp: typeof data.whatsapp === "string" ? data.whatsapp : participant.id,
      day: typeof data.dia === "number" ? data.dia : null,
    };
  });
}

async function markFailure(participantId: string, batchId: string, message: string) {
  const reference = getFirestore().collection(participantsCollection).doc(participantId);
  await getFirestore().runTransaction(async (transaction) => {
    const participant = await transaction.get(reference);
    if (participant.data()?.loteId !== batchId) return;
    transaction.set(reference, {
      statusMensagem: "falhou",
      erroEnvio: message,
      statusMensagemEm: FieldValue.serverTimestamp(),
    }, {merge: true});
  });
}

export const importPresenceReminderParticipants = onCall(
  {region: "us-central1", timeoutSeconds: 300},
  async (request) => {
    await adminSender(request);
    const entries = asRecord(request.data).participantes;
    if (!Array.isArray(entries) || !entries.length || entries.length > maximumImportSize) {
      throw new HttpsError("invalid-argument", `Envie entre 1 e ${maximumImportSize} participantes.`);
    }
    const unique = new Map<string, ImportedParticipant>();
    entries.map(participantInput).forEach((participant) => unique.set(participant.whatsapp, participant));
    const participants = [...unique.values()].sort((first, second) =>
      first.nomeOrdenacao.localeCompare(second.nomeOrdenacao, "pt-BR") || first.whatsapp.localeCompare(second.whatsapp));
    const firestore = getFirestore();
    const existing = await firestore.collection(participantsCollection).get();
    const existingById = new Map(existing.docs.map((document) => [document.id, document.data()]));
    const incomingIds = new Set(participants.map((participant) => participant.whatsapp));
    const operations: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
    existing.docs.filter((document) => !incomingIds.has(document.id))
      .forEach((document) => operations.push((batch) => batch.delete(document.ref)));
    participants.forEach((participant, index) => {
      const current = existingById.get(participant.whatsapp);
      const reference = firestore.collection(participantsCollection).doc(participant.whatsapp);
      const day = Math.floor(index / groupSize) + 1;
      operations.push((batch) => batch.set(reference, {
        ...participant,
        dia: day,
        ordem: index + 1,
        statusMensagem: current?.statusMensagem ?? "pendente",
        importadoEm: current?.importadoEm ?? FieldValue.serverTimestamp(),
        atualizadoEm: FieldValue.serverTimestamp(),
        importadoPor: request.auth?.uid,
      }, {merge: true}));
    });
    await commitOperations(firestore, operations);
    return {
      importados: participants.length,
      duplicadosIgnorados: entries.length - participants.length,
      removidos: existing.docs.filter((document) => !incomingIds.has(document.id)).length,
      dias: Math.ceil(participants.length / groupSize),
    };
  },
);

export const previewPresenceReminderDay = onCall({region: "us-central1"}, async (request) => {
  await adminSender(request);
  const day = Number(asRecord(request.data).dia);
  if (!Number.isInteger(day) || day < 1) throw new HttpsError("invalid-argument", "Informe um dia válido.");
  const firestore = getFirestore();
  const snapshot = await firestore.collection(participantsCollection).where("dia", "==", day).get();
  const ordered = snapshot.docs.sort((first, second) =>
    Number(first.data().ordem ?? 0) - Number(second.data().ordem ?? 0));
  const eligible = ordered.filter((document) =>
    [undefined, null, "pendente", "falhou"].includes(document.data().statusMensagem));
  const dateKey = dateKeyInSaoPaulo();
  const quota = await firestore.collection(dailyControlCollection).doc(dateKey).get();
  const usedToday = typeof quota.data()?.tentativas === "number" ? quota.data()?.tentativas as number : 0;
  const availableToday = Math.max(0, dailyLimit - usedToday);
  const recipients = eligible.slice(0, availableToday).map((document) => ({
    id: document.id,
    nome: document.data().nome,
    whatsapp: document.data().whatsapp,
    ordem: document.data().ordem,
    status: document.data().statusMensagem ?? "pendente",
  }));
  return {
    day,
    dateKey,
    totalInDay: ordered.length,
    eligibleTotal: eligible.length,
    skipped: ordered.length - eligible.length,
    recipients,
    notIncludedByLimit: Math.max(0, eligible.length - recipients.length),
    usedToday,
    availableToday,
    dailyLimit,
  };
});

export const sendPresenceReminderDay = onCall(
  {region: "us-central1", secrets: [metaWhatsAppAccessToken], timeoutSeconds: 540},
  async (request) => {
    const sender = await adminSender(request);
    const day = Number(asRecord(request.data).dia);
    if (!Number.isInteger(day) || day < 1) throw new HttpsError("invalid-argument", "Informe um dia válido.");
    const participantIdsInput = asRecord(request.data).participanteIds;
    if (!Array.isArray(participantIdsInput) || !participantIdsInput.length || participantIdsInput.length > groupSize
      || participantIdsInput.some((id) => typeof id !== "string" || !/^\d{10,11}$/.test(id))) {
      throw new HttpsError("invalid-argument", "Gere a prévia obrigatória antes de confirmar o envio.");
    }
    const participantIds = [...new Set(participantIdsInput as string[])];
    const firestore = getFirestore();
    const selected = await firestore.getAll(...participantIds.map((id) =>
      firestore.collection(participantsCollection).doc(id)));
    const participants = selected.filter((document) => document.exists && document.data()?.dia === day).sort((first, second) =>
      Number(first.data()?.ordem ?? 0) - Number(second.data()?.ordem ?? 0));
    if (participants.length !== participantIds.length) {
      throw new HttpsError("failed-precondition", "A lista mudou depois da prévia. Gere uma nova prévia antes de enviar.");
    }
    const batchId = randomUUID();
    const dateKey = dateKeyInSaoPaulo();
    let sent = 0;
    let skipped = 0;
    let quotaReached = false;
    const failures: {id: string; message: string}[] = [];
    for (const participant of participants) {
      const reservation = await reserveParticipant(participant.id, batchId, dateKey);
      if (reservation.kind === "quota") { quotaReached = true; break; }
      if (reservation.kind === "skip") { skipped += 1; continue; }
      try {
        const response = await sendTemplate(reservation.nome, reservation.whatsapp, appLink);
        await saveAcceptedMessage(participant.id, reservation.nome, reservation.whatsapp, response, sender, {
          batchId, day, dateKey, test: false, link: appLink,
        });
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Não foi possível enviar a mensagem.";
        await markFailure(participant.id, batchId, message);
        failures.push({id: participant.id, message});
      }
    }
    const quota = await firestore.collection(dailyControlCollection).doc(dateKey).get();
    return {
      batchId,
      day,
      dateKey,
      sent,
      skipped,
      failures,
      quotaReached,
      usedToday: quota.data()?.tentativas ?? 0,
      dailyLimit,
    };
  },
);

export const sendPresenceReminderTest = onCall(
  {region: "us-central1", secrets: [metaWhatsAppAccessToken]},
  async (request) => {
    const sender = await adminSender(request);
    const input = asRecord(request.data);
    const nome = typeof input.nome === "string" ? input.nome.trim().replace(/\s+/g, " ") : "";
    const whatsapp = normalizedPhone(input.whatsapp);
    if (!nome || whatsapp.length < 10 || whatsapp.length > 11) {
      throw new HttpsError("invalid-argument", "Informe nome e WhatsApp com DDD para o teste.");
    }
    const response = await sendTemplate(nome, whatsapp, appLink);
    const batchId = `teste_${randomUUID()}`;
    await saveAcceptedMessage(null, nome, whatsapp, response, sender, {
      batchId,
      day: null,
      dateKey: dateKeyInSaoPaulo(),
      test: true,
      link: appLink,
    });
    return {messageId: response.messageId, status: response.status, template: templateName, link: appLink};
  },
);
