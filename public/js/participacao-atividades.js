import {getAuthServices, getFirestoreServices} from "/js/firebase-client.js";

const activitiesContainer = document.querySelector("[data-participation-activities]");
const recentContainer = document.querySelector("[data-participation-recent]");
const totalReadings = document.querySelector("[data-total-readings]");
const activeActivities = document.querySelector("[data-active-activities]");
const lastReading = document.querySelector("[data-last-reading]");
const activitiesSummary = document.querySelector("[data-activities-summary]");
const recentSummary = document.querySelector("[data-recent-summary]");
const feedback = document.querySelector("[data-feedback]");
const qrModal = document.querySelector("[data-qr-modal]");
const qrGenerate = document.querySelector("[data-qr-generate]");
const qrResult = document.querySelector("[data-qr-result]");
const qrImage = document.querySelector("[data-qr-image]");
const qrCode = document.querySelector("[data-qr-code]");
const qrDownload = document.querySelector("[data-qr-download]");
const qrFeedback = document.querySelector("[data-qr-feedback]");

function setFeedback(message, state = "neutral") {
  feedback.textContent = message;
  feedback.dataset.state = state;
}

function setQrFeedback(message, state = "neutral") {
  qrFeedback.textContent = message;
  qrFeedback.dataset.state = state;
}

async function nextQrCode() {
  const {db, firestoreModule} = await getFirestoreServices();
  const sequenceRef = firestoreModule.doc(db, "configuracoes", "qrcodesTe");
  const sequence = await firestoreModule.runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(sequenceRef);
    const current = Number(snapshot.data()?.ultimaSequencia ?? 0);
    if (!Number.isSafeInteger(current) || current < 0 || current >= 9999999999) throw new Error("A sequência de QR Codes atingiu um valor inválido ou seu limite.");
    const next = current + 1;
    transaction.set(sequenceRef, {ultimaSequencia: next, atualizadoEm: firestoreModule.serverTimestamp()}, {merge: true});
    return next;
  });
  return `Te-${String(sequence).padStart(10, "0")}`;
}

async function generateQrCode() {
  qrGenerate.disabled = true;
  qrGenerate.textContent = "Gerando...";
  qrDownload.hidden = true;
  setQrFeedback("");
  try {
    const qrLibrary = await import("https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm");
    const toDataURL = qrLibrary.toDataURL || qrLibrary.default?.toDataURL;
    if (!toDataURL) throw new Error("O gerador de QR Code não foi carregado. Verifique sua conexão e tente novamente.");
    const code = await nextQrCode();
    const imageUrl = await toDataURL(code, {width: 640, margin: 2, errorCorrectionLevel: "M"});
    qrImage.src = imageUrl;
    qrCode.textContent = code;
    qrDownload.href = imageUrl;
    qrDownload.download = `${code}.png`;
    qrResult.hidden = false;
    qrDownload.hidden = false;
    setQrFeedback(`${code} foi reservado e está pronto para uso.`, "success");
  } catch (error) {
    console.error(error);
    setQrFeedback(error.message || "Não foi possível gerar o QR Code.", "error");
  } finally {
    qrGenerate.disabled = false;
    qrGenerate.textContent = "Gerar próximo código";
  }
}

function timestampValue(timestamp) {
  return timestamp?.toMillis?.() || 0;
}

function formatDate(timestamp) {
  if (!timestamp?.toDate) return "Aguardando sincronização";
  return timestamp.toDate().toLocaleString("pt-BR", {dateStyle: "short", timeStyle: "short"});
}

function renderDashboard(activities, readings) {
  const readingsByActivity = new Map();
  readings.forEach((reading) => {
    const current = readingsByActivity.get(reading.atividadeId) || [];
    current.push(reading);
    readingsByActivity.set(reading.atividadeId, current);
  });
  const highestCount = Math.max(1, ...activities.map((activity) => readingsByActivity.get(activity.id)?.length || 0));
  const latestReadings = [...readings].sort((first, second) => timestampValue(second.registradoEm) - timestampValue(first.registradoEm));
  const activeCount = activities.filter((activity) => (readingsByActivity.get(activity.id)?.length || 0) > 0).length;
  totalReadings.textContent = readings.length;
  activeActivities.textContent = `${activeCount} de ${activities.length}`;
  lastReading.textContent = latestReadings.length ? formatDate(latestReadings[0].registradoEm) : "Nenhuma";
  activitiesSummary.textContent = `${activities.length} atividade(s)`;
  recentSummary.textContent = `${Math.min(latestReadings.length, 10)} mais recente(s)`;

  activitiesContainer.replaceChildren();
  if (!activities.length) {
    activitiesContainer.innerHTML = '<p class="empty-management">Nenhuma atividade cadastrada.</p>';
  } else {
    activities.forEach((activity) => {
      const activityReadings = readingsByActivity.get(activity.id) || [];
      const latest = [...activityReadings].sort((first, second) => timestampValue(second.registradoEm) - timestampValue(first.registradoEm))[0];
      const item = document.createElement("article");
      item.className = "participation-activity";
      const heading = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = activity.nome;
      const count = document.createElement("b");
      count.textContent = `${activityReadings.length} presença(s)`;
      heading.append(name, count);
      const bar = document.createElement("span");
      bar.className = "participation-bar";
      const fill = document.createElement("i");
      fill.style.width = `${(activityReadings.length / highestCount) * 100}%`;
      bar.append(fill);
      const detail = document.createElement("small");
      detail.textContent = latest ? `Última leitura: ${formatDate(latest.registradoEm)}` : "Ainda não há leituras.";
      item.append(heading, bar, detail);
      activitiesContainer.append(item);
    });
  }

  recentContainer.replaceChildren();
  if (!latestReadings.length) {
    recentContainer.innerHTML = '<p class="empty-management">Nenhuma presença registrada ainda.</p>';
    return;
  }
  const names = new Map(activities.map((activity) => [activity.id, activity.nome]));
  latestReadings.slice(0, 10).forEach((reading) => {
    const item = document.createElement("article");
    item.className = "participation-reading";
    const code = document.createElement("strong");
    code.textContent = reading.qrcode;
    const detail = document.createElement("small");
    detail.textContent = `${names.get(reading.atividadeId) || "Atividade removida"} · ${formatDate(reading.registradoEm)}`;
    item.append(code, detail);
    recentContainer.append(item);
  });
}

async function load() {
  setFeedback("");
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const [activitySnapshot, readingSnapshot] = await Promise.all([
      firestoreModule.getDocs(firestoreModule.query(firestoreModule.collection(db, "coletaAtividades"), firestoreModule.orderBy("nome"))),
      firestoreModule.getDocs(firestoreModule.collection(db, "coletaAtividadesRegistros")),
    ]);
    renderDashboard(
      activitySnapshot.docs.map((document) => ({id: document.id, ...document.data()})),
      readingSnapshot.docs.map((document) => ({id: document.id, ...document.data()})),
    );
  } catch (error) {
    console.error(error);
    setFeedback("Não foi possível carregar a participação nas atividades.", "error");
  }
}

document.querySelector("[data-reload]").addEventListener("click", load);
document.querySelector("[data-generate-qr]").addEventListener("click", () => {
  qrResult.hidden = true;
  qrDownload.hidden = true;
  setQrFeedback("");
  qrModal.showModal();
});
document.querySelectorAll("[data-qr-cancel]").forEach((button) => button.addEventListener("click", () => qrModal.close()));
qrGenerate.addEventListener("click", generateQrCode);

const {auth, authModule} = await getAuthServices();
authModule.onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const {db, firestoreModule} = await getFirestoreServices();
  const profile = await firestoreModule.getDoc(firestoreModule.doc(db, "users", user.uid));
  const isAdmin = profile.exists() && profile.data().active !== false && profile.data().roles?.admin === true;
  if (!isAdmin) {
    window.location.replace("/app/");
    return;
  }
  await load();
});
