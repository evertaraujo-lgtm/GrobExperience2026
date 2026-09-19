import {createHash, randomInt} from "node:crypto";

import {Timestamp, getFirestore} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/https";

const participantsCollection = "participantes4Events";
const raffleCollection = "sorteios4Events";
const winnerCollection = "sorteios4EventsVencedores";
const testCollection = "sorteios4EventsTestes";
const integrationCollection = "integracoes4Events";
const saoPauloTimeZone = "America/Sao_Paulo";

type RaffleMode = "teste" | "final";
type TestEligibilityMode = "todos" | "presenca_simulada";

class CandidateUnavailableError extends Error {}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, maximum = 240) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, maximum) : "";
}

function requestEid(value: unknown) {
  const eid = text(value, 30);
  if (!/^\d+$/.test(eid)) throw new HttpsError("invalid-argument", "Informe um EID numérico válido.");
  return eid;
}

function requestCategory(value: unknown) {
  const category = text(value, 240);
  if (!category) throw new HttpsError("invalid-argument", "Selecione uma categoria.");
  return category;
}

function requestDocumentId(value: unknown, label: string) {
  const id = text(value, 200);
  if (!id || id.includes("/")) throw new HttpsError("invalid-argument", `${label} inválido.`);
  return id;
}

function requestMode(value: unknown): RaffleMode {
  if (value === "teste" || value === "final") return value;
  throw new HttpsError("invalid-argument", "Modo de sorteio inválido.");
}

function requestEligibilityMode(value: unknown): TestEligibilityMode {
  return value === "presenca_simulada" ? "presenca_simulada" : "todos";
}

function saoPauloDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: saoPauloTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function categoryDateKey(category: string) {
  const match = category.match(/(?:^|\D)(\d{2})\.(\d{2})\.(\d{4})(?:\D|$)/);
  if (!match) return "";
  const [, day, month, year] = match;
  const candidate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    candidate.getUTCFullYear() !== Number(year) ||
    candidate.getUTCMonth() !== Number(month) - 1 ||
    candidate.getUTCDate() !== Number(day)
  ) return "";

  // TEMPORÁRIO: em 19/09/2026, trata a categoria de 23/09/2026 como sendo de
  // hoje para validar o fluxo final. Remover este bloco após a validação.
  const today = saoPauloDateKey();
  if (today === "2026-09-19" && day === "23" && month === "09" && year === "2026") return today;

  return `${year}-${month}-${day}`;
}

function isVisitorCategory(category: string) {
  return /\bVISITANTE\b/i.test(category);
}

function scopeId(eid: string, category: string) {
  return createHash("sha256").update(`${eid}|${category}`).digest("hex");
}

function winnerLockId(scope: string, participantId: string) {
  return createHash("sha256").update(`${scope}|${participantId}`).digest("hex");
}

function timestampIso(value: unknown) {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function participantCargo(data: Record<string, unknown>) {
  const raw = asRecord(data.dados4Events);
  return text(data.cargo || raw.attendee_position || raw.position, 180);
}

function participantValue(document: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = document.data();
  return {
    participantDocumentId: document.id,
    id4Events: text(data.id4Events, 100),
    nome: text(data.nome, 180) || "Participante sem nome",
    empresa: text(data.empresa, 180),
    cargo: participantCargo(data),
    qrCode: text(data.qrCode, 180),
    presente: data.presente === true,
  };
}

function historyValue(document: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = document.data();
  return {
    id: document.id,
    modo: data.modo === "teste" ? "teste" : "final",
    brinde: text(data.brinde, 120),
    categoria: text(data.categoria, 240),
    vencedor: asRecord(data.vencedor),
    quantidadeElegiveis: Number(data.quantidadeElegiveis) || 0,
    sorteadoEm: timestampIso(data.sorteadoEm),
  };
}

async function requireAdmin(uid: string) {
  const firestore = getFirestore();
  const user = await firestore.doc(`users/${uid}`).get();
  if (!user.exists || user.data()?.active === false || user.data()?.roles?.admin !== true) {
    throw new HttpsError("permission-denied", "Somente administradores podem acessar os sorteios.");
  }
  return firestore;
}

function participantCategoryQuery(firestore: FirebaseFirestore.Firestore, eid: string, category: string) {
  return firestore.collection(participantsCollection)
    .where("eid", "==", eid)
    .where("attendeeCat", "==", category);
}

async function validTestSession(
  firestore: FirebaseFirestore.Firestore,
  sessionId: string,
  eid: string,
  category: string,
) {
  const reference = firestore.collection(testCollection).doc(sessionId);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "A sessão de teste não foi encontrada.");
  const data = snapshot.data() ?? {};
  if (data.eid !== eid || data.categoria !== category) {
    throw new HttpsError("failed-precondition", "A sessão de teste pertence a outro evento ou categoria.");
  }
  if (data.status === "encerrada") throw new HttpsError("failed-precondition", "A sessão de teste está encerrada.");
  return {reference, snapshot};
}

async function deleteTestDocuments(reference: FirebaseFirestore.CollectionReference) {
  let deleted = 0;
  while (true) {
    const snapshot = await reference.limit(400).get();
    if (snapshot.empty) return deleted;
    const batch = reference.firestore.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
    deleted += snapshot.size;
    if (snapshot.size < 400) return deleted;
  }
}

export const get4EventsRaffleState = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para acessar os sorteios.");
  const firestore = await requireAdmin(request.auth.uid);
  const supplied = asRecord(request.data);
  const eid = requestEid(supplied.eid);
  const mode = supplied.modo === undefined ? "teste" : requestMode(supplied.modo);
  const category = text(supplied.categoria, 240);
  const sessionId = text(supplied.sessaoTesteId, 200);
  const eligibilityMode = requestEligibilityMode(supplied.filtroTeste);

  const [allParticipants, integration] = await Promise.all([
    firestore.collection(participantsCollection).where("eid", "==", eid).get(),
    firestore.collection(integrationCollection).doc(eid).get(),
  ]);

  const categoryMap = new Map<string, {categoria: string; data: string; total: number; presentes: number}>();
  allParticipants.docs.forEach((document) => {
    const data = document.data();
    const name = text(data.attendeeCat, 240);
    if (!name) return;
    const current = categoryMap.get(name) ?? {categoria: name, data: categoryDateKey(name), total: 0, presentes: 0};
    current.total += 1;
    if (data.presente === true) current.presentes += 1;
    categoryMap.set(name, current);
  });
  const today = saoPauloDateKey();
  const categories = [...categoryMap.values()].sort((left, right) =>
    (left.data || "9999").localeCompare(right.data || "9999") || left.categoria.localeCompare(right.categoria, "pt-BR"),
  ).map((item) => ({
    ...item,
    hoje: item.data === today,
    visitante: isVisitorCategory(item.categoria),
  }));

  const syncAt = integration.get("ultimaSincronizacaoEm");
  const lastSyncAt = timestampIso(syncAt);
  const syncToday = syncAt instanceof Timestamp && saoPauloDateKey(syncAt.toDate()) === today;

  if (!category) {
    return {
      eid,
      hoje: today,
      categorias: categories,
      ultimaSincronizacaoEm: lastSyncAt,
      sincronizacaoHoje: syncToday,
      participantes: [],
      historico: [],
    };
  }

  const categoryDate = categoryDateKey(category);
  const visitorCategory = isVisitorCategory(category);
  const selectedParticipants = await participantCategoryQuery(firestore, eid, category).get();
  let simulatedPresence = new Set<string>();
  let previousWinners = new Set<string>();
  let history: ReturnType<typeof historyValue>[] = [];
  let session: Record<string, unknown> | null = null;

  if (mode === "final") {
    const scope = scopeId(eid, category);
    const [winners, results] = await Promise.all([
      firestore.collection(winnerCollection).where("scopeId", "==", scope).get(),
      firestore.collection(raffleCollection).where("scopeId", "==", scope).get(),
    ]);
    previousWinners = new Set(winners.docs.map((document) => text(document.get("participantDocumentId"), 200)).filter(Boolean));
    history = results.docs.map(historyValue).sort((left, right) =>
      String(right.sorteadoEm ?? "").localeCompare(String(left.sorteadoEm ?? "")),
    );
  } else if (sessionId) {
    const valid = await validTestSession(firestore, requestDocumentId(sessionId, "Sessão de teste"), eid, category);
    const [presence, winners, results] = await Promise.all([
      valid.reference.collection("presencas").get(),
      valid.reference.collection("vencedores").get(),
      valid.reference.collection("resultados").get(),
    ]);
    simulatedPresence = new Set(presence.docs.filter((document) => document.get("presente") === true).map((document) => document.id));
    previousWinners = new Set(winners.docs.map((document) => document.id));
    history = results.docs.map(historyValue).sort((left, right) =>
      String(right.sorteadoEm ?? "").localeCompare(String(left.sorteadoEm ?? "")),
    );
    const sessionData = valid.snapshot.data() ?? {};
    session = {
      id: valid.snapshot.id,
      status: text(sessionData.status, 30),
      criadoEm: timestampIso(sessionData.criadoEm),
    };
  }

  const participants = selectedParticipants.docs.map((document) => {
    const base = participantValue(document);
    const won = previousWinners.has(document.id);
    const simulated = simulatedPresence.has(document.id);
    const eligible = mode === "final"
      ? visitorCategory && base.presente && categoryDate === today && syncToday && !won
      : (eligibilityMode === "todos" || simulated) && !won;
    return {...base, presencaSimulada: simulated, jaSorteado: won, elegivel: eligible};
  }).sort((left, right) => left.nome.localeCompare(right.nome, "pt-BR"));

  return {
    eid,
    modo: mode,
    hoje: today,
    categorias: categories,
    categoria: category,
    dataCategoria: categoryDate,
    categoriaPermitidaHoje: visitorCategory && categoryDate === today,
    ultimaSincronizacaoEm: lastSyncAt,
    sincronizacaoHoje: syncToday,
    sessaoTeste: session,
    participantes: participants,
    totais: {
      participantes: participants.length,
      presentes: participants.filter((participant) => participant.presente).length,
      presencasSimuladas: participants.filter((participant) => participant.presencaSimulada).length,
      vencedores: participants.filter((participant) => participant.jaSorteado).length,
      elegiveis: participants.filter((participant) => participant.elegivel).length,
    },
    historico: history,
  };
});

export const create4EventsRaffleTestSession = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para criar uma sessão de teste.");
  const firestore = await requireAdmin(request.auth.uid);
  const supplied = asRecord(request.data);
  const eid = requestEid(supplied.eid);
  const category = requestCategory(supplied.categoria);
  const sample = await participantCategoryQuery(firestore, eid, category).limit(1).get();
  if (sample.empty) throw new HttpsError("not-found", "Nenhum participante foi encontrado nessa categoria.");
  const reference = firestore.collection(testCollection).doc();
  const now = Timestamp.now();
  await reference.create({
    eid,
    categoria: category,
    dataCategoria: categoryDateKey(category),
    status: "ativa",
    criadoPor: request.auth.uid,
    criadoEm: now,
    atualizadoEm: now,
  });
  return {sessaoTesteId: reference.id, criadoEm: now.toDate().toISOString()};
});

export const clear4EventsRaffleTestHistory = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para limpar o histórico de testes.");
  const firestore = await requireAdmin(request.auth.uid);
  const supplied = asRecord(request.data);
  const eid = requestEid(supplied.eid);
  const category = requestCategory(supplied.categoria);
  const sessionId = requestDocumentId(supplied.sessaoTesteId, "Sessão de teste");
  const session = await validTestSession(firestore, sessionId, eid, category);
  const [results, winners] = await Promise.all([
    deleteTestDocuments(session.reference.collection("resultados")),
    deleteTestDocuments(session.reference.collection("vencedores")),
  ]);
  const now = Timestamp.now();
  await session.reference.update({
    historicoLimpoPor: request.auth.uid,
    historicoLimpoEm: now,
    atualizadoEm: now,
  });
  return {resultadosRemovidos: results, vencedoresLiberados: winners};
});

export const clear4EventsRaffleFinalHistory = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para limpar o histórico final.");
  const firestore = await requireAdmin(request.auth.uid);
  const supplied = asRecord(request.data);
  const eid = requestEid(supplied.eid);
  const category = requestCategory(supplied.categoria);
  if (!isVisitorCategory(category)) {
    throw new HttpsError("failed-precondition", "Somente categorias de visitantes possuem sorteio final.");
  }

  const scope = scopeId(eid, category);
  let results = 0;
  let winners = 0;
  while (true) {
    const [resultSnapshot, winnerSnapshot] = await Promise.all([
      firestore.collection(raffleCollection).where("scopeId", "==", scope).limit(200).get(),
      firestore.collection(winnerCollection).where("scopeId", "==", scope).limit(200).get(),
    ]);
    if (resultSnapshot.empty && winnerSnapshot.empty) break;
    const batch = firestore.batch();
    resultSnapshot.docs.forEach((document) => batch.delete(document.ref));
    winnerSnapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
    results += resultSnapshot.size;
    winners += winnerSnapshot.size;
  }

  return {resultadosRemovidos: results, vencedoresLiberados: winners};
});

export const set4EventsRaffleTestPresence = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para simular presenças.");
  const firestore = await requireAdmin(request.auth.uid);
  const supplied = asRecord(request.data);
  const eid = requestEid(supplied.eid);
  const category = requestCategory(supplied.categoria);
  const sessionId = requestDocumentId(supplied.sessaoTesteId, "Sessão de teste");
  const participantIds = Array.isArray(supplied.participanteIds)
    ? [...new Set(supplied.participanteIds.map((item) => text(item, 200)).filter((item) => item && !item.includes("/")))]
    : [];
  if (!participantIds.length || participantIds.length > 400) {
    throw new HttpsError("invalid-argument", "Envie entre 1 e 400 participantes por atualização.");
  }
  const present = supplied.presente === true;
  const session = await validTestSession(firestore, sessionId, eid, category);
  const references = participantIds.map((id) => firestore.collection(participantsCollection).doc(id));
  const snapshots = await firestore.getAll(...references);
  snapshots.forEach((snapshot) => {
    if (!snapshot.exists || snapshot.get("eid") !== eid || snapshot.get("attendeeCat") !== category) {
      throw new HttpsError("failed-precondition", "Um participante não pertence ao evento ou à categoria selecionada.");
    }
  });
  const batch = firestore.batch();
  const now = Timestamp.now();
  participantIds.forEach((participantId) => {
    batch.set(session.reference.collection("presencas").doc(participantId), {
      participanteId: participantId,
      presente: present,
      atualizadoPor: request.auth?.uid,
      atualizadoEm: now,
    }, {merge: true});
  });
  batch.update(session.reference, {atualizadoEm: now});
  await batch.commit();
  return {atualizados: participantIds.length, presente: present};
});

export const draw4EventsRaffle = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para realizar o sorteio.");
  const firestore = await requireAdmin(request.auth.uid);
  const supplied = asRecord(request.data);
  const eid = requestEid(supplied.eid);
  const category = requestCategory(supplied.categoria);
  const mode = requestMode(supplied.modo);
  const prize = text(supplied.brinde, 120);
  const eligibilityMode = requestEligibilityMode(supplied.filtroTeste);
  const sessionId = mode === "teste" ? requestDocumentId(supplied.sessaoTesteId, "Sessão de teste") : "";
  if (!prize) throw new HttpsError("invalid-argument", "Informe o nome do brinde.");

  const today = saoPauloDateKey();
  const eventDate = categoryDateKey(category);
  if (mode === "final" && !isVisitorCategory(category)) {
    throw new HttpsError("failed-precondition", "No modo final, somente categorias de visitantes podem ser sorteadas.");
  }
  if (mode === "final" && eventDate !== today) {
    throw new HttpsError("failed-precondition", "No modo final, somente a categoria correspondente ao dia atual pode ser sorteada.");
  }

  if (mode === "final") {
    const integration = await firestore.collection(integrationCollection).doc(eid).get();
    const syncAt = integration.get("ultimaSincronizacaoEm");
    if (!(syncAt instanceof Timestamp) || saoPauloDateKey(syncAt.toDate()) !== today) {
      throw new HttpsError("failed-precondition", "Atualize os participantes pela API da 4 Events antes do sorteio final.");
    }
  }

  const categoryParticipants = await (mode === "final"
    ? participantCategoryQuery(firestore, eid, category).where("presente", "==", true)
    : participantCategoryQuery(firestore, eid, category)).get();
  let testSession: Awaited<ReturnType<typeof validTestSession>> | null = null;
  let simulatedPresence = new Set<string>();
  let previousWinners = new Set<string>();

  if (mode === "final") {
    const scope = scopeId(eid, category);
    const winners = await firestore.collection(winnerCollection).where("scopeId", "==", scope).get();
    previousWinners = new Set(winners.docs.map((document) => text(document.get("participantDocumentId"), 200)).filter(Boolean));
  } else {
    testSession = await validTestSession(firestore, sessionId, eid, category);
    const [presence, winners] = await Promise.all([
      testSession.reference.collection("presencas").get(),
      testSession.reference.collection("vencedores").get(),
    ]);
    simulatedPresence = new Set(presence.docs.filter((document) => document.get("presente") === true).map((document) => document.id));
    previousWinners = new Set(winners.docs.map((document) => document.id));
  }

  const pool = categoryParticipants.docs
    .filter((document) => {
      if (previousWinners.has(document.id)) return false;
      if (mode === "final") return document.get("presente") === true;
      return eligibilityMode === "todos" || simulatedPresence.has(document.id);
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  if (!pool.length) throw new HttpsError("failed-precondition", "Não há participantes elegíveis para este sorteio.");

  while (pool.length) {
    const eligibleIds = pool.map((document) => document.id);
    const eligibleHash = createHash("sha256").update(eligibleIds.join("|")).digest("hex");
    const selectedIndex = randomInt(pool.length);
    const candidate = pool[selectedIndex];
    const winner = participantValue(candidate);
    const drawnAt = Timestamp.now();

    try {
      if (mode === "final") {
        const scope = scopeId(eid, category);
        const resultReference = firestore.collection(raffleCollection).doc();
        const lockReference = firestore.collection(winnerCollection).doc(winnerLockId(scope, candidate.id));
        await firestore.runTransaction(async (transaction) => {
          const participantSnapshot = await transaction.get(candidate.ref);
          const lockSnapshot = await transaction.get(lockReference);
          const participantData = participantSnapshot.data() ?? {};
          if (
            !participantSnapshot.exists ||
            participantData.eid !== eid ||
            participantData.attendeeCat !== category ||
            participantData.presente !== true ||
            lockSnapshot.exists
          ) throw new CandidateUnavailableError();
          const result = {
            modo: "final",
            scopeId: scope,
            eid,
            categoria: category,
            dataCategoria: eventDate,
            brinde: prize,
            quantidadeElegiveis: eligibleIds.length,
            elegiveisHash: eligibleHash,
            indiceSorteado: selectedIndex,
            vencedor: winner,
            sorteadoPor: request.auth?.uid,
            sorteadoEm: drawnAt,
          };
          transaction.create(resultReference, result);
          transaction.create(lockReference, {
            scopeId: scope,
            eid,
            categoria: category,
            participantDocumentId: candidate.id,
            sorteioId: resultReference.id,
            brinde: prize,
            criadoPor: request.auth?.uid,
            criadoEm: drawnAt,
          });
        });
        return {
          sorteioId: resultReference.id,
          modo: mode,
          vencedor: winner,
          quantidadeElegiveis: eligibleIds.length,
          indiceSorteado: selectedIndex,
          elegiveisHash: eligibleHash,
          sorteadoEm: drawnAt.toDate().toISOString(),
        };
      }

      if (!testSession) throw new HttpsError("failed-precondition", "Sessão de teste ausente.");
      const resultReference = testSession.reference.collection("resultados").doc();
      const winnerReference = testSession.reference.collection("vencedores").doc(candidate.id);
      const presenceReference = testSession.reference.collection("presencas").doc(candidate.id);
      await firestore.runTransaction(async (transaction) => {
        const sessionSnapshot = await transaction.get(testSession.reference);
        const participantSnapshot = await transaction.get(candidate.ref);
        const winnerSnapshot = await transaction.get(winnerReference);
        const presenceSnapshot = eligibilityMode === "presenca_simulada"
          ? await transaction.get(presenceReference)
          : null;
        const participantData = participantSnapshot.data() ?? {};
        if (
          !sessionSnapshot.exists ||
          sessionSnapshot.get("status") === "encerrada" ||
          !participantSnapshot.exists ||
          participantData.eid !== eid ||
          participantData.attendeeCat !== category ||
          winnerSnapshot.exists ||
          (eligibilityMode === "presenca_simulada" && presenceSnapshot?.get("presente") !== true)
        ) throw new CandidateUnavailableError();
        const result = {
          modo: "teste",
          sessaoTesteId: sessionId,
          eid,
          categoria: category,
          dataCategoria: eventDate,
          filtroTeste: eligibilityMode,
          brinde: prize,
          quantidadeElegiveis: eligibleIds.length,
          elegiveisHash: eligibleHash,
          indiceSorteado: selectedIndex,
          vencedor: winner,
          sorteadoPor: request.auth?.uid,
          sorteadoEm: drawnAt,
        };
        transaction.create(resultReference, result);
        transaction.create(winnerReference, {
          participanteId: candidate.id,
          sorteioId: resultReference.id,
          brinde: prize,
          criadoPor: request.auth?.uid,
          criadoEm: drawnAt,
        });
        transaction.update(testSession.reference, {atualizadoEm: drawnAt});
      });
      return {
        sorteioId: resultReference.id,
        modo: mode,
        vencedor: winner,
        quantidadeElegiveis: eligibleIds.length,
        indiceSorteado: selectedIndex,
        elegiveisHash: eligibleHash,
        sorteadoEm: drawnAt.toDate().toISOString(),
      };
    } catch (error) {
      if (!(error instanceof CandidateUnavailableError)) throw error;
      pool.splice(selectedIndex, 1);
    }
  }

  throw new HttpsError("aborted", "A lista de elegíveis mudou durante o sorteio. Atualize a tela e tente novamente.");
});
