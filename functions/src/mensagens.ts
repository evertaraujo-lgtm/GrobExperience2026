import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/https";

function isValidVariant(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.includes("{nome}")
    && value.includes("{link}");
}

async function requireAdmin(uid: string) {
  const profile = await getFirestore().collection("users").doc(uid).get();
  if (!profile.exists || profile.data()?.active === false || profile.data()?.roles?.admin !== true) {
    throw new HttpsError("permission-denied", "Somente administradores podem distribuir mensagens.");
  }
}

export const repopulatePreInscritoMessages = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Faça login para distribuir as mensagens.");
  }

  await requireAdmin(request.auth.uid);
  const firestore = getFirestore();
  const configuration = await firestore.collection("configuracoes").doc("mensagens").get();
  const variants = configuration.data()?.whatsappConviteVariantes;

  if (!Array.isArray(variants) || variants.length !== 10 || !variants.every(isValidVariant)) {
    throw new HttpsError(
      "failed-precondition",
      "Salve as 10 mensagens válidas antes de distribuí-las.",
    );
  }

  const participants = await firestore.collection("preInscritos").get();
  let batch = firestore.batch();
  let pendingOperations = 0;
  let updated = 0;

  for (const participant of participants.docs) {
    const data = participant.data();
    const variantIndex = Math.floor(Math.random() * variants.length);
    const template = variants[variantIndex];
    const name = typeof data.nome === "string" && data.nome.trim() ? data.nome.trim() : "participante";
    const link = typeof data.linkPublico === "string" ? data.linkPublico : "";
    batch.update(participant.ref, {
      mensagemWhatsApp: template.replaceAll("{nome}", name).replaceAll("{link}", link),
      mensagemVariante: variantIndex + 1,
      mensagemAtualizadaEm: FieldValue.serverTimestamp(),
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
  return {atualizados: updated};
});
