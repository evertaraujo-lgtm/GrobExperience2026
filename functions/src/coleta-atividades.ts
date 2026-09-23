import {createHash} from "node:crypto";

import {getFirestore, Timestamp} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/https";

const cooldownMilliseconds = 30 * 60 * 1000;
const maximumOfflineAgeMilliseconds = 30 * 24 * 60 * 60 * 1000;

export function conflictingActivityScanTime(acceptedTimes: number[], collectedAt: number): number | undefined {
  return acceptedTimes.find((time) => Math.abs(collectedAt - time) < cooldownMilliseconds);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function timestampMillis(value: unknown) {
  return value instanceof Timestamp ? value.toMillis() : 0;
}

export const registerActivityScan = onCall({region: "us-central1"}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para coletar participantes.");
  const uid = request.auth.uid;
  const data = asRecord(request.data);
  const activityId = typeof data.atividadeId === "string" ? data.atividadeId.trim() : "";
  const qrcode = typeof data.qrcode === "string" ? data.qrcode.trim() : "";
  const requestId = typeof data.registroId === "string" ? data.registroId : "";
  const collectedAt = data.coletadoNoDispositivoEm;
  const now = Date.now();
  if (!activityId || activityId.length > 200 || activityId.includes("/") || !qrcode || qrcode.length > 500 ||
      !/^leitura_[0-9a-f-]{36}$/.test(requestId) || typeof collectedAt !== "number" ||
      !Number.isSafeInteger(collectedAt) || collectedAt < now - maximumOfflineAgeMilliseconds ||
      collectedAt > now + 5 * 60 * 1000) {
    throw new HttpsError("invalid-argument", "Dados da leitura inválidos. Confira a data e a hora do aparelho.");
  }

  const firestore = getFirestore();
  const profile = await firestore.doc(`users/${uid}`).get();
  if (!profile.exists || profile.data()?.active === false || profile.data()?.roles?.admin === true ||
      profile.data()?.roles?.assistenteColeta !== true) {
    throw new HttpsError("permission-denied", "Você não tem acesso à coleta de atividades.");
  }

  const legacyId = `presenca_${createHash("sha256").update(`${activityId}:${qrcode}`).digest("hex")}`;
  const activityRef = firestore.collection("coletaAtividades").doc(activityId);
  const legacyRef = firestore.collection("coletaAtividadesRegistros").doc(legacyId);
  const controlRef = firestore.collection("coletaAtividadesControle").doc(legacyId);
  const recordRef = firestore.collection("coletaAtividadesRegistros").doc(requestId);

  return firestore.runTransaction(async (transaction) => {
    const [activity, record, control, legacy] = await Promise.all([
      transaction.get(activityRef), transaction.get(recordRef), transaction.get(controlRef), transaction.get(legacyRef),
    ]);
    if (!activity.exists || !Array.isArray(activity.get("responsavelIds")) ||
        !activity.get("responsavelIds").includes(uid)) {
      throw new HttpsError("permission-denied", "Esta atividade não está atribuída a você.");
    }
    if (record.exists) {
      if (record.get("atividadeId") !== activityId || record.get("qrcode") !== qrcode || record.get("assistenteId") !== uid) {
        throw new HttpsError("already-exists", "Identificador de leitura já utilizado.");
      }
      return {status: "aceito", registroId: requestId};
    }

    const earlierReadings = Array.isArray(control.get("leiturasEm"))
      ? (control.get("leiturasEm") as unknown[]).map(timestampMillis)
      : [];
    const acceptedTimes = [...new Set([
      ...earlierReadings,
      timestampMillis(control.get("ultimoColetadoEm")),
      timestampMillis(legacy.get("registradoEm")),
    ].filter(Boolean))].sort((left, right) => left - right);
    const conflictingTime = conflictingActivityScanTime(acceptedTimes, collectedAt);
    if (conflictingTime !== undefined) {
      return {status: "aguardar", proximaLeituraEm: new Date(conflictingTime + cooldownMilliseconds).toISOString()};
    }

    const collectedTimestamp = Timestamp.fromMillis(collectedAt);
    transaction.create(recordRef, {
      atividadeId: activityId,
      assistenteId: uid,
      qrcode,
      registradoEm: collectedTimestamp,
      sincronizadoEm: Timestamp.now(),
    });
    transaction.set(controlRef, {
      atividadeId: activityId,
      qrcode,
      ultimoColetadoEm: Timestamp.fromMillis(Math.max(collectedAt, acceptedTimes.at(-1) ?? 0)),
      leiturasEm: [...acceptedTimes, collectedAt].sort((left, right) => left - right).map((time) => Timestamp.fromMillis(time)),
      ultimoRegistroId: requestId,
    });
    return {status: "aceito", registroId: requestId};
  });
});
