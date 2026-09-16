import {getAuth} from "firebase-admin/auth";
import {FieldValue, Timestamp, getFirestore} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/https";

import {find4EventsParticipantByQrCode, normalize4EventsQrCode} from "./participantes-4events.js";

type LeadField = {
  id: string;
  rotulo: string;
  tipo: "texto" | "texto-longo" | "numero" | "selecao" | "multipla-escolha" | "checkbox";
  obrigatorio: boolean;
  opcoes: string[];
  dependeDe: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isAdminProfile(profile: FirebaseFirestore.DocumentSnapshot) {
  return profile.exists && profile.data()?.active !== false && profile.data()?.roles?.admin === true;
}

function isSellerProfile(profile: FirebaseFirestore.DocumentSnapshot) {
  return profile.exists && profile.data()?.active !== false && profile.data()?.roles?.vendedor === true;
}

function isActiveLeadSeller(profile: FirebaseFirestore.DocumentSnapshot) {
  return isSellerProfile(profile);
}

async function requireAdmin(uid: string) {
  const firestore = getFirestore();
  const profile = await firestore.doc(`users/${uid}`).get();
  if (!isAdminProfile(profile)) throw new HttpsError("permission-denied", "Somente administradores podem gerenciar a coleta de leads.");
  return {firestore, profile};
}

async function requireLeadAccess(uid: string) {
  const firestore = getFirestore();
  const profile = await firestore.doc(`users/${uid}`).get();
  if (!isAdminProfile(profile) && !isActiveLeadSeller(profile)) {
    throw new HttpsError("permission-denied", "Você não tem acesso à coleta de leads.");
  }
  return {firestore, profile};
}

function serializable(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serializable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, serializable(item)]));
  }
  return value ?? null;
}

function fieldDefinitions(value: unknown): LeadField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const field = asRecord(item);
    const id = typeof field.id === "string" ? field.id.trim() : "";
    const rotulo = typeof field.rotulo === "string" ? field.rotulo.trim() : "";
    const tipo = field.tipo;
    const validType = tipo === "texto" || tipo === "texto-longo" || tipo === "numero" || tipo === "selecao" || tipo === "multipla-escolha" || tipo === "checkbox";
    if (!id || !rotulo || !validType) return [];
    return [{
      id,
      rotulo,
      tipo,
      obrigatorio: field.obrigatorio === true,
      opcoes: Array.isArray(field.opcoes) ? field.opcoes.filter((option): option is string => typeof option === "string").map((option) => option.trim()).filter(Boolean) : [],
      dependeDe: typeof field.dependeDe === "string" ? field.dependeDe.trim() : "",
    }];
  });
}

async function currentFields() {
  const snapshot = await getFirestore().doc("coletaLeadsConfiguracoes/campos").get();
  return fieldDefinitions(snapshot.data()?.campos);
}

function answersForFields(value: unknown, fields: LeadField[]) {
  const input = asRecord(value);
  const responses: Record<string, {rotulo: string; valor: string}> = {};
  const checked = (answer: unknown) => answer === true || ["true", "on", "sim", "1"].includes(String(answer ?? "").trim().toLowerCase());
  for (const field of fields) {
    const active = !field.dependeDe || checked(input[field.dependeDe]);
    const rawAnswer = active ? input[field.id] : "";
    const answer = rawAnswer === undefined || rawAnswer === null ? "" : String(rawAnswer).trim();
    if (answer.length > 2000) throw new HttpsError("invalid-argument", `A resposta de “${field.rotulo}” é muito longa.`);
    if (active && field.obrigatorio && (field.tipo === "checkbox" ? !checked(rawAnswer) : !answer)) {
      throw new HttpsError("invalid-argument", `Preencha o campo “${field.rotulo}”.`);
    }
    if ((field.tipo === "selecao" || field.tipo === "multipla-escolha") && answer && !field.opcoes.includes(answer)) {
      throw new HttpsError("invalid-argument", `A resposta de “${field.rotulo}” não é válida.`);
    }
    responses[field.id] = {rotulo: field.rotulo, valor: field.tipo === "checkbox" ? (checked(rawAnswer) ? "Sim" : "Não") : answer};
  }
  return responses;
}

function offlineParticipantValue(document: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = document.data();
  const source = asRecord(data.dados4Events);
  const text = (...keys: string[]) => {
    const value = keys.map((key) => data[key] ?? source[key]).find((item) => typeof item === "string" || typeof item === "number");
    return value === undefined ? "" : String(value).trim();
  };
  return {
    id: document.id,
    qrCode: text("qrCode", "qr_code", "qrcode"),
    nome: text("nome", "name", "full_name"),
    empresa: text("empresa", "company", "organization"),
    cargo: text("cargo", "job_title", "position", "role"),
    email: text("email", "attendee_email"),
    whatsapp: text("whatsapp", "phone", "cellphone", "mobile"),
    dataParticipacao: text("dataParticipacao", "date", "event_date"),
  };
}

export const createLeadSeller = onCall({region: "us-central1"}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para cadastrar um vendedor.");
  const {firestore} = await requireAdmin(request.auth.uid);
  const data = asRecord(request.data);
  const nome = typeof data.nome === "string" ? data.nome.trim() : "";
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  const senha = typeof data.senha === "string" ? data.senha : "";
  if (!nome) throw new HttpsError("invalid-argument", "Informe o nome do vendedor.");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpsError("invalid-argument", "Informe um e-mail válido.");

  let user;
  let created = false;
  try {
    user = await getAuth().getUserByEmail(email);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "auth/user-not-found") throw new HttpsError("internal", "Não foi possível verificar a conta do vendedor.");
    if (senha.length < 6) throw new HttpsError("invalid-argument", "Para uma nova conta, informe uma senha com ao menos 6 caracteres.");
    try {
      user = await getAuth().createUser({email, password: senha, displayName: nome});
      created = true;
    } catch (createError) {
      console.error(createError);
      throw new HttpsError("internal", "Não foi possível criar a conta do vendedor.");
    }
  }

  const profileRef = firestore.doc(`users/${user.uid}`);
  const profile = await profileRef.get();
  const roles = asRecord(profile.data()?.roles);
  await firestore.runTransaction(async (transaction) => {
    transaction.set(profileRef, {
      name: nome,
      email,
      active: true,
      roles: {...roles, vendedor: true},
      updatedAt: FieldValue.serverTimestamp(),
      ...(profile.exists ? {} : {createdAt: FieldValue.serverTimestamp()}),
    }, {merge: true});
  });
  return {uid: user.uid, nome, email, created};
});

export const removeLeadSeller = onCall({region: "us-central1"}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para remover um vendedor.");
  const {firestore} = await requireAdmin(request.auth.uid);
  const uid = typeof asRecord(request.data).uid === "string" ? String(asRecord(request.data).uid).trim() : "";
  if (!uid) throw new HttpsError("invalid-argument", "Vendedor inválido.");
  const profileRef = firestore.doc(`users/${uid}`);
  const profile = await profileRef.get();
  if (!profile.exists || profile.data()?.roles?.vendedor !== true) throw new HttpsError("not-found", "Vendedor não encontrado.");
  const roles = asRecord(profile.data()?.roles);
  delete roles.vendedor;
  await profileRef.update({roles, updatedAt: FieldValue.serverTimestamp()});
  return {removed: true};
});

export const get4EventsParticipantByQrCode = onCall({region: "us-central1"}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para consultar um participante.");
  const {firestore} = await requireLeadAccess(request.auth.uid);
  const qrCode = normalize4EventsQrCode(asRecord(request.data).qrCode);
  if (!qrCode || qrCode.length > 500) throw new HttpsError("invalid-argument", "Leia um QR Code válido.");
  const participant = await find4EventsParticipantByQrCode(firestore, qrCode);
  if (!participant) throw new HttpsError("not-found", "Participante não encontrado na base da 4 Events.");
  return {participant: {id: participant.id, ...asRecord(serializable(participant.data))}};
});

export const download4EventsParticipantIndex = onCall({region: "us-central1"}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para preparar a coleta offline.");
  const {firestore} = await requireLeadAccess(request.auth.uid);
  const data = asRecord(request.data);
  const requestedPageSize = Number(data.pageSize);
  const pageSize = Number.isInteger(requestedPageSize) ? Math.min(Math.max(requestedPageSize, 1), 300) : 300;
  const afterId = typeof data.afterId === "string" ? data.afterId.trim() : "";
  if (afterId.length > 200 || afterId.includes("/")) throw new HttpsError("invalid-argument", "Cursor de paginação inválido.");
  const collection = firestore.collection("participantes4Events");
  const ordered = collection.orderBy("__name__");
  let snapshot;
  if (afterId) {
    const cursor = await collection.doc(afterId).get();
    if (!cursor.exists) throw new HttpsError("invalid-argument", "Cursor de paginação inválido.");
    snapshot = await ordered.startAfter(cursor).limit(pageSize).get();
  } else {
    snapshot = await ordered.limit(pageSize).get();
  }
  const participants = snapshot.docs.map(offlineParticipantValue).filter((participant) => participant.qrCode);
  return {
    participants,
    nextCursor: snapshot.size === pageSize ? snapshot.docs.at(-1)?.id ?? null : null,
    total: data.includeTotal === true ? (await collection.count().get()).data().count : null,
  };
});

export const saveLead = onCall({region: "us-central1"}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para salvar um lead.");
  const userId = request.auth.uid;
  const userEmail = request.auth.token.email || "";
  const {firestore, profile} = await requireLeadAccess(userId);
  if (!isActiveLeadSeller(profile)) {
    throw new HttpsError("permission-denied", "Somente vendedores podem registrar leads.");
  }
  const data = asRecord(request.data);
  const qrCode = normalize4EventsQrCode(data.qrCode);
  if (!qrCode || qrCode.length > 500) throw new HttpsError("invalid-argument", "Leia um QR Code válido.");
  const offlineId = typeof data.offlineId === "string" ? data.offlineId.trim() : "";
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(offlineId)) throw new HttpsError("invalid-argument", "Identificador de sincronização inválido.");
  const collectedOfflineAt = typeof data.collectedOfflineAt === "number" ? data.collectedOfflineAt : null;
  if (collectedOfflineAt !== null && (!Number.isSafeInteger(collectedOfflineAt) || collectedOfflineAt < 0 || collectedOfflineAt > Date.now() + 86400000)) {
    throw new HttpsError("invalid-argument", "Data de coleta inválida.");
  }
  const participant = await find4EventsParticipantByQrCode(firestore, qrCode);
  if (!participant) throw new HttpsError("not-found", "Participante não encontrado na base da 4 Events.");
  const responses = answersForFields(data.respostas, await currentFields());
  const sellerName = profile.data()?.name || userEmail || "Vendedor";
  const reference = firestore.collection("coletaLeads").doc(`offline_${userId}_${offlineId}`);
  await firestore.runTransaction(async (transaction) => {
    if ((await transaction.get(reference)).exists) return;
    transaction.set(reference, {
      participanteId: participant.id,
      qrCode,
      participante: participant.data,
      respostas: responses,
      vendedorId: userId,
      vendedorNome: sellerName,
      vendedorEmail: userEmail || profile.data()?.email || "",
      criadoEm: FieldValue.serverTimestamp(),
      ...(collectedOfflineAt === null ? {} : {coletadoNoDispositivoEm: Timestamp.fromMillis(collectedOfflineAt)}),
    });
  });
  return {id: reference.id};
});
