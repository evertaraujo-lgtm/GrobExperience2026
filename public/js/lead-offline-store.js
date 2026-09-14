const DATABASE_NAME = "grob-lead-collection-offline";
const DATABASE_VERSION = 1;
const PARTICIPANTS = "participants";
const PENDING_LEADS = "pendingLeads";
const META = "meta";

let databasePromise;

function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(PARTICIPANTS)) database.createObjectStore(PARTICIPANTS, {keyPath: "key"});
        if (!database.objectStoreNames.contains(PENDING_LEADS)) database.createObjectStore(PENDING_LEADS, {keyPath: "id"});
        if (!database.objectStoreNames.contains(META)) database.createObjectStore(META, {keyPath: "key"});
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Não foi possível abrir o armazenamento offline."));
    });
  }
  return databasePromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Não foi possível acessar o armazenamento offline."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Não foi possível salvar no armazenamento offline."));
    transaction.onabort = () => reject(transaction.error || new Error("O armazenamento offline foi interrompido."));
  });
}

function participantKey(userId, qrCode) {
  return `${userId}:${String(qrCode).trim()}`;
}

function metaKey(userId, name) {
  return `${userId}:${name}`;
}

export async function replaceOfflineParticipants(userId, participants) {
  const database = await openDatabase();
  // Não espere uma requisição dentro de uma transação de escrita: em alguns
  // navegadores móveis ela é encerrada assim que não há operações pendentes.
  // Fazemos a leitura antes e a substituição inteira em uma nova transação.
  const readTransaction = database.transaction(PARTICIPANTS, "readonly");
  const existing = await requestResult(readTransaction.objectStore(PARTICIPANTS).getAll());
  const transaction = database.transaction([PARTICIPANTS, META], "readwrite");
  const participantStore = transaction.objectStore(PARTICIPANTS);
  existing.filter((item) => item.userId === userId).forEach((item) => participantStore.delete(item.key));
  participants.forEach((participant) => {
    const qrCode = String(participant?.qrCode || "").trim();
    if (!qrCode) return;
    participantStore.put({key: participantKey(userId, qrCode), userId, qrCode, participant});
  });
  transaction.objectStore(META).put({key: metaKey(userId, "participants"), value: {
    total: participants.length,
    updatedAt: Date.now(),
  }});
  await transactionDone(transaction);
}

export async function getOfflineParticipant(userId, qrCode) {
  const database = await openDatabase();
  const transaction = database.transaction(PARTICIPANTS, "readonly");
  const record = await requestResult(transaction.objectStore(PARTICIPANTS).get(participantKey(userId, qrCode)));
  return record?.participant || null;
}

export async function cacheOfflineParticipant(userId, participant) {
  const qrCode = String(participant?.qrCode || "").trim();
  if (!qrCode) return false;
  const database = await openDatabase();
  const key = participantKey(userId, qrCode);
  const readTransaction = database.transaction([PARTICIPANTS, META], "readonly");
  const previousRequest = readTransaction.objectStore(PARTICIPANTS).get(key);
  const previousMetaRequest = readTransaction.objectStore(META).get(metaKey(userId, "participants"));
  const [previous, previousMeta] = await Promise.all([
    requestResult(previousRequest),
    requestResult(previousMetaRequest),
  ]);
  const transaction = database.transaction([PARTICIPANTS, META], "readwrite");
  const participantStore = transaction.objectStore(PARTICIPANTS);
  participantStore.put({key, userId, qrCode, participant});
  if (!previous) {
    const metaStore = transaction.objectStore(META);
    metaStore.put({key: metaKey(userId, "participants"), value: {
      total: Number(previousMeta?.value?.total || 0) + 1,
      updatedAt: Date.now(),
    }});
  }
  await transactionDone(transaction);
  return !previous;
}

export async function getOfflineMeta(userId, name) {
  const database = await openDatabase();
  const transaction = database.transaction(META, "readonly");
  const record = await requestResult(transaction.objectStore(META).get(metaKey(userId, name)));
  return record?.value || null;
}

export async function setOfflineMeta(userId, name, value) {
  const database = await openDatabase();
  const transaction = database.transaction(META, "readwrite");
  transaction.objectStore(META).put({key: metaKey(userId, name), value});
  await transactionDone(transaction);
}

export async function queueOfflineLead(lead) {
  const database = await openDatabase();
  const transaction = database.transaction(PENDING_LEADS, "readwrite");
  transaction.objectStore(PENDING_LEADS).put(lead);
  await transactionDone(transaction);
}

export async function pendingOfflineLeads(userId) {
  const database = await openDatabase();
  const transaction = database.transaction(PENDING_LEADS, "readonly");
  const records = await requestResult(transaction.objectStore(PENDING_LEADS).getAll());
  return records.filter((record) => record.userId === userId).sort((first, second) => first.capturedAt - second.capturedAt);
}

export async function removeOfflineLead(id) {
  const database = await openDatabase();
  const transaction = database.transaction(PENDING_LEADS, "readwrite");
  transaction.objectStore(PENDING_LEADS).delete(id);
  await transactionDone(transaction);
}
