import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/https";

function normalizedSortName(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
}

async function requireAdmin(uid: string) {
  const profile = await getFirestore().collection("users").doc(uid).get();
  if (!profile.exists || profile.data()?.active === false || profile.data()?.roles?.admin !== true) {
    throw new HttpsError("permission-denied", "Somente administradores podem preparar a ordenação.");
  }
}

export const backfillPreInscritoSortOrder = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para preparar a ordenação.");
  await requireAdmin(request.auth.uid);

  const firestore = getFirestore();
  const participants = await firestore.collection("preInscritos").get();
  let batch = firestore.batch();
  let pendingOperations = 0;
  let updated = 0;

  for (const participant of participants.docs) {
    const nomeOrdenacao = normalizedSortName(participant.data().nome);
    if (participant.data().nomeOrdenacao === nomeOrdenacao) continue;

    batch.update(participant.ref, {
      nomeOrdenacao,
      nomeOrdenacaoAtualizadoEm: FieldValue.serverTimestamp(),
    });
    pendingOperations += 1;
    updated += 1;

    if (pendingOperations === 450) {
      await batch.commit();
      batch = firestore.batch();
      pendingOperations = 0;
    }
  }

  if (pendingOperations) await batch.commit();
  return {atualizados: updated, total: participants.size};
});
