import {createHash} from "node:crypto";

import {FieldValue, Timestamp, getFirestore} from "firebase-admin/firestore";
import {defineSecret} from "firebase-functions/params";
import {HttpsError, onCall} from "firebase-functions/https";

const fourEventsToken = defineSecret("FOUR_EVENTS_TOKEN");
const participantComplementsCollection = "participantes4EventsComplementos";
const complementFields = ["pais", "estado", "cidade", "endereco", "empresa", "cargo", "nivel", "setorIndustrial"] as const;

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

async function requireParticipantViewer(uid: string) {
  const firestore = getFirestore();
  const [user, legacyAssistant] = await Promise.all([
    firestore.doc(`users/${uid}`).get(),
    firestore.doc(`coletaAtividadesAssistentes/${uid}`).get(),
  ]);
  const isAdmin = user.exists && user.data()?.active !== false && user.data()?.roles?.admin === true;
  const isInactiveUser = user.exists && user.data()?.active === false;
  const isActiveAssistant = (
    user.exists && user.data()?.active !== false && user.data()?.roles?.assistenteColeta === true
  ) || legacyAssistant.exists && legacyAssistant.data()?.ativo === true;

  // Usuários somente leitura podem existir apenas no Firebase Auth, sem perfil em /users.
  // A ausência desse perfil não deve retirar o acesso à consulta dos dados mascarados.
  if (isInactiveUser || (isActiveAssistant && !isAdmin)) {
    throw new HttpsError("permission-denied", "Você não tem permissão para consultar os participantes da 4 Events.");
  }
  return {firestore, isAdmin};
}

const cpfFields = new Set([
  "attendeedoc", "attendeedocument", "document", "documentnumber", "documento",
  "numerodocumento", "participantdocument", "taxid",
]);

function maskedCpf(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? `***.***.***-${digits.slice(-2).padStart(2, "*")}` : "Oculto";
}

function participantResponseValue(value: unknown, maskCpf: boolean): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map((item) => participantResponseValue(item, maskCpf));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      const isCpfField = normalizedKey.includes("cpf") || cpfFields.has(normalizedKey);
      return [key, maskCpf && isCpfField ? maskedCpf(item) : participantResponseValue(item, maskCpf)];
    }));
  }
  return value ?? null;
}

function normalizedSearch(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
}

function correlationKeys(value: Record<string, unknown>) {
  const source = {...asRecord(value.dados4Events), ...value};
  const id = firstText(source, ["idParticipante", "id4Events", "id", "certificate_id", "certificateId", "attendee_id", "attendeeId", "participant_id", "participantId"]);
  const qrCode = firstText(source, ["qrCode", "qrcode", "qr_code", "attendee_qrcode", "attendee_qr_code"]);
  const email = firstText(source, ["email", "attendee_email", "attendeeEmail", "participant_email"]).toLowerCase();
  const cpf = firstText(source, ["cpf", "attendee_doc", "document", "document_number", "tax_id"]).replace(/\D/g, "");
  return [...new Set([
    id ? `id:${id.toLowerCase()}` : "",
    qrCode ? `qr:${qrCode.toLowerCase()}` : "",
    email ? `email:${email}` : "",
    cpf ? `cpf:${cpf}` : "",
  ].filter(Boolean))];
}

function correlationDocumentId(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

function timestampMillis(value: unknown) {
  return value instanceof Timestamp ? value.toMillis() : 0;
}

async function enrichWithSpreadsheetComplements(
  firestore: FirebaseFirestore.Firestore,
  participants: Record<string, unknown>[],
) {
  const keysByParticipant = participants.map(correlationKeys);
  const references = [...new Set(keysByParticipant.flat())]
    .map((key) => firestore.collection(participantComplementsCollection).doc(correlationDocumentId(key)));
  const complements = new Map<string, Record<string, unknown>>();
  for (let index = 0; index < references.length; index += 250) {
    const snapshots = await firestore.getAll(...references.slice(index, index + 250));
    snapshots.forEach((snapshot) => {
      if (snapshot.exists) complements.set(snapshot.id, snapshot.data() ?? {});
    });
  }
  return participants.map((participant, index) => {
    const candidates = keysByParticipant[index]
      .map((key) => complements.get(correlationDocumentId(key)))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .sort((left, right) => timestampMillis(right.atualizadoEm) - timestampMillis(left.atualizadoEm));
    const complement = candidates[0];
    if (!complement) return participant;
    const supplemented = {...participant};
    complementFields.forEach((field) => {
      const item = firstText(complement, [field]);
      if (item) supplemented[field] = item;
    });
    return supplemented;
  });
}

function normalizeComplement(value: unknown, index: number) {
  const source = asRecord(value);
  const cpfDigits = firstText(source, ["cpf"]).replace(/\D/g, "");
  const identity = {
    idParticipante: firstText(source, ["idParticipante"]),
    qrCode: firstText(source, ["qrCode"]),
    email: firstText(source, ["email"]).toLowerCase(),
    cpf: cpfDigits && cpfDigits.length < 11 ? cpfDigits.padStart(11, "0") : cpfDigits,
  };
  if (identity.email && !/^\S+@\S+\.\S+$/.test(identity.email)) {
    throw new HttpsError("invalid-argument", `O e-mail da linha ${index + 1} é inválido.`);
  }
  const fields = Object.fromEntries(complementFields.map((field) => [field, firstText(source, [field])]));
  const keys = correlationKeys({...identity, ...fields});
  if (!keys.length) {
    throw new HttpsError("invalid-argument", `A linha ${index + 1} precisa de ID participante, QR Code, e-mail ou CPF.`);
  }
  if (!Object.values(fields).some(Boolean)) {
    throw new HttpsError("invalid-argument", `A linha ${index + 1} não possui dados complementares.`);
  }
  for (const [field, item] of Object.entries({...identity, ...fields})) {
    if (item.length > 500) throw new HttpsError("invalid-argument", `O campo ${field} da linha ${index + 1} é muito longo.`);
  }
  return {identity, fields, keys, documentId: correlationDocumentId(keys[0])};
}

function searchableParticipantText(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(searchableParticipantText).join(" ");
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(searchableParticipantText).join(" ");
  }
  return String(value ?? "");
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
  const firestore = await requireAdmin(request.auth.uid);
  const suppliedEid = asRecord(request.data).eid;
  const eid = typeof suppliedEid === "string" || typeof suppliedEid === "number" ? String(suppliedEid).trim() : "";
  if (!/^\d+$/.test(eid)) throw new HttpsError("invalid-argument", "Informe um EID numérico válido.");
  const participants: Record<string, unknown>[] = [];
  for (let page = 1; page <= 1000; page += 1) {
    const pageParticipants = await searchAttendees(eid, page);
    participants.push(...pageParticipants);
    if (pageParticipants.length < 100) break;
  }
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

export const import4EventsParticipantComplements = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para importar a planilha complementar.");
  const firestore = await requireAdmin(request.auth.uid);
  const supplied = asRecord(request.data);
  const entries = supplied.complementos;
  if (!Array.isArray(entries) || !entries.length) {
    throw new HttpsError("invalid-argument", "Envie uma lista não vazia em complementos.");
  }
  if (entries.length > 400) {
    throw new HttpsError("invalid-argument", "Importe no máximo 400 registros por lote.");
  }
  const importacaoId = typeof supplied.importacaoId === "string" ? supplied.importacaoId.trim().slice(0, 100) : "";
  const arquivoOrigem = typeof supplied.arquivoOrigem === "string" ? supplied.arquivoOrigem.trim().slice(0, 200) : "";
  if (!importacaoId) throw new HttpsError("invalid-argument", "Identificador de importação ausente.");

  const normalized = new Map(entries.map((entry, index) => {
    const item = normalizeComplement(entry, index);
    return [item.documentId, item];
  }));
  const references = [...normalized.keys()].map((id) => firestore.collection(participantComplementsCollection).doc(id));
  const existing = await firestore.getAll(...references);
  const batch = firestore.batch();
  let created = 0;
  let updated = 0;
  existing.forEach((snapshot, index) => {
    const item = normalized.get(references[index].id);
    if (!item) return;
    if (snapshot.exists) updated += 1; else created += 1;
    batch.set(references[index], {
      ...item.identity,
      ...item.fields,
      chavesCorrelacao: item.keys,
      chavePrincipal: item.keys[0],
      importacaoId,
      arquivoOrigem,
      importadoPor: request.auth?.uid,
      criadoEm: snapshot.exists ? snapshot.get("criadoEm") ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      atualizadoEm: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
  return {imported: normalized.size, created, updated};
});

export const list4EventsParticipants = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para consultar os participantes.");
  const {firestore, isAdmin} = await requireParticipantViewer(request.auth.uid);
  const data = asRecord(request.data);
  const requestedPageSize = Number(data.pageSize);
  const pageSize = Number.isInteger(requestedPageSize) ? Math.min(Math.max(requestedPageSize, 1), 200) : 200;
  const afterId = typeof data.afterId === "string" ? data.afterId.trim() : "";
  const initial = typeof data.initial === "string" ? data.initial.trim().toUpperCase() : "";
  const searchTerm = normalizedSearch(data.searchTerm);
  const includeTotal = data.includeTotal === true;
  if (afterId.length > 200 || afterId.includes("/")) throw new HttpsError("invalid-argument", "Cursor de paginação inválido.");
  if (initial && !/^[A-Z]$/.test(initial)) throw new HttpsError("invalid-argument", "Inicial inválida.");
  if (searchTerm.length > 120) throw new HttpsError("invalid-argument", "A busca deve ter no máximo 120 caracteres.");

  const collection = firestore.collection("participantes4Events");
  if (searchTerm) {
    let cursor = afterId ? await collection.doc(afterId).get() : null;
    if (cursor && !cursor.exists) throw new HttpsError("invalid-argument", "Cursor de paginação inválido.");
    const matches: {document: FirebaseFirestore.QueryDocumentSnapshot; data: Record<string, unknown>}[] = [];
    let nextCursor: string | null = null;
    let exhausted = false;
    const scanSize = 400;
    while (matches.length < pageSize && !exhausted) {
      let query = collection.orderBy("nome").limit(scanSize);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if (page.empty) { exhausted = true; break; }
      const enrichedPage = await enrichWithSpreadsheetComplements(firestore, page.docs.map((document) => document.data()));
      for (let index = 0; index < page.docs.length; index += 1) {
        const document = page.docs[index];
        cursor = document;
        const enriched = enrichedPage[index];
        const searchable = normalizedSearch(searchableParticipantText(enriched));
        if (searchable.includes(searchTerm)) matches.push({document, data: enriched});
        if (matches.length === pageSize) {
          const mayHaveMore = index < page.docs.length - 1 || page.size === scanSize;
          nextCursor = mayHaveMore ? document.id : null;
          break;
        }
      }
      if (matches.length === pageSize) break;
      if (page.size < scanSize) exhausted = true;
    }
    const totalSnapshot = includeTotal ? await collection.count().get() : null;
    return {
      participants: matches.map((match) => participantResponseValue(match.data, !isAdmin)),
      nextCursor,
      total: totalSnapshot?.data().count ?? null,
      filteredTotal: null,
      searchMode: true,
    };
  }

  const nextInitial = initial ? String.fromCharCode(initial.charCodeAt(0) + 1) : "";
  const filtered = initial ? collection.orderBy("nome").startAt(initial).endBefore(nextInitial) : collection.orderBy("nome");
  let snapshot;
  if (afterId) {
    const cursor = await collection.doc(afterId).get();
    if (!cursor.exists) throw new HttpsError("invalid-argument", "Cursor de paginação inválido.");
    const cursorName = String(cursor.get("nome") ?? "");
    if (initial && (cursorName < initial || cursorName >= nextInitial)) throw new HttpsError("invalid-argument", "Cursor de paginação inválido para a inicial selecionada.");
    snapshot = await filtered.startAfter(cursor).limit(pageSize).get();
  } else {
    snapshot = await filtered.limit(pageSize).get();
  }

  const [totalSnapshot, filteredTotalSnapshot] = includeTotal ? await Promise.all([
    collection.count().get(),
    initial ? filtered.count().get() : Promise.resolve(null),
  ]) : [null, null];
  const enrichedParticipants = await enrichWithSpreadsheetComplements(firestore, snapshot.docs.map((document) => document.data()));

  return {
    participants: enrichedParticipants.map((participant) => participantResponseValue(participant, !isAdmin)),
    nextCursor: snapshot.size === pageSize ? snapshot.docs.at(-1)?.id ?? null : null,
    total: totalSnapshot?.data().count ?? null,
    filteredTotal: filteredTotalSnapshot?.data().count ?? totalSnapshot?.data().count ?? null,
  };
});
