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

let assistants = [];
let activities = [];
let editingActivityId = null;

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
  return assistants.find((assistant) => assistant.id === uid)?.nome || "Assistente removido";
}

function formatReadingDate(timestamp) {
  if (!timestamp?.toDate) return "Aguardando sincronização";
  return timestamp.toDate().toLocaleString("pt-BR", {dateStyle: "short", timeStyle: "short"});
}

async function showReadings(activity) {
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
    label.append(input, assistant.nome + " — " + assistant.email);
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
      if (!window.confirm("Remover a atividade “" + activity.nome + "”?")) return;
      remove.disabled = true;
      try {
        const {db, firestoreModule} = await getFirestoreServices();
        await firestoreModule.deleteDoc(firestoreModule.doc(db, "coletaAtividades", activity.id));
        setFeedback("Atividade “" + activity.nome + "” removida.");
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
    title.textContent = assistant.nome;
    const email = document.createElement("p");
    email.textContent = assistant.email;
    const actions = document.createElement("div");
    actions.className = "management-card-actions";
    const remove = document.createElement("button");
    remove.className = "danger-delete";
    remove.type = "button";
    remove.textContent = "Remover";
    remove.addEventListener("click", async () => {
      if (!window.confirm("Remover o assistente " + assistant.nome + "? O acesso de coleta será revogado.")) return;
      remove.disabled = true;
      try {
        const {functions, functionsModule} = await getFunctionsServices();
        await functionsModule.httpsCallable(functions, "removeCollectionAssistant")({uid: assistant.id});
        setFeedback(assistant.nome + " foi removido(a).");
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
    const [assistantSnapshot, activitySnapshot] = await Promise.all([
      firestoreModule.getDocs(firestoreModule.query(firestoreModule.collection(db, "coletaAtividadesAssistentes"), firestoreModule.orderBy("nome"))),
      firestoreModule.getDocs(firestoreModule.query(firestoreModule.collection(db, "coletaAtividades"), firestoreModule.orderBy("nome"))),
    ]);
    assistants = assistantSnapshot.docs.map((document) => ({id: document.id, ...document.data()}));
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
    const assistant = await firestoreModule.getDoc(firestoreModule.doc(db, "coletaAtividadesAssistentes", user.uid));
    window.location.replace(assistant.exists() && assistant.data().ativo === true ? "/coleta-atividades/" : "/app/");
    return;
  }
  await load();
});
