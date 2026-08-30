import {getFirestore} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/https";

type PreInscritoInput = {
  nome?: unknown;
  whatsapp?: unknown;
};

function normalizePreInscrito(input: PreInscritoInput) {
  const nome = typeof input.nome === "string" ? input.nome.trim() : "";
  const whatsapp = typeof input.whatsapp === "string"
    ? input.whatsapp.replace(/\D/g, "")
    : "";

  if (!nome || !whatsapp) {
    throw new HttpsError(
      "invalid-argument",
      "Cada pré-inscrito precisa de nome e WhatsApp.",
    );
  }

  if (whatsapp.length < 10 || whatsapp.length > 13) {
    throw new HttpsError(
      "invalid-argument",
      "O WhatsApp deve conter apenas DDD e número.",
    );
  }

  return {nome, whatsapp};
}

export const importPreInscritos = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Faça login para importar pré-inscritos.");
  }

  const entries = request.data?.preInscritos;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new HttpsError(
      "invalid-argument",
      "Envie uma lista não vazia em preInscritos.",
    );
  }

  if (entries.length > 500) {
    throw new HttpsError("invalid-argument", "Importe no máximo 500 registros por vez.");
  }

  const preInscritos = entries.map((entry) => normalizePreInscrito(entry));
  const firestore = getFirestore();
  const batch = firestore.batch();

  for (const preInscrito of preInscritos) {
    const reference = firestore.collection("preInscritos").doc(preInscrito.whatsapp);
    batch.set(reference, {
      ...preInscrito,
      atualizadoEm: new Date(),
      importadoPor: request.auth.uid,
    }, {merge: true});
  }

  await batch.commit();
  return {importados: preInscritos.length};
});
