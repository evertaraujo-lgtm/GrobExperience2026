import {getAuthServices, getFirestoreServices, getFunctionsServices} from "/js/firebase-client.js";

const cooldownMilliseconds = 30 * 60 * 1000;

const list = document.querySelector("[data-list]");
const total = document.querySelector("[data-total]");
const feedback = document.querySelector("[data-feedback]");
const modal = document.querySelector("[data-collect-modal]");
const activityLabel = document.querySelector("[data-collect-activity]");
const formFeedback = document.querySelector("[data-collect-feedback]");
const qrReader = document.querySelector("[data-qr-reader]");
const startQrReader = document.querySelector("[data-start-qr-reader]");
const syncStatus = document.querySelector("[data-sync-status]");
const scanSuccess = document.querySelector("[data-scan-success]");
const scanSuccessCode = document.querySelector("[data-scan-success-code]");
const scanSuccessMessage = document.querySelector("[data-scan-success-message]");
let activityId = "";
let userId = "";
let scanner;
let scanning = false;
let scanLocked = false;
let scanSuccessTimer;
let recordsUnsubscribe;
let syncRunning = false;
let syncRetryTimer;
const localRecords = new Map();

function setFeedback(message, state = "neutral") { feedback.textContent = message; feedback.dataset.state = state; }
function setFormFeedback(message, state = "neutral") { formFeedback.textContent = message; formFeedback.dataset.state = state; }
function showScanSuccess(qrcode, repeated = false, message = repeated ? "Este QRCode já foi lido" : "Leitura registrada") {
  clearTimeout(scanSuccessTimer);
  scanSuccessCode.textContent = qrcode;
  scanSuccessMessage.textContent = message;
  scanSuccess.classList.toggle("is-repeated", repeated);
  scanSuccess.hidden = false;
  scanSuccess.classList.remove("is-visible");
  requestAnimationFrame(() => scanSuccess.classList.add("is-visible"));
  return new Promise((resolve) => {
    scanSuccessTimer = window.setTimeout(() => {
      scanSuccess.classList.remove("is-visible");
      window.setTimeout(() => { scanSuccess.hidden = true; }, 180);
      resolve();
    }, 1000);
  });
}
function storageKey() { return `grob-coleta-registros-${userId}`; }
function saveLocalRecords() {
  const records = [...localRecords.values()];
  const unresolved = records.filter((record) => record.status === "pending" || record.status === "error");
  const finished = records.filter((record) => record.status !== "pending" && record.status !== "error").slice(-500);
  localStorage.setItem(storageKey(), JSON.stringify([...unresolved, ...finished].sort((a, b) => a.createdAt - b.createdAt)));
}
function loadLocalRecords() {
  try {
    JSON.parse(localStorage.getItem(storageKey()) || "[]").forEach((record) => localRecords.set(record.id, record));
  } catch (error) {
    console.warn("Não foi possível recuperar o histórico local de coletas.", error);
  }
}
function renderSyncStatus() {
  const records = [...localRecords.values()];
  const pending = records.filter((record) => record.status === "pending").length;
  const failed = records.filter((record) => record.status === "error").length;
  const synced = records.filter((record) => record.status === "synced").length;
  const repeated = records.filter((record) => record.status === "duplicate").length;
  const online = navigator.onLine;
  if (failed) {
    syncStatus.textContent = `${synced} sincronizada(s), ${pending} pendente(s) e ${failed} com erro.`;
    syncStatus.dataset.state = "error";
  } else if (!online) {
    syncStatus.textContent = `${synced} sincronizada(s) e ${pending} pendente(s). Você está offline; o envio será retomado ao reconectar.`;
    syncStatus.dataset.state = "offline";
  } else if (pending) {
    syncStatus.textContent = `${synced} sincronizada(s) e ${pending} pendente(s) de sincronização.`;
    syncStatus.dataset.state = "pending";
  } else if (repeated) {
    syncStatus.textContent = `${synced} sincronizada(s) e ${repeated} repetida(s) ignorada(s).`;
    syncStatus.dataset.state = "synced";
  } else {
    syncStatus.textContent = `${synced} coleta(s) sincronizada(s). Pronto para funcionar offline.`;
    syncStatus.dataset.state = "synced";
  }
}
function updateLocalRecord(id, changes) {
  const current = localRecords.get(id);
  if (!current) return;
  localRecords.set(id, {...current, ...changes});
  saveLocalRecords();
  renderSyncStatus();
}
function retryMessage(nextAllowedAt) {
  if (!Number.isFinite(nextAllowedAt) || nextAllowedAt <= Date.now()) {
    return "Esta leitura coincidiu com outra coleta. O QRCode já pode ser lido novamente.";
  }
  const minutes = Math.max(1, Math.ceil((nextAllowedAt - Date.now()) / 60000));
  return `Este QRCode poderá ser coletado novamente em ${minutes} minuto(s).`;
}

function scheduleSyncRetry() {
  if (syncRetryTimer) return;
  syncRetryTimer = window.setTimeout(() => {
    syncRetryTimer = undefined;
    syncPendingRecords();
  }, 15000);
}

async function syncPendingRecords() {
  if (syncRunning || !navigator.onLine || !userId ||
      ![...localRecords.values()].some((record) => record.status === "pending" && record.id.startsWith("leitura_"))) return;
  clearTimeout(syncRetryTimer);
  syncRetryTimer = undefined;
  syncRunning = true;
  try {
    const {functions, functionsModule} = await getFunctionsServices();
    const registerScan = functionsModule.httpsCallable(functions, "registerActivityScan", {timeout: 30000});
    while (navigator.onLine) {
      const record = [...localRecords.values()]
        .filter((item) => item.status === "pending" && item.id.startsWith("leitura_"))
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!record) break;
      try {
        const response = await registerScan({
          registroId: record.id,
          atividadeId: record.activityId,
          qrcode: record.qrcode,
          coletadoNoDispositivoEm: record.createdAt,
        });
        if (response.data.status === "aceito") updateLocalRecord(record.id, {status: "synced"});
        else if (response.data.status === "aguardar") {
          const retryAt = Date.parse(response.data.proximaLeituraEm);
          updateLocalRecord(record.id, {status: "duplicate", retryAt});
          setFeedback(`Leitura de ${record.qrcode} ignorada. ${retryMessage(retryAt)}`, "error");
        } else throw new Error("Resposta inesperada ao registrar a leitura.");
      } catch (error) {
        console.error("Falha ao sincronizar a coleta.", error);
        if (["functions/invalid-argument", "functions/permission-denied", "functions/unauthenticated", "functions/already-exists"].includes(error?.code)) {
          updateLocalRecord(record.id, {status: "error"});
          setFeedback("Uma coleta não pôde ser sincronizada. Verifique o painel de status.", "error");
          continue;
        }
        scheduleSyncRetry();
        break;
      }
    }
  } catch (error) {
    console.error("Não foi possível iniciar a sincronização da coleta.", error);
    scheduleSyncRetry();
  } finally {
    syncRunning = false;
    renderSyncStatus();
  }
}
async function stopQrReader() {
  if (!scanner || !scanning) return;
  try { await scanner.stop(); } catch (error) { console.warn("Não foi possível encerrar a câmera.", error); }
  scanning = false;
  scanLocked = false;
  startQrReader.disabled = false;
  startQrReader.textContent = "Ler QRCode pela câmera";
  qrReader.replaceChildren();
}

async function registerQrcode(qrcode) {
  try {
    const normalizedQrcode = String(qrcode).trim();
    if (!normalizedQrcode) throw new Error("QRCode vazio.");
    const now = Date.now();
    const previous = [...localRecords.values()]
      .filter((record) => record.activityId === activityId && record.qrcode === normalizedQrcode &&
        ["pending", "synced"].includes(record.status) && Number.isFinite(record.createdAt))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (previous && now - previous.createdAt < cooldownMilliseconds) {
      await showScanSuccess(normalizedQrcode, true);
      setFormFeedback(retryMessage(previous.createdAt + cooldownMilliseconds), "error");
      return;
    }
    const recordId = `leitura_${crypto.randomUUID()}`;
    localRecords.set(recordId, {
      id: recordId,
      activityId,
      qrcode: normalizedQrcode,
      status: "pending",
      createdAt: now,
    });
    saveLocalRecords();
    renderSyncStatus();
    if (navigator.onLine) {
      await Promise.race([
        syncPendingRecords(),
        new Promise((resolve) => window.setTimeout(resolve, 3000)),
      ]);
    }
    const result = localRecords.get(recordId);
    if (result?.status === "duplicate") {
      await showScanSuccess(normalizedQrcode, true);
      setFormFeedback(retryMessage(result.retryAt), "error");
    } else if (result?.status === "error") {
      await showScanSuccess(normalizedQrcode, true, "Leitura não registrada");
      setFormFeedback("Não foi possível confirmar a leitura. Verifique o painel de status.", "error");
    } else if (result?.status === "synced") {
      await showScanSuccess(normalizedQrcode);
      setFormFeedback("Participação registrada. Aponte a câmera para o próximo QRCode.", "success");
    } else {
      setFeedback(navigator.onLine
        ? "Leitura salva neste aparelho e aguardando confirmação."
        : "Leitura salva offline. Ela será sincronizada quando a internet voltar.");
      await showScanSuccess(normalizedQrcode, false, "Leitura salva no aparelho");
      setFormFeedback("Leitura pendente de sincronização. Aponte a câmera para o próximo QRCode.", "success");
    }
  } catch (error) {
    console.error(error);
    setFormFeedback("Não foi possível registrar o QRCode. Tente novamente.", "error");
  } finally {
    scanLocked = false;
  }
}

function subscribeToRecords() {
  recordsUnsubscribe?.();
  getFirestoreServices().then(({db, firestoreModule}) => {
    const recordsQuery = firestoreModule.query(
      firestoreModule.collection(db, "coletaAtividadesRegistros"),
      firestoreModule.where("assistenteId", "==", userId),
    );
    recordsUnsubscribe = firestoreModule.onSnapshot(recordsQuery, (snapshot) => {
      snapshot.docs.forEach((document) => {
        const current = localRecords.get(document.id);
        if (current) updateLocalRecord(document.id, {
          status: document.metadata.hasPendingWrites ? "pending" : "synced",
        });
      });
      renderSyncStatus();
    }, (error) => {
      console.error("Não foi possível acompanhar a sincronização.", error);
      syncStatus.textContent = "Não foi possível verificar a sincronização agora. As coletas ficam salvas neste aparelho.";
      syncStatus.dataset.state = "error";
    });
  });
}

function registerOfflineShell() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/coleta-atividades/sw.js").catch((error) => {
      console.warn("Não foi possível preparar a coleta para uso offline.", error);
    });
  }
}

async function startQrReaderFromCamera() {
  if (scanning) return;
  if (!window.Html5Qrcode) {
    setFormFeedback("O leitor de QRCode não foi carregado. Verifique sua conexão e tente novamente.", "error");
    return;
  }
  startQrReader.disabled = true;
  startQrReader.textContent = "Abrindo câmera...";
  setFormFeedback("");
  try {
    scanner ??= new window.Html5Qrcode(qrReader.id);
    await scanner.start(
      {facingMode: "environment"},
      {fps: 10, qrbox: {width: 220, height: 220}},
      async (decodedText) => {
        if (scanLocked) return;
        scanLocked = true;
        setFormFeedback("QRCode lido. Registrando participação...", "success");
        await registerQrcode(decodedText);
      },
      () => {},
    );
    scanning = true;
    scanLocked = false;
    startQrReader.textContent = "Câmera ativa — aponte para o QRCode";
  } catch (error) {
    console.error(error);
    startQrReader.disabled = false;
    startQrReader.textContent = "Ler QRCode pela câmera";
    setFormFeedback("Não foi possível acessar a câmera. Verifique a permissão do navegador.", "error");
  }
}

async function load() {
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const snapshot = await firestoreModule.getDocs(firestoreModule.query(firestoreModule.collection(db, "coletaAtividades"), firestoreModule.where("responsavelIds", "array-contains", userId)));
    total.textContent = snapshot.size + " atividade(s)";
    list.replaceChildren();
    if (snapshot.empty) {
      list.innerHTML = '<p class="empty-management">Nenhuma atividade atribuída a você.</p>';
      return;
    }
    snapshot.docs.forEach((activityDocument) => {
      const activity = {id: activityDocument.id, ...activityDocument.data()};
      const card = document.createElement("article");
      card.className = "management-card";
      const name = document.createElement("h3");
      name.textContent = activity.nome;
      const description = document.createElement("p");
      description.textContent = activity.descricao || "Sem descrição.";
      const action = document.createElement("div");
      action.className = "management-card-actions";
      const collect = document.createElement("button");
      collect.className = "button";
      collect.type = "button";
      collect.textContent = "Coletar participante";
      collect.addEventListener("click", () => {
        activityId = activity.id;
        stopQrReader();
        activityLabel.textContent = "Atividade: " + activity.nome;
        setFormFeedback("");
        modal.showModal();
      });
      action.append(collect);
      card.append(name, description, action);
      list.append(card);
    });
  } catch (error) {
    console.error(error);
    setFeedback("Não foi possível carregar suas atividades.", "error");
  }
}

document.querySelectorAll("[data-collect-cancel]").forEach((button) => button.addEventListener("click", () => modal.close()));
modal.addEventListener("close", stopQrReader);
startQrReader.addEventListener("click", startQrReaderFromCamera);

const {auth, authModule} = await getAuthServices();
authModule.onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  userId = user.uid;
  const {db, firestoreModule} = await getFirestoreServices();
  const profile = await firestoreModule.getDoc(firestoreModule.doc(db, "users", user.uid));
  if (!profile.exists() || profile.data().active === false || profile.data().roles?.assistenteColeta !== true) {
    window.location.replace("/app/");
    return;
  }
  loadLocalRecords();
  renderSyncStatus();
  subscribeToRecords();
  await load();
  syncPendingRecords();
});

window.addEventListener("online", () => { renderSyncStatus(); syncPendingRecords(); });
window.addEventListener("offline", renderSyncStatus);
registerOfflineShell();
