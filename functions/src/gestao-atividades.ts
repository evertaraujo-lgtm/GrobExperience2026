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
  let user;
  let created = false;
  try {
    user = await getAuth().getUserByEmail(email);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "auth/user-not-found") throw new HttpsError("internal", "Não foi possível verificar a conta do assistente.");
    if (senha.length < 6) throw new HttpsError("invalid-argument", "Para uma nova conta, informe uma senha com ao menos 6 caracteres.");
    try {
      user = await getAuth().createUser({email, password: senha, displayName: nome});
      created = true;
    } catch (createError) {
      console.error(createError);
      throw new HttpsError("internal", "Não foi possível criar a conta do assistente.");
    }
  }
  const profileRef = firestore.collection("users").doc(user.uid);
  const profile = await profileRef.get();
  const roles = dataAsRecord(profile.data()?.roles);
  await profileRef.set({
    name: nome,
    email,
    active: true,
    roles: {...roles, assistenteColeta: true},
    updatedAt: FieldValue.serverTimestamp(),
    ...(profile.exists ? {} : {createdAt: FieldValue.serverTimestamp()}),
  }, {merge: true});
  return {uid: user.uid, nome, email, created};
});

export const removeCollectionAssistant = onCall({region: "us-central1"}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para remover um assistente.");
  const firestore = await requireAdmin(request.auth.uid);
  const uid = typeof dataAsRecord(request.data).uid === "string" ? String(dataAsRecord(request.data).uid) : "";
  if (!uid) throw new HttpsError("invalid-argument", "Assistente inválido.");
  const profileRef = firestore.collection("users").doc(uid);
  const profile = await profileRef.get();
  if (!profile.exists || profile.data()?.roles?.assistenteColeta !== true) throw new HttpsError("not-found", "Assistente não encontrado.");
  const activities = await firestore.collection("coletaAtividades").where("responsavelIds", "array-contains", uid).get();
  const roles = dataAsRecord(profile.data()?.roles);
  delete roles.assistenteColeta;
  const batch = firestore.batch();
  activities.docs.forEach((activity) => batch.update(activity.ref, {responsavelIds: FieldValue.arrayRemove(uid), atualizadoEm: FieldValue.serverTimestamp()}));
  batch.update(profileRef, {roles, updatedAt: FieldValue.serverTimestamp()});
  await batch.commit();
  return {removed: true};
});

export const consolidateCollectionStaff = onCall({region: "us-central1"}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para organizar os perfis.");
  const firestore = await requireAdmin(request.auth.uid);
  const [assistantSnapshot, sellerSnapshot] = await Promise.all([
    firestore.collection("coletaAtividadesAssistentes").get(),
    firestore.collection("coletaLeadsVendedores").get(),
  ]);
  const staff = new Map<string, {name: string; email: string; roles: Record<string, boolean>; documents: FirebaseFirestore.DocumentReference[]}>();
  const include = (document: FirebaseFirestore.QueryDocumentSnapshot, role: string) => {
    const data = document.data();
    const current = staff.get(document.id) || {name: "", email: "", roles: {}, documents: []};
    current.name ||= typeof data.nome === "string" ? data.nome.trim() : "";
    current.email ||= typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    current.roles[role] = true;
    current.documents.push(document.ref);
    staff.set(document.id, current);
  };
  assistantSnapshot.docs.forEach((document) => include(document, "assistenteColeta"));
  sellerSnapshot.docs.forEach((document) => include(document, "vendedor"));

  const entries = [...staff.entries()];
  for (let start = 0; start < entries.length; start += 200) {
    const group = entries.slice(start, start + 200);
    const profiles = await Promise.all(group.map(([uid]) => firestore.doc(`users/${uid}`).get()));
    const batch = firestore.batch();
    group.forEach(([uid, staffMember], index) => {
      const profile = profiles[index];
      const existingRoles = dataAsRecord(profile.data()?.roles);
      batch.set(firestore.doc(`users/${uid}`), {
        name: staffMember.name || profile.data()?.name || "Usuário",
        email: staffMember.email || profile.data()?.email || "",
        active: profile.exists ? profile.data()?.active !== false : true,
        roles: {...existingRoles, ...staffMember.roles},
        updatedAt: FieldValue.serverTimestamp(),
        ...(profile.exists ? {} : {createdAt: FieldValue.serverTimestamp()}),
      }, {merge: true});
      staffMember.documents.forEach((document) => batch.delete(document));
    });
    await batch.commit();
  }
  return {assistentes: assistantSnapshot.size, vendedores: sellerSnapshot.size, perfis: entries.length};
});

export const listCollectionStaff = onCall({region: "us-central1"}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para consultar a equipe.");
  const firestore = await requireAdmin(request.auth.uid);
  const [assistantSnapshot, sellerSnapshot] = await Promise.all([
    firestore.collection("users").where("roles.assistenteColeta", "==", true).get(),
    firestore.collection("users").where("roles.vendedor", "==", true).get(),
  ]);
  const profiles = (snapshot: FirebaseFirestore.QuerySnapshot) => snapshot.docs
    .map((document) => {
      const data = document.data();
      return {
        id: document.id,
        name: typeof data.name === "string" ? data.name : "",
        email: typeof data.email === "string" ? data.email : "",
        active: data.active !== false,
      };
    })
    .sort((first, second) => (first.name || first.email).localeCompare(second.name || second.email, "pt-BR"));
  return {assistants: profiles(assistantSnapshot), sellers: profiles(sellerSnapshot)};
});
