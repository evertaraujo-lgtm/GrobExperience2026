import {getAuth} from "firebase-admin/auth";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/https";

function dataAsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

async function requireAdmin(uid: string) {
  const firestore = getFirestore();
  const profile = await firestore.collection("users").doc(uid).get();
  if (!profile.exists || profile.data()?.active === false || profile.data()?.roles?.admin !== true) {
    throw new HttpsError("permission-denied", "Somente administradores podem gerenciar assistentes.");
  }
  return firestore;
}

export const createCollectionAssistant = onCall({region: "us-central1"}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para cadastrar um assistente.");
  const firestore = await requireAdmin(request.auth.uid);
  const data = dataAsRecord(request.data);
  const nome = typeof data.nome === "string" ? data.nome.trim() : "";
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  const senha = typeof data.senha === "string" ? data.senha : "";
  if (!nome) throw new HttpsError("invalid-argument", "Informe o nome do assistente.");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpsError("invalid-argument", "Informe um e-mail válido.");
  if (senha.length < 6) throw new HttpsError("invalid-argument", "A senha precisa ter ao menos 6 caracteres.");

  let user;
  try {
    user = await getAuth().createUser({email, password: senha, displayName: nome});
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "auth/email-already-exists") throw new HttpsError("already-exists", "Já existe uma conta com este e-mail.");
    throw new HttpsError("internal", "Não foi possível criar a conta do assistente.");
  }
  await firestore.collection("coletaAtividadesAssistentes").doc(user.uid).set({
    nome, email, ativo: true, criadoEm: FieldValue.serverTimestamp(), criadoPorUid: request.auth.uid,
  });
  return {uid: user.uid, nome, email};
});

export const removeCollectionAssistant = onCall({region: "us-central1"}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para remover um assistente.");
  const firestore = await requireAdmin(request.auth.uid);
  const uid = typeof dataAsRecord(request.data).uid === "string" ? String(dataAsRecord(request.data).uid) : "";
  if (!uid) throw new HttpsError("invalid-argument", "Assistente inválido.");
  const assistantRef = firestore.collection("coletaAtividadesAssistentes").doc(uid);
  const assistant = await assistantRef.get();
  if (!assistant.exists) throw new HttpsError("not-found", "Assistente não encontrado.");
  const activities = await firestore.collection("coletaAtividades").where("responsavelIds", "array-contains", uid).get();
  try {
    await getAuth().deleteUser(uid);
  } catch (error) {
    console.error("Não foi possível remover a conta de autenticação do assistente.", error);
    throw new HttpsError("internal", "Não foi possível revogar o acesso do assistente.");
  }
  const batch = firestore.batch();
  activities.docs.forEach((activity) => batch.update(activity.ref, {responsavelIds: FieldValue.arrayRemove(uid), atualizadoEm: FieldValue.serverTimestamp()}));
  batch.delete(assistantRef);
  await batch.commit();
  return {removed: true};
});
