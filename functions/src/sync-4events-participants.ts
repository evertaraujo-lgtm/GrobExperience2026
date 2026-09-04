import {createHash} from "node:crypto";

import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {defineSecret} from "firebase-functions/params";
import {HttpsError, onCall} from "firebase-functions/https";

const fourEventsToken = defineSecret("FOUR_EVENTS_TOKEN");

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function firstText(data: Record<string, unknown>, keys: string[]) {
  const value = keys.map((key) => data[key]).find((item) => typeof item === "string" || typeof item === "number");
  return value === undefined ? "" : String(value).trim();
}
function attendance(value: unknown): boolean | null {
  if (value === true || value === "1" || value === 1) return true;
  if (value === false || value === "0" || value === 0) return false;
  return null;
}
function participantRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.map(asRecord).filter((item) => Object.keys(item).length);
  const data = asRecord(payload);
  for (const key of ["data", "participants", "attendees", "certificates", "results", "items"]) {
    if (Array.isArray(data[key])) return (data[key] as unknown[]).map(asRecord).filter((item) => Object.keys(item).length);
  }
  return [];
}
function safeData(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(safeData);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, safeData(item)]));
  return String(value ?? "");
}
function documentId(eid: string, participant: Record<string, unknown>) {
  const stableValue = firstText(participant, ["id", "certificate_id", "certificateId", "attendee_id", "attendeeId", "participant_id", "participantId", "qrcode", "qr_code", "qrCode", "attendee_qrcode", "attendee_qr_code"]) || JSON.stringify(safeData(participant));
  return createHash("sha256").update(`${eid}|${stableValue}`).digest("hex");
}
async function requireAdmin(uid: string) {
  const firestore = getFirestore();
  const user = await firestore.doc(`users/${uid}`).get();
  if (!user.exists || user.data()?.active === false || user.data()?.roles?.admin !== true) throw new HttpsError("permission-denied", "Somente administradores podem importar participantes da 4 Events.");
  return firestore;
}

async function searchAttendees(eid: string, page: number) {
  const form = new FormData();
  form.append("search_by", "");
  form.append("page_size", "100");
  form.append("page", String(page));
  form.append("get_type", "");
  form.append("status", "");
  const response = await fetch(`https://api.4.events/attendees/${encodeURIComponent(eid)}/search`, {
    method: "POST",
    headers: {Authorization: `Bearer ${fourEventsToken.value()}`, Accept: "multipart/form-data"},
    body: form,
  });
  if (!response.ok) throw new HttpsError("internal", `A 4 Events retornou erro ${response.status} ao consultar participantes.`);
  return participantRecords(await response.json());
}

export const sync4EventsParticipants = onCall({secrets: [fourEventsToken], timeoutSeconds: 540}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para importar participantes.");
  const suppliedEid = asRecord(request.data).eid;
  const eid = typeof suppliedEid === "string" || typeof suppliedEid === "number" ? String(suppliedEid).trim() : "";
  if (!/^\d+$/.test(eid)) throw new HttpsError("invalid-argument", "Informe um EID numérico válido.");
  const participants: Record<string, unknown>[] = [];
  for (let page = 1; page <= 1000; page += 1) {
    const pageParticipants = await searchAttendees(eid, page);
    participants.push(...pageParticipants);
    if (pageParticipants.length < 100) break;
  }
  const firestore = await requireAdmin(request.auth.uid);
  let batch = firestore.batch(); let operations = 0;
  for (const source of participants) {
    const record = {
      eid,
      id4Events: firstText(source, ["id", "certificate_id", "certificateId", "attendee_id", "attendeeId", "participant_id", "participantId"]),
      nome: firstText(source, ["name", "nome", "full_name", "attendee_name", "attendee_full_name", "participant_name"]),
      email: firstText(source, ["email", "attendee_email", "attendeeEmail", "participant_email"]).toLowerCase(),
      whatsapp: firstText(source, ["whatsapp", "phone", "cellphone", "mobile", "attendee_phone", "attendee_whatsapp"]).replace(/\D/g, ""),
      empresa: firstText(source, ["company", "empresa", "organization", "attendee_company", "participant_company"]),
      attendeeCat: firstText(source, ["attendee_cat", "attendeeCat"]),
      qrCode: firstText(source, ["qrcode", "qr_code", "qrCode", "attendee_qrcode", "attendee_qr_code"]),
      dataParticipacao: firstText(source, ["date", "event_date", "attendee_date", "eventDate"]),
      presente: attendance(source.attendee_attending_event ?? source.attending ?? source.present),
      dados4Events: safeData(source), atualizadoEm: FieldValue.serverTimestamp(), importadoEm: FieldValue.serverTimestamp(),
    };
    batch.set(firestore.collection("participantes4Events").doc(documentId(eid, source)), record, {merge: true});
    operations += 1;
    if (operations === 400) { await batch.commit(); batch = firestore.batch(); operations = 0; }
  }
  if (operations) await batch.commit();
  return {eid, imported: participants.length};
});
