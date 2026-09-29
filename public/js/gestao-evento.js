import {getAuthServices, getFirestoreServices, getFunctionsServices} from "/js/firebase-client.js";

const activitiesList = document.querySelector("[data-activities-list]");
const assistantsList = document.querySelector("[data-assistants-list]");
const activitiesTotal = document.querySelector("[data-activities-total]");
const assistantsTotal = document.querySelector("[data-assistants-total]");
const feedback = document.querySelector("[data-feedback]");
const activityModal = document.querySelector("[data-activity-modal]");
const activityForm = document.querySelector("[data-activity-form]");
const activityAssistants = document.querySelector("[data-activity-assistants]");
const activityFeedback = document.querySelector("[data-activity-feedback]");
const activitySave = document.querySelector("[data-activity-save]");
const assistantModal = document.querySelector("[data-assistant-modal]");
const assistantForm = document.querySelector("[data-assistant-form]");
const assistantFeedback = document.querySelector("[data-assistant-feedback]");
const assistantSave = document.querySelector("[data-assistant-save]");
const activityModalTitle = document.querySelector("#activity-modal-title");
const activityModalEyebrow = activityModal.querySelector(".eyebrow");
const readingsModal = document.querySelector("[data-readings-modal]");
const readingsActivity = document.querySelector("[data-readings-activity]");
const readingsList = document.querySelector("[data-readings-list]");
const readingsFeedback = document.querySelector("[data-readings-feedback]");
const exportActivityReadings = document.querySelector("[data-export-activity-readings]");
const leadCollectionLink = document.createElement("a");
leadCollectionLink.className = "back-link";
leadCollectionLink.href = "/coleta-leads/";
leadCollectionLink.textContent = "Coleta de leads";
leadCollectionLink.hidden = true;
document.querySelector(".toolbar-actions").append(leadCollectionLink);

let assistants = [];
let activities = [];
let editingActivityId = null;
let selectedReadingsActivity = null;
let selectedActivityReadings = [];

function setFeedback(message, state = "neutral") {
  feedback.textContent = message;
  feedback.dataset.state = state;
}

function setActivityFeedback(message, state = "neutral") {
  activityFeedback.textContent = message;
  activityFeedback.dataset.state = state;
}

function setAssistantFeedback(message, state = "neutral") {
  assistantFeedback.textContent = message;
  assistantFeedback.dataset.state = state;
}

function assistantName(uid) {
  return assistants.find((assistant) => assistant.id === uid)?.name || "Assistente removido";
}

function formatReadingDate(timestamp) {
  if (!timestamp?.toDate) return "Aguardando sincronização";
  return timestamp.toDate().toLocaleString("pt-BR", {dateStyle: "short", timeStyle: "short"});
}

function participantFields(value, prefix = "", fields = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fields;
  Object.entries(value).forEach(([key, item]) => {
    const field = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      participantFields(item, field, fields);
    } else {
      fields[field] = Array.isArray(item) ? JSON.stringify(item) : item ?? "";
    }
  });
  return fields;
}

function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function readingDateParts(timestamp) {
  const date = timestamp?.toDate?.();
  if (!date || Number.isNaN(date.getTime())) return {date: "", time: ""};
  return {
    date: new Intl.DateTimeFormat("pt-BR", {timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric"}).format(date),
    time: new Intl.DateTimeFormat("pt-BR", {timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"}).format(date),
  };
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], {type: "text/csv;charset=utf-8"}));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function exportActivityReadingsCsv() {
  if (!selectedReadingsActivity || !selectedActivityReadings.length) {
    readingsFeedback.textContent = "Esta atividade ainda não tem coletas para exportar.";
    readingsFeedback.dataset.state = "neutral";
    return;
  }
  exportActivityReadings.disabled = true;
  const qrCodes = [...new Set(selectedActivityReadings.map((reading) => String(reading.qrcode || "").trim()).filter(Boolean))];
  const participantsByQr = new Map();
  const unmatchedQrCodes = new Set();
  let nextIndex = 0;
  let completed = 0;
  readingsFeedback.textContent = `Buscando dados dos participantes: 0/${qrCodes.length}...`;
  readingsFeedback.dataset.state = "neutral";
  try {
    const {functions, functionsModule} = await getFunctionsServices();
    const lookup = functionsModule.httpsCallable(functions, "get4EventsParticipantByQrCode");
    const workers = Array.from({length: Math.min(8, qrCodes.length)}, async () => {
      while (nextIndex < qrCodes.length) {
        const qrCode = qrCodes[nextIndex++];
        try {
          const result = await lookup({qrCode});
          participantsByQr.set(qrCode, participantFields(result.data?.participant));
        } catch (error) {
          if (error.code === "functions/not-found" || error.code === "not-found") {
            participantsByQr.set(qrCode, {});
            unmatchedQrCodes.add(qrCode);
          } else {
            throw error;
          }
        }
        completed += 1;
        readingsFeedback.textContent = `Buscando dados dos participantes: ${completed}/${qrCodes.length}...`;
      }
    });
    const settled = await Promise.allSettled(workers);
    const failure = settled.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;

    const participantColumns = [...new Set([...participantsByQr.values()].flatMap((fields) => Object.keys(fields)))].sort((first, second) => first.localeCompare(second, "pt-BR"));
    const fixedColumns = ["Data da coleta", "Hora da coleta (America/Sao_Paulo)", "Atividade", "ID da coleta", "QR Code", "Assistente responsável"];
    const rows = [[...fixedColumns, ...participantColumns.map((field) => `Participante | ${field.replaceAll(".", " / ")}`)]];
    selectedActivityReadings.forEach((reading) => {
      const qrCode = String(reading.qrcode || "").trim();
      const dateParts = readingDateParts(reading.registradoEm);
      const participant = participantsByQr.get(qrCode) || {};
      rows.push([
        dateParts.date,
        dateParts.time,
        selectedReadingsActivity.nome || "",
        reading.id || "",
        qrCode,
        assistantName(reading.assistenteId),
        ...participantColumns.map((field) => participant[field] ?? ""),
      ]);
    });
    const slug = String(selectedReadingsActivity.nome || "atividade").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "atividade";
    downloadCsv(`coletas-${slug}-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    const unmatchedMessage = unmatchedQrCodes.size ? ` ${unmatchedQrCodes.size} QR Code(s) sem participante localizado; essas linhas mantêm data, hora e QR Code.` : " Todos os participantes foram localizados.";
    readingsFeedback.textContent = `${selectedActivityReadings.length} coleta(s) exportada(s).${unmatchedMessage}`;
    readingsFeedback.dataset.state = "success";
  } catch (error) {
    console.error(error);
    readingsFeedback.textContent = error.message || "Não foi possível buscar os dados dos participantes para exportar.";
    readingsFeedback.dataset.state = "error";
  } finally {
    exportActivityReadings.disabled = false;
  }
}

async function showReadings(activity) {
  selectedReadingsActivity = activity;
  selectedActivityReadings = [];
  exportActivityReadings.disabled = true;
  readingsActivity.textContent = "Atividade: " + activity.nome;
  readingsFeedback.textContent = "Carregando leituras...";
  readingsFeedback.dataset.state = "neutral";
  readingsList.replaceChildren();
  readingsModal.showModal();
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const snapshot = await firestoreModule.getDocs(firestoreModule.query(
      firestoreModule.collection(db, "coletaAtividadesRegistros"),
      firestoreModule.where("atividadeId", "==", activity.id),
    ));
    const readings = snapshot.docs
      .map((document) => ({id: document.id, ...document.data()}))
      .sort((first, second) => (second.registradoEm?.toMillis?.() || 0) - (first.registradoEm?.toMillis?.() || 0));
    selectedActivityReadings = readings;
    exportActivityReadings.disabled = !readings.length;
    readingsFeedback.textContent = readings.length + " QR Code(s) lido(s).";
    if (!readings.length) {
      readingsList.innerHTML = '<p class="empty-management">Nenhum QR Code foi lido nesta atividade.</p>';
      return;
    }
    readings.forEach((reading) => {
      const item = document.createElement("article");
      item.className = "reading-item";
      const qrcode = document.createElement("strong");
      qrcode.textContent = reading.qrcode;
      const details = document.createElement("small");
      details.textContent = `${formatReadingDate(reading.registradoEm)} · ${assistantName(reading.assistenteId)}`;
      item.append(qrcode, details);
      readingsList.append(item);
    });
  } catch (error) {
    console.error(error);
    readingsFeedback.textContent = "Não foi possível carregar os QR Codes desta atividade.";
    readingsFeedback.dataset.state = "error";
  }
}

function renderActivityAssistantChoices() {
  activityAssistants.replaceChildren();
  if (!assistants.length) {
    activityAssistants.textContent = "Cadastre um assistente antes de atribuir responsáveis.";
    return;
  }
  assistants.forEach((assistant) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "responsaveis";
    input.value = assistant.id;
    label.append(input, (assistant.name || assistant.email) + " — " + assistant.email);
    activityAssistants.append(label);
  });
}

function renderActivities() {
  activitiesList.replaceChildren();
  activitiesTotal.textContent = activities.length + " cadastrada(s)";
  if (!activities.length) {
    activitiesList.innerHTML = '<p class="empty-management">Nenhuma atividade cadastrada.</p>';
    return;
  }
  activities.forEach((activity) => {
    const card = document.createElement("article");
    card.className = "management-card";
    const title = document.createElement("h3");
    title.textContent = activity.nome;
    const description = document.createElement("p");
    description.textContent = activity.descricao || "Sem descrição.";
    const responsible = document.createElement("small");
    const ids = Array.isArray(activity.responsavelIds) ? activity.responsavelIds : [];
    responsible.textContent = ids.length ? "Responsáveis: " + ids.map(assistantName).join(", ") : "Sem assistente responsável.";
    const actions = document.createElement("div");
    actions.className = "management-card-actions";
    const readings = document.createElement("button");
    readings.className = "back-link";
    readings.type = "button";
    readings.textContent = "Ver leituras";
    readings.addEventListener("click", () => showReadings(activity));
    const manage = document.createElement("button");
    manage.className = "back-link";
    manage.type = "button";
    manage.textContent = "Editar";
    manage.addEventListener("click", () => {
      editingActivityId = activity.id;
      activityForm.reset();
      activityForm.elements.nome.value = activity.nome || "";
      activityForm.elements.descricao.value = activity.descricao || "";
      renderActivityAssistantChoices();
      const selected = Array.isArray(activity.responsavelIds) ? activity.responsavelIds : [];
      activityAssistants.querySelectorAll('input[name="responsaveis"]').forEach((input) => { input.checked = selected.includes(input.value); });
      activityModalEyebrow.textContent = "Atividade";
      activityModalTitle.textContent = "Editar atividade";
      activitySave.textContent = "Salvar atividade";
      setActivityFeedback("");
      activityModal.showModal();
    });
    const remove = document.createElement("button");
    remove.className = "danger-delete";
    remove.type = "button";
    remove.textContent = "Remover";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        const {db, firestoreModule} = await getFirestoreServices();
        const readingsReference = firestoreModule.collection(db, "coletaAtividadesRegistros");
        const countSnapshot = await firestoreModule.getDocs(firestoreModule.query(
          readingsReference,
          firestoreModule.where("atividadeId", "==", activity.id),
        ));
        const readingsCount = countSnapshot.size;
        if (!window.confirm(`Remover a atividade “${activity.nome}” e excluir permanentemente ${readingsCount} leitura(s) vinculada(s)?`)) {
          remove.disabled = false;
          return;
        }
        let deletedReadings = 0;
        while (true) {
          const readingsSnapshot = await firestoreModule.getDocs(firestoreModule.query(
            readingsReference,
            firestoreModule.where("atividadeId", "==", activity.id),
            firestoreModule.limit(400),
          ));
          if (readingsSnapshot.empty) break;
          const batch = firestoreModule.writeBatch(db);
          readingsSnapshot.docs.forEach((document) => batch.delete(document.ref));
          await batch.commit();
          deletedReadings += readingsSnapshot.size;
        }
        await firestoreModule.deleteDoc(firestoreModule.doc(db, "coletaAtividades", activity.id));
        setFeedback(`Atividade “${activity.nome}” e ${deletedReadings} leitura(s) removidas.`);
        await load();
      } catch (error) {
        console.error(error);
        setFeedback("Não foi possível remover a atividade.", "error");
        remove.disabled = false;
      }
    });
    actions.append(readings, manage, remove);
    card.append(title, description, responsible, actions);
    activitiesList.append(card);
  });
}

function renderAssistants() {
  assistantsList.replaceChildren();
  assistantsTotal.textContent = assistants.length + " cadastrado(s)";
  if (!assistants.length) {
    assistantsList.innerHTML = '<p class="empty-management">Nenhum assistente cadastrado.</p>';
    return;
  }
  assistants.forEach((assistant) => {
    const card = document.createElement("article");
    card.className = "management-card";
    const title = document.createElement("h3");
    title.textContent = assistant.name || assistant.email || "Assistente";
    const email = document.createElement("p");
    email.textContent = assistant.email;
    const actions = document.createElement("div");
    actions.className = "management-card-actions";
    const remove = document.createElement("button");
    remove.className = "danger-delete";
    remove.type = "button";
    remove.textContent = "Remover";
    remove.addEventListener("click", async () => {
      if (!window.confirm("Remover o assistente " + (assistant.name || assistant.email) + "? O acesso de coleta será revogado.")) return;
      remove.disabled = true;
      try {
        const {functions, functionsModule} = await getFunctionsServices();
        await functionsModule.httpsCallable(functions, "removeCollectionAssistant")({uid: assistant.id});
        setFeedback((assistant.name || assistant.email) + " foi removido(a).");
        await load();
      } catch (error) {
        console.error(error);
        setFeedback(error.message || "Não foi possível remover o assistente.", "error");
        remove.disabled = false;
      }
    });
    actions.append(remove);
    card.append(title, email, actions);
    assistantsList.append(card);
  });
}

async function load() {
  setFeedback("");
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const {functions, functionsModule} = await getFunctionsServices();
    const [staffResult, activitySnapshot] = await Promise.all([
      functionsModule.httpsCallable(functions, "listCollectionStaff")(),
      firestoreModule.getDocs(firestoreModule.query(firestoreModule.collection(db, "coletaAtividades"), firestoreModule.orderBy("nome"))),
    ]);
    assistants = Array.isArray(staffResult.data?.assistants) ? staffResult.data.assistants : [];
    activities = activitySnapshot.docs.map((document) => ({id: document.id, ...document.data()}));
    renderActivityAssistantChoices();
    renderAssistants();
    renderActivities();
  } catch (error) {
    console.error(error);
    setFeedback("Não foi possível carregar a gestão do evento.", "error");
  }
}

document.querySelector("[data-add-activity]").addEventListener("click", () => {
  editingActivityId = null;
  activityForm.reset();
  renderActivityAssistantChoices();
  activityModalEyebrow.textContent = "Nova atividade";
  activityModalTitle.textContent = "Cadastrar atividade";
  activitySave.textContent = "Criar atividade";
  setActivityFeedback("");
  activityModal.showModal();
});
document.querySelectorAll("[data-activity-cancel]").forEach((button) => button.addEventListener("click", () => activityModal.close()));

activityForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activityForm.reportValidity()) return;
  activitySave.disabled = true;
  activitySave.textContent = "Criando...";
  try {
    const form = new FormData(activityForm);
    const {db, firestoreModule} = await getFirestoreServices();
    const data = {
      nome: String(form.get("nome") || "").trim(),
      descricao: String(form.get("descricao") || "").trim(),
      responsavelIds: form.getAll("responsaveis"),
      atualizadoEm: firestoreModule.serverTimestamp(),
    };
    if (editingActivityId) {
      await firestoreModule.updateDoc(firestoreModule.doc(db, "coletaAtividades", editingActivityId), data);
    } else {
      await firestoreModule.addDoc(firestoreModule.collection(db, "coletaAtividades"), {...data, criadoEm: firestoreModule.serverTimestamp()});
    }
    activityModal.close();
    setFeedback(editingActivityId ? "Atividade atualizada." : "Atividade cadastrada.");
    await load();
  } catch (error) {
    console.error(error);
    setActivityFeedback("Não foi possível criar a atividade.", "error");
  } finally {
    activitySave.disabled = false;
    activitySave.textContent = editingActivityId ? "Salvar atividade" : "Criar atividade";
  }
});

document.querySelector("[data-add-assistant]").addEventListener("click", () => {
  assistantForm.reset();
  setAssistantFeedback("");
  assistantModal.showModal();
});
document.querySelectorAll("[data-assistant-cancel]").forEach((button) => button.addEventListener("click", () => assistantModal.close()));
document.querySelectorAll("[data-readings-cancel]").forEach((button) => button.addEventListener("click", () => readingsModal.close()));
exportActivityReadings.addEventListener("click", () => { void exportActivityReadingsCsv(); });

assistantForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!assistantForm.reportValidity()) return;
  assistantSave.disabled = true;
  assistantSave.textContent = "Criando...";
  try {
    const form = new FormData(assistantForm);
    const {functions, functionsModule} = await getFunctionsServices();
    await functionsModule.httpsCallable(functions, "createCollectionAssistant")({
      nome: String(form.get("nome") || "").trim(),
      email: String(form.get("email") || "").trim(),
      senha: String(form.get("senha") || ""),
    });
    assistantModal.close();
    setFeedback("Assistente cadastrado. As credenciais foram criadas para a área de coleta.");
    await load();
  } catch (error) {
    console.error(error);
    setAssistantFeedback(error.message || "Não foi possível criar o assistente.", "error");
  } finally {
    assistantSave.disabled = false;
    assistantSave.textContent = "Criar assistente";
  }
});

document.querySelector("[data-reload]").addEventListener("click", load);

const {auth, authModule} = await getAuthServices();
authModule.onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const {db, firestoreModule} = await getFirestoreServices();
  const profile = await firestoreModule.getDoc(firestoreModule.doc(db, "users", user.uid));
  const isAdmin = profile.exists() && profile.data().active !== false && profile.data().roles?.admin === true;
  if (!isAdmin) {
    const isAssistant = profile.exists() && profile.data().active !== false && profile.data().roles?.assistenteColeta === true;
    window.location.replace(isAssistant ? "/coleta-atividades/" : "/app/");
    return;
  }
  leadCollectionLink.hidden = false;
  try {
    const {functions, functionsModule} = await getFunctionsServices();
    await functionsModule.httpsCallable(functions, "consolidateCollectionStaff")();
  } catch (error) {
    console.error("Não foi possível consolidar os perfis legados.", error);
  }
  await load();
});
