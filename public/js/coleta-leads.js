import {getAuthServices, getFirestoreServices, getFunctionsServices} from "/js/firebase-client.js";
import {
  cacheOfflineParticipant,
  getOfflineMeta,
  getOfflineParticipant,
  pendingOfflineLeads,
  queueOfflineLead,
  removeOfflineLead,
  replaceOfflineParticipants,
  setOfflineMeta,
} from "/js/lead-offline-store.js";
import {getOfflineProfile, saveOfflineProfile} from "/js/offline-profile.js";

const adminPanels = document.querySelectorAll("[data-admin-only]");
const sellerPanel = document.querySelector("[data-seller-only]");
const adminFeedback = document.querySelector("[data-admin-feedback]");
const collectorFeedback = document.querySelector("[data-collector-feedback]");
const sellerForm = document.querySelector("[data-seller-form]");
const sellerSave = document.querySelector("[data-seller-save]");
const sellersList = document.querySelector("[data-sellers-list]");
const sellersTotal = document.querySelector("[data-sellers-total]");
const topicForm = document.querySelector("[data-topic-form]");
const topicSave = document.querySelector("[data-topic-save]");
const topicsList = document.querySelector("[data-topics-list]");
const topicsTotal = document.querySelector("[data-topics-total]");
const fieldForm = document.querySelector("[data-field-form]");
const fieldSave = document.querySelector("[data-field-save]");
const fieldType = fieldForm?.elements.tipo;
const fieldTopic = document.querySelector("[data-field-topic]");
const fieldOptions = document.querySelector("[data-field-options]");
const checkboxBehavior = document.querySelector("[data-checkbox-behavior]");
const dependentQuestions = document.querySelector("[data-dependent-questions]");
const fieldsList = document.querySelector("[data-fields-list]");
const fieldsTotal = document.querySelector("[data-fields-total]");
const manualQrForm = document.querySelector("[data-manual-qr-form]");
const startQrReader = document.querySelector("[data-start-qr-reader]");
const qrReader = document.querySelector("[data-qr-reader]");
const participantCard = document.querySelector("[data-participant-card]");
const participantData = document.querySelector("[data-participant-data]");
const participantQr = document.querySelector("[data-participant-qr]");
const leadForm = document.querySelector("[data-lead-form]");
const leadFields = document.querySelector("[data-lead-fields]");
const leadTopicProgress = document.querySelector("[data-lead-topic-progress]");
const leadPrevious = document.querySelector("[data-lead-previous]");
const leadNext = document.querySelector("[data-lead-next]");
const leadSave = document.querySelector("[data-lead-save]");
const leadFeedback = document.querySelector("[data-lead-feedback]");
const clearLead = document.querySelector("[data-clear-lead]");
const pageEyebrow = document.querySelector("[data-page-eyebrow]");
const pageDescription = document.querySelector("[data-page-description]");
const leadsList = document.querySelector("[data-leads-list]");
const leadsTotal = document.querySelector("[data-leads-total]");
const leadsFeedback = document.querySelector("[data-leads-feedback]");
const exportLeads = document.querySelector("[data-export-leads]");
const reloadLeads = document.querySelector("[data-reload-leads]");
const leadDetailsModal = document.querySelector("[data-lead-details-modal]");
const leadDetails = document.querySelector("[data-lead-details]");
const offlineStatus = document.querySelector("[data-offline-status]");
const downloadOffline = document.querySelector("[data-download-offline]");
const syncOffline = document.querySelector("[data-sync-offline]");
const openManualSearch = document.querySelector("[data-open-manual-search]");
const manualSearchModal = document.querySelector("[data-manual-search-modal]");
const openOwnLeads = document.querySelector("[data-open-own-leads]");
const ownLeadsModal = document.querySelector("[data-own-leads-modal]");
const ownLeadsList = document.querySelector("[data-own-leads-list]");
const ownLeadsFeedback = document.querySelector("[data-own-leads-feedback]");
const scanSuccess = document.querySelector("[data-lead-scan-success]");
const scanSuccessCode = document.querySelector("[data-lead-scan-code]");

let isAdmin = false;
let isSeller = false;
let configuredTopics = [];
let configuredFields = [];
let currentTopicIndex = 0;
let selectedParticipant = null;
let scanner;
let scanning = false;
let scanLocked = false;
let collectedLeads = [];
let userId = "";
let syncingOfflineLeads = false;
let scanSuccessTimer;
const OFFLINE_BASE_MAX_AGE = 24 * 60 * 60 * 1000;

function setFeedback(element, message, state = "neutral") {
  element.textContent = message;
  element.dataset.state = state;
}

function setOfflineStatus(message, state = "neutral") {
  offlineStatus.textContent = message;
  offlineStatus.dataset.state = state;
}

function showScanSuccess(qrCode) {
  clearTimeout(scanSuccessTimer);
  scanSuccessCode.textContent = String(qrCode || "");
  scanSuccess.hidden = false;
  scanSuccess.classList.remove("is-visible");
  requestAnimationFrame(() => scanSuccess.classList.add("is-visible"));
  scanSuccessTimer = window.setTimeout(() => {
    scanSuccess.classList.remove("is-visible");
    window.setTimeout(() => { scanSuccess.hidden = true; }, 180);
  }, 1200);
}

function offlineParticipantValue(participant) {
  return {
    id: String(participant?.id || ""),
    qrCode: participantValue(participant, ["qrCode", "qr_code", "qrcode"]),
    nome: participantValue(participant, ["nome", "name", "full_name", "attendee_name"]),
    empresa: participantValue(participant, ["empresa", "company", "organization", "attendee_company"]),
    cargo: participantValue(participant, ["cargo", "job_title", "position", "role"]),
    email: participantValue(participant, ["email", "attendee_email"]),
    whatsapp: participantValue(participant, ["whatsapp", "phone", "cellphone", "mobile", "attendee_phone"]),
    dataParticipacao: participantValue(participant, ["dataParticipacao", "date", "event_date", "attendee_date"]),
  };
}

async function refreshOfflineStatus() {
  if (!userId) return;
  const [base, pending] = await Promise.all([
    getOfflineMeta(userId, "participants"),
    pendingOfflineLeads(userId),
  ]);
  const baseText = base?.total ? `${base.total} participante(s) baixado(s)` : "base offline ainda não preparada";
  const updatedText = base?.updatedAt ? ` · atualizada ${new Date(base.updatedAt).toLocaleString("pt-BR", {dateStyle: "short", timeStyle: "short"})}` : "";
  const pendingText = pending.length ? ` · ${pending.length} lead(s) aguardando envio` : " · nenhuma coleta pendente";
  setOfflineStatus(baseText + updatedText + pendingText, pending.length ? "pending" : base?.total ? "synced" : "offline");
}

async function downloadOfflineParticipants() {
  if (!isSeller || !userId) return;
  if (!navigator.onLine) {
    setOfflineStatus("Conecte-se à internet para baixar ou atualizar a base offline.", "offline");
    return;
  }
  downloadOffline.disabled = true;
  const participants = [];
  let afterId = null;
  let total = null;
  try {
    const {functions, functionsModule} = await getFunctionsServices();
    const downloadPage = functionsModule.httpsCallable(functions, "download4EventsParticipantIndex");
    do {
      const result = await downloadPage({pageSize: 300, afterId, includeTotal: total === null});
      const page = Array.isArray(result.data?.participants) ? result.data.participants : [];
      participants.push(...page);
      afterId = typeof result.data?.nextCursor === "string" ? result.data.nextCursor : null;
      total = Number.isInteger(result.data?.total) ? result.data.total : total;
      setOfflineStatus(`Baixando a base offline: ${participants.length}${total === null ? "" : ` de ${total}`} participante(s)...`, "pending");
    } while (afterId);
    await replaceOfflineParticipants(userId, participants);
    setFeedback(collectorFeedback, `${participants.length} participante(s) disponíveis neste aparelho. A coleta pode continuar sem sinal.`, "success");
    await refreshOfflineStatus();
  } catch (error) {
    console.error(error);
    setOfflineStatus("Não foi possível preparar a base offline. Tente novamente com conexão estável.", "error");
  } finally {
    downloadOffline.disabled = false;
  }
}

async function prepareOfflineBaseOnLogin() {
  if (!isSeller || !userId || !navigator.onLine) return false;
  const base = await getOfflineMeta(userId, "participants");
  const updatedAt = Number(base?.updatedAt || 0);
  const needsDownload = !updatedAt || Date.now() - updatedAt >= OFFLINE_BASE_MAX_AGE;
  if (!needsDownload) return false;
  setOfflineStatus(updatedAt
    ? "A base deste aparelho tem mais de 24 horas. Atualizando automaticamente..."
    : "Preparando automaticamente a base offline deste aparelho...", "pending");
  await downloadOfflineParticipants();
  return true;
}

async function synchronizeOfflineLeads() {
  if (!isSeller || !userId || syncingOfflineLeads || !navigator.onLine) return;
  syncingOfflineLeads = true;
  try {
    const pending = await pendingOfflineLeads(userId);
    if (!pending.length) return;
    setOfflineStatus(`Sincronizando ${pending.length} lead(s)...`, "pending");
    const {functions, functionsModule} = await getFunctionsServices();
    const save = functionsModule.httpsCallable(functions, "saveLead");
    for (const lead of pending) {
      await save({
        qrCode: lead.qrCode,
        respostas: lead.respostas,
        offlineId: lead.id,
        collectedOfflineAt: lead.capturedAt,
      });
      await removeOfflineLead(lead.id);
    }
    setFeedback(collectorFeedback, "Coletas deste aparelho sincronizadas.", "success");
  } catch (error) {
    console.error("Não foi possível sincronizar os leads locais.", error);
    setOfflineStatus("Não foi possível sincronizar agora. Os leads permanecem protegidos neste aparelho.", "error");
    return;
  } finally {
    syncingOfflineLeads = false;
    await refreshOfflineStatus().catch((error) => console.warn("Não foi possível atualizar o status offline.", error));
  }
}

const FIELD_TYPES = ["texto", "texto-longo", "numero", "selecao", "multipla-escolha", "checkbox", "categoria"];
const LEGACY_TOPIC_ID = "topico_geral";

function normalizedFields(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((field) => {
    if (!field || typeof field !== "object") return [];
    const id = typeof field.id === "string" ? field.id.trim() : "";
    const rotulo = typeof field.rotulo === "string" ? field.rotulo.trim() : "";
    if (!id || !rotulo || !FIELD_TYPES.includes(field.tipo)) return [];
    return [{
      id,
      rotulo,
      tipo: field.tipo,
      obrigatorio: field.obrigatorio === true,
      permiteMultiplaSelecao: field.permiteMultiplaSelecao === true,
      opcoes: Array.isArray(field.opcoes) ? field.opcoes.map((option) => String(option).trim()).filter(Boolean) : [],
      topicoId: typeof field.topicoId === "string" ? field.topicoId.trim() : "",
      dependeDe: typeof field.dependeDe === "string" ? field.dependeDe.trim() : "",
    }];
  });
}

function normalizedTopics(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((topic) => {
    if (!topic || typeof topic !== "object") return [];
    const id = typeof topic.id === "string" ? topic.id.trim() : "";
    const titulo = typeof topic.titulo === "string" ? topic.titulo.trim() : "";
    if (!id || !titulo) return [];
    return [{
      id,
      titulo,
      acionadoPorCampoId: typeof topic.acionadoPorCampoId === "string" ? topic.acionadoPorCampoId.trim() : "",
      acionadoPorValor: typeof topic.acionadoPorValor === "string" ? topic.acionadoPorValor.trim() : "",
    }];
  });
}

function setQuestionnaire(topicsValue, fieldsValue) {
  configuredTopics = normalizedTopics(topicsValue);
  configuredFields = normalizedFields(fieldsValue);
  if (configuredFields.length && !configuredTopics.length) {
    configuredTopics = [{id: LEGACY_TOPIC_ID, titulo: "Perguntas gerais"}];
  }
  const topicIds = new Set(configuredTopics.map((topic) => topic.id));
  configuredFields = configuredFields.map((field) => ({
    ...field,
    topicoId: topicIds.has(field.topicoId) ? field.topicoId : configuredTopics[0]?.id || "",
  }));
  const fieldIds = new Set(configuredFields.map((field) => field.id));
  configuredFields = configuredFields.map((field) => ({
    ...field,
    dependeDe: fieldIds.has(field.dependeDe) ? field.dependeDe : "",
  }));
}

function participantValue(participant, keys) {
  const source = participant?.dados4Events && typeof participant.dados4Events === "object" ? participant.dados4Events : {};
  for (const key of keys) {
    const value = participant?.[key] ?? source[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "";
}

function formatTimestamp(value) {
  if (!value) return "Não informado";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "Não informado" : date.toLocaleString("pt-BR", {dateStyle: "short", timeStyle: "short"});
}

function leadName(lead) {
  return participantValue(lead.participante, ["nome", "name", "full_name", "attendee_name"]) || "Participante não identificado";
}

function leadCompany(lead) {
  return participantValue(lead.participante, ["empresa", "company", "organization", "attendee_company"]) || "Empresa não informada";
}

function stopQrReader() {
  if (!scanner || !scanning) return Promise.resolve();
  return scanner.stop().catch((error) => console.warn("Não foi possível encerrar a câmera.", error)).finally(() => {
    scanning = false;
    scanLocked = false;
    startQrReader.disabled = false;
    startQrReader.textContent = "Ler QR Code pela câmera";
    qrReader.replaceChildren();
  });
}

function registerOfflineShell() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/coleta-leads/sw.js").catch((error) => {
      console.warn("Não foi possível preparar a coleta de leads para uso offline.", error);
    });
  }
}

function fieldTypeLabel(type) {
  return {
    texto: "Texto curto",
    "texto-longo": "Texto longo",
    numero: "Número",
    selecao: "Lista de seleção",
    "multipla-escolha": "Múltipla escolha",
    checkbox: "Checkbox",
    categoria: "Categoria que abre tópico",
  }[type] || "Pergunta";
}

function renderTopics() {
  if (!topicsTotal || !topicsList || !fieldTopic || !fieldSave) return;
  topicsTotal.textContent = `${configuredTopics.length} cadastrado(s)`;
  topicsList.replaceChildren();
  fieldTopic.replaceChildren(new Option(configuredTopics.length ? "Selecione o tópico" : "Crie um tópico primeiro", ""));
  configuredTopics.forEach((topic) => fieldTopic.add(new Option(topic.titulo, topic.id)));
  fieldTopic.disabled = !configuredTopics.length;
  fieldSave.disabled = !configuredTopics.length;
  if (!configuredTopics.length) {
    topicsList.innerHTML = '<p class="empty-management">Crie o primeiro tópico para começar a adicionar perguntas.</p>';
    return;
  }
  configuredTopics.forEach((topic, index) => {
    const card = document.createElement("article");
    card.className = "management-card lead-topic-card";
    const title = document.createElement("h3");
    title.textContent = `${index + 1}. ${topic.titulo}`;
    const details = document.createElement("p");
    const count = configuredFields.filter((field) => field.topicoId === topic.id).length;
    details.textContent = `${count} pergunta(s)`;
    const actions = document.createElement("div");
    actions.className = "management-card-actions";
    const remove = document.createElement("button");
    remove.className = "danger-delete";
    remove.type = "button";
    remove.textContent = "Remover tópico";
    remove.addEventListener("click", async () => {
      const topicFields = configuredFields.filter((field) => field.topicoId === topic.id);
      const warning = topicFields.length ? ` e suas ${topicFields.length} pergunta(s)` : "";
      if (!window.confirm(`Remover o tópico “${topic.titulo}”${warning}? As respostas já registradas serão preservadas.`)) return;
      const previousTopics = configuredTopics;
      const previousFields = configuredFields;
      configuredTopics = configuredTopics.filter((item) => item.id !== topic.id);
      configuredFields = configuredFields.filter((field) => field.topicoId !== topic.id);
      try {
        await saveConfiguredFields();
        setFeedback(adminFeedback, "Tópico removido.", "success");
      } catch (error) {
        console.error(error);
        configuredTopics = previousTopics;
        configuredFields = previousFields;
        renderConfiguredFields();
        setFeedback(adminFeedback, "Não foi possível remover o tópico.", "error");
      }
    });
    actions.append(remove);
    card.append(title, details, actions);
    topicsList.append(card);
  });
}

function renderConfiguredFields() {
  if (!fieldsList || !fieldsTotal) return;
  renderTopics();
  fieldsList.replaceChildren();
  fieldsTotal.textContent = `${configuredFields.length} cadastrada(s)`;
  const parentFields = configuredFields.filter((field) => !field.dependeDe);
  if (!parentFields.length) {
    fieldsList.innerHTML = '<p class="empty-management">Nenhuma pergunta cadastrada.</p>';
    return;
  }
  configuredTopics.forEach((topic) => {
    const topicFields = parentFields.filter((field) => field.topicoId === topic.id);
    if (!topicFields.length) return;
    const group = document.createElement("section");
    group.className = "lead-admin-topic-group";
    const heading = document.createElement("h3");
    heading.textContent = topic.titulo;
    group.append(heading);
    topicFields.forEach((field) => {
      const card = document.createElement("article");
      card.className = "management-card";
      const title = document.createElement("h3");
      title.textContent = field.rotulo;
      const details = document.createElement("p");
      details.textContent = `${fieldTypeLabel(field.tipo)}${field.obrigatorio ? " · obrigatório" : ""}${field.opcoes?.length ? ` · ${field.opcoes.join(", ")}` : ""}`;
      card.append(title, details);
      const children = configuredFields.filter((item) => item.dependeDe === field.id);
      if (children.length) {
        const dependentList = document.createElement("ul");
        dependentList.className = "lead-dependent-summary";
        children.forEach((child) => {
          const item = document.createElement("li");
          item.textContent = child.rotulo;
          dependentList.append(item);
        });
        card.append(dependentList);
      }
      const actions = document.createElement("div");
      actions.className = "management-card-actions";
      const remove = document.createElement("button");
      remove.className = "danger-delete";
      remove.type = "button";
      remove.textContent = "Remover";
      remove.addEventListener("click", async () => {
        if (!window.confirm(`Remover a pergunta “${field.rotulo}”? As respostas já registradas serão preservadas.`)) return;
        const previousFields = configuredFields;
        configuredFields = configuredFields.filter((item) => item.id !== field.id && item.dependeDe !== field.id);
        try {
          await saveConfiguredFields();
          setFeedback(adminFeedback, "Pergunta removida.", "success");
        } catch (error) {
          console.error(error);
          configuredFields = previousFields;
          renderConfiguredFields();
          setFeedback(adminFeedback, "Não foi possível remover a pergunta.", "error");
        }
      });
      actions.append(remove);
      card.append(actions);
      group.append(card);
    });
    fieldsList.append(group);
  });
}

function createLeadFieldControl(field) {
  if (field.tipo === "checkbox") {
    const label = document.createElement("label");
    label.className = "lead-answer-checkbox";
    label.dataset.leadQuestion = field.id;
    const control = document.createElement("input");
    control.type = "checkbox";
    control.name = field.id;
    control.value = "true";
    control.required = field.obrigatorio === true;
    const text = document.createElement("span");
    text.textContent = field.rotulo + (field.obrigatorio ? " *" : "");
    label.append(control, text);
    return {wrapper: label, control};
  }

  if (field.tipo === "multipla-escolha") {
    const group = document.createElement("fieldset");
    group.className = "lead-choice-group";
    group.dataset.leadQuestion = field.id;
    if (field.permiteMultiplaSelecao) {
      group.dataset.multipleField = field.id;
      group.dataset.required = String(field.obrigatorio === true);
    }
    const legend = document.createElement("legend");
    legend.textContent = field.rotulo + (field.obrigatorio ? " *" : "");
    group.append(legend);
    let firstControl = null;
    (field.opcoes || []).forEach((option, index) => {
      const label = document.createElement("label");
      const control = document.createElement("input");
      control.type = field.permiteMultiplaSelecao ? "checkbox" : "radio";
      control.name = field.id;
      control.value = option;
      control.required = !field.permiteMultiplaSelecao && field.obrigatorio === true;
      if (field.permiteMultiplaSelecao) {
        control.addEventListener("change", () => {
          group.querySelectorAll("input").forEach((item) => item.setCustomValidity(""));
        });
      }
      label.append(control, document.createTextNode(option));
      group.append(label);
      if (index === 0) firstControl = control;
    });
    return {wrapper: group, control: firstControl};
  }

  const label = document.createElement("label");
  label.className = "management-field";
  label.dataset.leadQuestion = field.id;
  const title = document.createElement("span");
  title.textContent = field.rotulo + (field.obrigatorio ? " *" : "");
  label.append(title);
  let control;
  if (field.tipo === "texto-longo") {
    control = document.createElement("textarea");
    control.rows = 4;
  } else if (field.tipo === "selecao" || field.tipo === "categoria") {
    control = document.createElement("select");
    control.add(new Option(field.tipo === "categoria" ? "Selecione a categoria" : "Selecione", ""));
    (field.opcoes || []).forEach((option) => control.add(new Option(option, option)));
  } else {
    control = document.createElement("input");
    control.type = field.tipo === "numero" ? "number" : "text";
  }
  control.name = field.id;
  control.required = field.obrigatorio === true;
  control.maxLength = 2000;
  label.append(control);
  return {wrapper: label, control};
}

function updateDependentFields(parentId, checked) {
  leadFields.querySelectorAll("[data-dependent-parent]").forEach((container) => {
    if (container.dataset.dependentParent !== parentId) return;
    container.hidden = !checked;
    container.querySelectorAll("input, textarea, select").forEach((control) => {
      control.disabled = !checked;
      if (!checked) {
        if (control.type === "checkbox" || control.type === "radio") control.checked = false;
        else control.value = "";
      }
    });
  });
}

function activeLeadSteps() {
  const activeSteps = [...leadFields.querySelectorAll("[data-topic-step]")].filter((step) => step.dataset.topicActive === "true");
  const stepsByTopic = new Map(activeSteps.map((step) => [step.dataset.topicId, step]));
  const ordered = [];
  const appended = new Set();
  configuredTopics.filter((topic) => !topic.acionadoPorCampoId).forEach((topic) => {
    const generalStep = stepsByTopic.get(topic.id);
    if (generalStep) {
      ordered.push(generalStep);
      appended.add(topic.id);
    }
    const categoryFieldIds = new Set(configuredFields
      .filter((field) => field.topicoId === topic.id && field.tipo === "categoria")
      .map((field) => field.id));
    configuredTopics.filter((candidate) => categoryFieldIds.has(candidate.acionadoPorCampoId)).forEach((candidate) => {
      const conditionalStep = stepsByTopic.get(candidate.id);
      if (!conditionalStep) return;
      ordered.push(conditionalStep);
      appended.add(candidate.id);
    });
  });
  activeSteps.forEach((step) => {
    if (!appended.has(step.dataset.topicId)) ordered.push(step);
  });
  return ordered;
}

function topicIsActive(topic) {
  if (!topic.acionadoPorCampoId || !topic.acionadoPorValor) return true;
  const control = leadForm.elements.namedItem(topic.acionadoPorCampoId);
  return String(control?.value || "") === topic.acionadoPorValor;
}

function clearControls(container) {
  container.querySelectorAll("[data-dependent-parent]").forEach((dependentContainer) => {
    dependentContainer.hidden = true;
  });
  container.querySelectorAll("[data-lead-question]").forEach((question) => {
    question.classList.remove("lead-question-invalid");
    question.removeAttribute("aria-invalid");
  });
  container.querySelectorAll("input, textarea, select").forEach((control) => {
    control.disabled = true;
    control.setCustomValidity("");
    if (control.type === "checkbox" || control.type === "radio") control.checked = false;
    else control.value = "";
  });
}

function refreshLeadTopicVisibility() {
  const currentStep = activeLeadSteps()[currentTopicIndex];
  const currentTopicId = currentStep?.dataset.topicId || "";
  leadFields.querySelectorAll("[data-topic-step]").forEach((step) => {
    const topic = configuredTopics.find((item) => item.id === step.dataset.topicId);
    const active = topic ? topicIsActive(topic) : false;
    const wasActive = step.dataset.topicActive === "true";
    step.dataset.topicActive = String(active);
    step.querySelectorAll("input, textarea, select").forEach((control) => {
      const dependentContainer = control.closest("[data-dependent-parent]");
      control.disabled = !active || Boolean(dependentContainer?.hidden);
    });
    if (!active && wasActive) clearControls(step);
  });
  const steps = activeLeadSteps();
  const nextIndex = Math.max(0, steps.findIndex((step) => step.dataset.topicId === currentTopicId));
  showLeadTopic(nextIndex);
}

function showLeadTopic(index) {
  const steps = activeLeadSteps();
  if (!steps.length) {
    currentTopicIndex = 0;
    leadTopicProgress.hidden = true;
    leadPrevious.hidden = true;
    leadNext.hidden = true;
    leadSave.hidden = false;
    return;
  }
  currentTopicIndex = Math.max(0, Math.min(index, steps.length - 1));
  leadFields.querySelectorAll("[data-topic-step]").forEach((step) => { step.hidden = true; });
  steps.forEach((step, stepIndex) => { step.hidden = stepIndex !== currentTopicIndex; });
  const currentStep = steps[currentTopicIndex];
  leadTopicProgress.hidden = false;
  leadTopicProgress.textContent = `Tópico ${currentTopicIndex + 1} de ${steps.length} · ${currentStep?.dataset.topicTitle || "Perguntas"}`;
  leadPrevious.hidden = currentTopicIndex === 0;
  leadNext.hidden = currentTopicIndex === steps.length - 1;
  leadSave.hidden = currentTopicIndex !== steps.length - 1;
}

function validateTopic(index) {
  const step = activeLeadSteps()[index];
  if (!step) return true;
  const missingMultipleChoices = [...step.querySelectorAll('[data-multiple-field][data-required="true"]')]
    .filter((group) => {
      const controls = [...group.querySelectorAll('input[type="checkbox"]')].filter((control) => !control.disabled);
      return controls.length && !controls.some((control) => control.checked);
    });
  missingMultipleChoices.forEach((group) => {
    const firstControl = group.querySelector('input[type="checkbox"]');
    firstControl.setCustomValidity("Selecione pelo menos uma opção.");
  });
  const invalidControls = [...step.querySelectorAll("input, textarea, select")]
    .filter((control) => !control.disabled && !control.checkValidity());
  const invalidQuestions = new Set(invalidControls.map((control) => control.closest("[data-lead-question]")).filter(Boolean));
  step.querySelectorAll("[data-lead-question]").forEach((question) => {
    const invalid = invalidQuestions.has(question);
    question.classList.toggle("lead-question-invalid", invalid);
    if (invalid) question.setAttribute("aria-invalid", "true");
    else question.removeAttribute("aria-invalid");
  });
  if (!invalidControls.length) {
    setFeedback(leadFeedback, "");
    return true;
  }
  showLeadTopic(index);
  setFeedback(leadFeedback, "Responda às perguntas obrigatórias destacadas.", "error");
  const firstInvalid = invalidControls[0];
  const firstQuestion = firstInvalid.closest("[data-lead-question]");
  firstQuestion?.scrollIntoView({behavior: "smooth", block: "center"});
  firstInvalid.reportValidity();
  return false;
}

function validateAllTopics() {
  const steps = activeLeadSteps();
  return steps.every((step, index) => validateTopic(index));
}

function renderLeadFields() {
  leadFields.replaceChildren();
  currentTopicIndex = 0;
  if (!configuredTopics.length) {
    leadFields.innerHTML = '<p class="empty-management">Não há perguntas adicionais cadastradas. Você ainda pode salvar este lead.</p>';
    showLeadTopic(0);
    return;
  }
  configuredTopics.forEach((topic, topicIndex) => {
    const step = document.createElement("section");
    step.className = "lead-topic-step";
    step.dataset.topicStep = String(topicIndex);
    step.dataset.topicId = topic.id;
    step.dataset.topicTitle = topic.titulo;
    step.dataset.topicActive = "false";
    const heading = document.createElement("h3");
    heading.textContent = topic.titulo;
    step.append(heading);
    const topicFields = configuredFields.filter((field) => field.topicoId === topic.id && !field.dependeDe);
    if (!topicFields.length) {
      const empty = document.createElement("p");
      empty.className = "empty-management";
      empty.textContent = "Este tópico ainda não possui perguntas.";
      step.append(empty);
    }
    topicFields.forEach((field) => {
      const {wrapper, control} = createLeadFieldControl(field);
      step.append(wrapper);
      if (field.tipo === "categoria") {
        control?.addEventListener("change", refreshLeadTopicVisibility);
      }
      const children = configuredFields.filter((child) => child.dependeDe === field.id);
      if (field.tipo === "checkbox" && children.length) {
        const dependentContainer = document.createElement("div");
        dependentContainer.className = "lead-dependent-fields";
        dependentContainer.dataset.dependentParent = field.id;
        dependentContainer.hidden = true;
        children.forEach((child) => {
          const childControl = createLeadFieldControl(child);
          childControl.wrapper.classList.add("lead-dependent-field");
          childControl.wrapper.querySelectorAll("input, textarea, select").forEach((item) => { item.disabled = true; });
          dependentContainer.append(childControl.wrapper);
        });
        step.append(dependentContainer);
        control?.addEventListener("change", () => updateDependentFields(field.id, control.checked));
      }
    });
    leadFields.append(step);
  });
  refreshLeadTopicVisibility();
}

function renderParticipant() {
  if (!selectedParticipant) {
    participantCard.hidden = true;
    clearLead.hidden = true;
    return;
  }
  const fields = [
    ["Nome", participantValue(selectedParticipant, ["nome", "name", "full_name", "attendee_name"])],
    ["Empresa", participantValue(selectedParticipant, ["empresa", "company", "organization", "attendee_company"])],
    ["Cargo", participantValue(selectedParticipant, ["cargo", "job_title", "position", "role"])],
    ["E-mail", participantValue(selectedParticipant, ["email", "attendee_email"])],
    ["WhatsApp", participantValue(selectedParticipant, ["whatsapp", "phone", "cellphone", "mobile", "attendee_phone"])],
    ["Data de participação", participantValue(selectedParticipant, ["dataParticipacao", "date", "event_date", "attendee_date"])],
  ].filter(([, value]) => value);
  participantData.replaceChildren();
  fields.forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "participant-meta";
    const strong = document.createElement("strong");
    strong.textContent = value;
    const caption = document.createElement("span");
    caption.textContent = label;
    item.append(strong, caption);
    participantData.append(item);
  });
  participantQr.textContent = selectedParticipant.qrCode || "";
  renderLeadFields();
  participantCard.hidden = false;
  clearLead.hidden = false;
}

async function loadConfiguredFields() {
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const snapshot = await firestoreModule.getDoc(firestoreModule.doc(db, "coletaLeadsConfiguracoes", "campos"));
    setQuestionnaire(snapshot.data()?.topicos, snapshot.data()?.campos);
    if (userId) await setOfflineMeta(userId, "questionnaire", {topicos: configuredTopics, campos: configuredFields});
  } catch (error) {
    const cachedQuestionnaire = userId ? await getOfflineMeta(userId, "questionnaire") : null;
    const cachedFields = userId ? await getOfflineMeta(userId, "fields") : null;
    if (!cachedQuestionnaire && !cachedFields) throw error;
    setQuestionnaire(cachedQuestionnaire?.topicos, cachedQuestionnaire?.campos || cachedFields);
    setFeedback(collectorFeedback, "Usando os campos da conversa salvos neste aparelho.", "offline");
  }
  if (isAdmin) renderConfiguredFields();
  if (isSeller && selectedParticipant) renderLeadFields();
}

async function saveConfiguredFields() {
  const {db, firestoreModule} = await getFirestoreServices();
  await firestoreModule.setDoc(firestoreModule.doc(db, "coletaLeadsConfiguracoes", "campos"), {
    topicos: configuredTopics,
    campos: configuredFields,
    atualizadoEm: firestoreModule.serverTimestamp(),
  }, {merge: true});
  if (userId) await setOfflineMeta(userId, "questionnaire", {topicos: configuredTopics, campos: configuredFields});
  renderConfiguredFields();
}

async function loadSellers() {
  const {functions, functionsModule} = await getFunctionsServices();
  const result = await functionsModule.httpsCallable(functions, "listCollectionStaff")();
  const sellers = Array.isArray(result.data?.sellers) ? result.data.sellers : [];
  sellersTotal.textContent = `${sellers.length} cadastrado(s)`;
  sellersList.replaceChildren();
  if (!sellers.length) {
    sellersList.innerHTML = '<p class="empty-management">Nenhum vendedor cadastrado.</p>';
    return;
  }
  sellers.forEach((seller) => {
    const card = document.createElement("article");
    card.className = "management-card";
    const title = document.createElement("h3");
    title.textContent = seller.name || seller.email || "Vendedor";
    const email = document.createElement("p");
    email.textContent = seller.email || "";
    const actions = document.createElement("div");
    actions.className = "management-card-actions";
    const remove = document.createElement("button");
    remove.className = "danger-delete";
    remove.type = "button";
    remove.textContent = "Remover acesso";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Remover o acesso de vendedor de ${seller.name || seller.email}?`)) return;
      remove.disabled = true;
      try {
        const {functions, functionsModule} = await getFunctionsServices();
        await functionsModule.httpsCallable(functions, "removeLeadSeller")({uid: seller.id});
        setFeedback(adminFeedback, "Acesso de vendedor removido.", "success");
        await loadSellers();
      } catch (error) {
        console.error(error);
        setFeedback(adminFeedback, error.message || "Não foi possível remover o acesso.", "error");
        remove.disabled = false;
      }
    });
    actions.append(remove);
    card.append(title, email, actions);
    sellersList.append(card);
  });
}

function addDetail(label, value, {questionFirst = false} = {}) {
  const item = document.createElement("div");
  item.className = "participant-meta";
  if (questionFirst) item.classList.add("lead-response-detail");
  const strong = document.createElement("strong");
  const caption = document.createElement("span");
  strong.textContent = questionFirst ? label : value || "Não informado";
  caption.textContent = questionFirst ? value || "Não informado" : label;
  item.append(strong, caption);
  leadDetails.append(item);
}

function showLeadDetails(lead) {
  leadDetails.replaceChildren();
  const participant = lead.participante || {};
  [
    ["Nome", leadName(lead)],
    ["Empresa", leadCompany(lead)],
    ["Cargo", participantValue(participant, ["cargo", "job_title", "position", "role"])],
    ["E-mail", participantValue(participant, ["email", "attendee_email"])],
    ["WhatsApp", participantValue(participant, ["whatsapp", "phone", "cellphone", "mobile", "attendee_phone"])],
    ["QR Code", lead.qrCode],
    ["Vendedor", lead.vendedorNome || lead.vendedorEmail],
    ["Coletado em", formatTimestamp(lead.criadoEm)],
    ...(lead.pendente ? [["Status", "Aguardando sincronização"]] : []),
  ].forEach(([label, value]) => addDetail(label, value));
  const responses = lead.respostas && typeof lead.respostas === "object" ? Object.values(lead.respostas) : [];
  if (responses.length) {
    const heading = document.createElement("h3");
    heading.textContent = "Respostas da conversa";
    leadDetails.append(heading);
    responses.forEach((response) => addDetail(response.rotulo || "Resposta", response.valor, {questionFirst: true}));
  }
  leadDetailsModal.showModal();
}

function renderLeadCards(target, leads, emptyMessage, {canDelete = false} = {}) {
  target.replaceChildren();
  if (!leads.length) {
    target.innerHTML = `<p class="empty-management">${emptyMessage}</p>`;
    return;
  }
  leads.forEach((lead) => {
    const card = document.createElement("article");
    card.className = "management-card lead-list-item";
    const title = document.createElement("h3");
    title.textContent = leadName(lead);
    const company = document.createElement("p");
    company.textContent = lead.pendente ? `${leadCompany(lead)} · aguardando sincronização` : leadCompany(lead);
    const actions = document.createElement("div");
    actions.className = "management-card-actions";
    const details = document.createElement("button");
    details.className = "back-link";
    details.type = "button";
    details.textContent = "Ver detalhes";
    details.addEventListener("click", () => showLeadDetails(lead));
    actions.append(details);
    if (canDelete && isAdmin && !lead.pendente) {
      const remove = document.createElement("button");
      remove.className = "danger-delete";
      remove.type = "button";
      remove.textContent = "Apagar";
      remove.setAttribute("aria-label", `Apagar lead de ${leadName(lead)}`);
      remove.addEventListener("click", () => { void deleteCollectedLead(lead, remove); });
      actions.append(remove);
    }
    card.append(title, company, actions);
    target.append(card);
  });
}

async function deleteCollectedLead(lead, button) {
  if (!isAdmin || !lead?.id || lead.pendente) return;
  if (!window.confirm(`Apagar o lead de “${leadName(lead)}”? Esta ação não pode ser desfeita.`)) return;
  button.disabled = true;
  button.textContent = "Apagando...";
  setFeedback(leadsFeedback, `Apagando o lead de ${leadName(lead)}...`);
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    await firestoreModule.deleteDoc(firestoreModule.doc(db, "coletaLeads", lead.id));
    collectedLeads = collectedLeads.filter((item) => item.id !== lead.id);
    renderLeads();
    setFeedback(leadsFeedback, "Lead apagado.", "success");
  } catch (error) {
    console.error(error);
    button.disabled = false;
    button.textContent = "Apagar";
    setFeedback(leadsFeedback, "Não foi possível apagar o lead.", "error");
  }
}

function renderLeads() {
  leadsTotal.textContent = `${collectedLeads.length} coletado(s)`;
  exportLeads.disabled = !collectedLeads.length;
  renderLeadCards(leadsList, collectedLeads, "Nenhum lead coletado.", {canDelete: true});
}

function leadCollectionTime(lead) {
  const value = lead?.criadoEm ?? lead?.capturedAt ?? 0;
  if (typeof value === "number") return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

async function loadOwnLeads() {
  setFeedback(ownLeadsFeedback, "Carregando seus leads...");
  const pending = await pendingOfflineLeads(userId);
  let synchronized = [];
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const snapshot = await firestoreModule.getDocs(firestoreModule.query(
      firestoreModule.collection(db, "coletaLeads"),
      firestoreModule.where("vendedorId", "==", userId),
    ));
    synchronized = snapshot.docs.map((document) => ({id: document.id, ...document.data()}));
  } catch (error) {
    console.warn("Não foi possível carregar os leads sincronizados.", error);
  }
  const pendingLeads = pending.map((lead) => ({
    id: `local_${lead.id}`,
    qrCode: lead.qrCode,
    respostas: lead.respostas,
    participante: lead.participant || {nome: "Participante aguardando sincronização"},
    criadoEm: lead.capturedAt,
    pendente: true,
  }));
  const leads = [...pendingLeads, ...synchronized].sort((first, second) => leadCollectionTime(second) - leadCollectionTime(first));
  renderLeadCards(ownLeadsList, leads, "Você ainda não coletou leads.");
  setFeedback(ownLeadsFeedback, `${synchronized.length} sincronizado(s) · ${pending.length} aguardando envio neste aparelho.`, pending.length ? "offline" : "success");
}

async function loadLeads() {
  setFeedback(leadsFeedback, "Carregando leads...");
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const snapshot = await firestoreModule.getDocs(firestoreModule.query(
      firestoreModule.collection(db, "coletaLeads"),
      firestoreModule.orderBy("criadoEm", "desc"),
    ));
    collectedLeads = snapshot.docs.map((document) => ({id: document.id, ...document.data()}));
    renderLeads();
    setFeedback(leadsFeedback, "");
  } catch (error) {
    console.error(error);
    setFeedback(leadsFeedback, "Não foi possível carregar os leads coletados.", "error");
  }
}

function csvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function exportCollectedLeads() {
  const answerColumns = new Map();
  collectedLeads.forEach((lead) => {
    if (!lead.respostas || typeof lead.respostas !== "object") return;
    Object.entries(lead.respostas).forEach(([id, response]) => {
      answerColumns.set(id, response?.rotulo || id);
    });
  });
  const columns = [
    ["nome", "Nome"], ["empresa", "Empresa"], ["cargo", "Cargo"], ["email", "E-mail"], ["whatsapp", "WhatsApp"],
    ["qrCode", "QR Code"], ["vendedor", "Vendedor"], ["coletadoEm", "Coletado em"],
    ...[...answerColumns.entries()].map(([id, label]) => [`resposta:${id}`, label]),
  ];
  const rows = collectedLeads.map((lead) => columns.map(([key]) => {
    const participant = lead.participante || {};
    if (key === "nome") return leadName(lead);
    if (key === "empresa") return leadCompany(lead);
    if (key === "cargo") return participantValue(participant, ["cargo", "job_title", "position", "role"]);
    if (key === "email") return participantValue(participant, ["email", "attendee_email"]);
    if (key === "whatsapp") return participantValue(participant, ["whatsapp", "phone", "cellphone", "mobile", "attendee_phone"]);
    if (key === "qrCode") return lead.qrCode;
    if (key === "vendedor") return lead.vendedorNome || lead.vendedorEmail;
    if (key === "coletadoEm") return formatTimestamp(lead.criadoEm);
    return lead.respostas?.[key.slice("resposta:".length)]?.valor || "";
  }));
  const csv = [columns.map(([, label]) => csvValue(label)).join(";"), ...rows.map((row) => row.map(csvValue).join(";"))].join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], {type: "text/csv;charset=utf-8"}));
  const link = document.createElement("a");
  link.href = url;
  link.download = `leads-coletados-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function lookupParticipant(qrCode) {
  const normalizedQrCode = String(qrCode || "").trim();
  if (!normalizedQrCode) return;
  const offlineParticipant = userId ? await getOfflineParticipant(userId, normalizedQrCode) : null;
  if (offlineParticipant) {
    selectedParticipant = offlineParticipant;
    renderParticipant();
    setFeedback(collectorFeedback, "Participante encontrado na base deste aparelho.", "success");
    return;
  }
  if (!navigator.onLine) {
    selectedParticipant = null;
    renderParticipant();
    setFeedback(collectorFeedback, "Participante não está na base offline deste aparelho. Conecte-se ou atualize a base antes da coleta.", "error");
    return;
  }
  setFeedback(collectorFeedback, "Buscando participante...");
  try {
    const {functions, functionsModule} = await getFunctionsServices();
    const result = await functionsModule.httpsCallable(functions, "get4EventsParticipantByQrCode")({qrCode: normalizedQrCode});
    selectedParticipant = result.data.participant;
    const addedToOfflineBase = await cacheOfflineParticipant(userId, offlineParticipantValue(selectedParticipant));
    renderParticipant();
    setFeedback(collectorFeedback, addedToOfflineBase
      ? "Participante encontrado e incluído na base deste aparelho. Registre os dados da conversa."
      : "Participante encontrado. Registre os dados da conversa.", "success");
    await refreshOfflineStatus();
  } catch (error) {
    console.error(error);
    selectedParticipant = null;
    renderParticipant();
    setFeedback(collectorFeedback, error.message || "Não foi possível encontrar esse participante.", "error");
  }
}

async function startQrReaderFromCamera() {
  if (scanning || !window.Html5Qrcode) {
    if (!window.Html5Qrcode) setFeedback(collectorFeedback, "O leitor de QR Code não foi carregado. Verifique sua conexão.", "error");
    return;
  }
  startQrReader.disabled = true;
  startQrReader.textContent = "Abrindo câmera...";
  try {
    scanner ??= new window.Html5Qrcode(qrReader.id);
    await scanner.start({facingMode: "environment"}, {fps: 10, qrbox: {width: 220, height: 220}}, async (decodedText) => {
      if (scanLocked) return;
      scanLocked = true;
    await stopQrReader();
      showScanSuccess(decodedText);
      await lookupParticipant(decodedText);
    }, () => {});
    scanning = true;
    scanLocked = false;
    startQrReader.textContent = "Câmera ativa — aponte para o QR Code";
  } catch (error) {
    console.error(error);
    startQrReader.disabled = false;
    startQrReader.textContent = "Ler QR Code pela câmera";
    setFeedback(collectorFeedback, "Não foi possível acessar a câmera. Verifique a permissão do navegador.", "error");
  }
}

function updateFieldFormVisibility() {
  if (!fieldType || !fieldForm) return;
  const hasOptions = fieldType.value === "selecao" || fieldType.value === "multipla-escolha";
  const isCheckbox = fieldType.value === "checkbox";
  fieldOptions.hidden = !hasOptions;
  fieldForm.elements.opcoes.required = hasOptions;
  checkboxBehavior.hidden = !isCheckbox;
  if (!isCheckbox) fieldForm.elements.abreDependentes.checked = false;
  dependentQuestions.hidden = !isCheckbox || !fieldForm.elements.abreDependentes.checked;
  fieldForm.elements.perguntasDependentes.required = isCheckbox && fieldForm.elements.abreDependentes.checked;
}

fieldType?.addEventListener("change", updateFieldFormVisibility);
fieldForm?.elements.abreDependentes?.addEventListener("change", updateFieldFormVisibility);

topicForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isAdmin || !topicForm.reportValidity()) return;
  topicSave.disabled = true;
  const previousTopics = configuredTopics;
  try {
    const form = new FormData(topicForm);
    configuredTopics = [...configuredTopics, {
      id: `topico_${crypto.randomUUID().replaceAll("-", "")}`,
      titulo: String(form.get("titulo") || "").trim(),
    }];
    await saveConfiguredFields();
    topicForm.reset();
    setFeedback(adminFeedback, "Tópico adicionado.", "success");
  } catch (error) {
    console.error(error);
    configuredTopics = previousTopics;
    renderConfiguredFields();
    setFeedback(adminFeedback, "Não foi possível adicionar o tópico.", "error");
  } finally {
    topicSave.disabled = false;
  }
});

fieldForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isAdmin || !fieldForm.reportValidity()) return;
  const form = new FormData(fieldForm);
  const tipo = String(form.get("tipo"));
  const opcoes = String(form.get("opcoes") || "").split("\n").map((option) => option.trim()).filter(Boolean);
  const topicoId = String(form.get("topicoId") || "");
  if (!configuredTopics.some((topic) => topic.id === topicoId)) {
    setFeedback(adminFeedback, "Selecione um tópico válido.", "error");
    return;
  }
  if ((tipo === "selecao" || tipo === "multipla-escolha") && !opcoes.length) {
    setFeedback(adminFeedback, "Informe ao menos uma opção para essa pergunta.", "error");
    return;
  }
  const opensDependents = tipo === "checkbox" && form.get("abreDependentes") === "on";
  const dependentLabels = String(form.get("perguntasDependentes") || "").split("\n").map((label) => label.trim()).filter(Boolean);
  if (opensDependents && !dependentLabels.length) {
    setFeedback(adminFeedback, "Informe ao menos uma pergunta dependente.", "error");
    return;
  }
  fieldSave.disabled = true;
  const previousFields = configuredFields;
  try {
    const fieldId = `campo_${crypto.randomUUID().replaceAll("-", "")}`;
    configuredFields = [...configuredFields, {
      id: fieldId,
      rotulo: String(form.get("rotulo") || "").trim(),
      tipo,
      obrigatorio: form.get("obrigatorio") === "on",
      opcoes,
      topicoId,
      dependeDe: "",
    }, ...dependentLabels.map((rotulo) => ({
      id: `campo_${crypto.randomUUID().replaceAll("-", "")}`,
      rotulo,
      tipo: "texto",
      obrigatorio: false,
      opcoes: [],
      topicoId,
      dependeDe: fieldId,
    }))];
    await saveConfiguredFields();
    fieldForm.reset();
    updateFieldFormVisibility();
    setFeedback(adminFeedback, "Pergunta adicionada.", "success");
  } catch (error) {
    console.error(error);
    configuredFields = previousFields;
    renderConfiguredFields();
    setFeedback(adminFeedback, "Não foi possível adicionar a pergunta.", "error");
  } finally {
    fieldSave.disabled = !configuredTopics.length;
  }
});

sellerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isAdmin || !sellerForm.reportValidity()) return;
  sellerSave.disabled = true;
  sellerSave.textContent = "Cadastrando...";
  try {
    const form = new FormData(sellerForm);
    const {functions, functionsModule} = await getFunctionsServices();
    const result = await functionsModule.httpsCallable(functions, "createLeadSeller")({
      nome: String(form.get("nome") || "").trim(),
      email: String(form.get("email") || "").trim(),
      senha: String(form.get("senha") || ""),
    });
    sellerForm.reset();
    setFeedback(adminFeedback, result.data.created ? "Conta de vendedor criada." : "Papel de vendedor atribuído à conta existente.", "success");
    await loadSellers();
  } catch (error) {
    console.error(error);
    setFeedback(adminFeedback, error.message || "Não foi possível cadastrar o vendedor.", "error");
  } finally {
    sellerSave.disabled = false;
    sellerSave.textContent = "Cadastrar vendedor";
  }
});

manualQrForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isSeller || !manualQrForm.reportValidity()) return;
  await stopQrReader();
  await lookupParticipant(new FormData(manualQrForm).get("qrCode"));
  if (selectedParticipant) {
    manualSearchModal.close();
    manualQrForm.reset();
  }
});

startQrReader.addEventListener("click", startQrReaderFromCamera);
downloadOffline.addEventListener("click", downloadOfflineParticipants);
syncOffline.addEventListener("click", () => { void synchronizeOfflineLeads(); });
openManualSearch.addEventListener("click", () => {
  manualSearchModal.showModal();
  window.setTimeout(() => manualQrForm.elements.qrCode.focus(), 0);
});
document.querySelectorAll("[data-manual-search-close]").forEach((button) => button.addEventListener("click", () => manualSearchModal.close()));
openOwnLeads.addEventListener("click", () => {
  ownLeadsModal.showModal();
  void loadOwnLeads();
});
document.querySelectorAll("[data-own-leads-close]").forEach((button) => button.addEventListener("click", () => ownLeadsModal.close()));
window.addEventListener("online", () => { void synchronizeOfflineLeads(); });
reloadLeads.addEventListener("click", () => { if (isAdmin) void loadLeads(); });
exportLeads.addEventListener("click", exportCollectedLeads);
document.querySelectorAll("[data-lead-details-close]").forEach((button) => button.addEventListener("click", () => leadDetailsModal.close()));
clearLead.addEventListener("click", () => {
  selectedParticipant = null;
  manualQrForm.reset();
  leadForm.reset();
  renderParticipant();
  setFeedback(collectorFeedback, "Pronto para uma nova leitura.");
});

leadPrevious.addEventListener("click", () => {
  showLeadTopic(currentTopicIndex - 1);
  leadTopicProgress.scrollIntoView({behavior: "smooth", block: "nearest"});
});

leadNext.addEventListener("click", () => {
  if (!validateTopic(currentTopicIndex)) return;
  showLeadTopic(currentTopicIndex + 1);
  leadTopicProgress.scrollIntoView({behavior: "smooth", block: "nearest"});
});

function refreshHighlightedQuestion(event) {
  const question = event.target.closest?.("[data-lead-question]");
  if (!question?.classList.contains("lead-question-invalid")) return;
  const multipleChoice = question.matches('[data-multiple-field][data-required="true"]');
  const enabledControls = [...question.querySelectorAll("input, textarea, select")]
    .filter((control) => !control.disabled);
  if (multipleChoice && enabledControls.some((control) => control.checked)) {
    enabledControls.forEach((control) => control.setCustomValidity(""));
  }
  const isInvalid = multipleChoice
    ? !enabledControls.some((control) => control.checked)
    : enabledControls.some((control) => !control.checkValidity());
  question.classList.toggle("lead-question-invalid", isInvalid);
  if (isInvalid) question.setAttribute("aria-invalid", "true");
  else question.removeAttribute("aria-invalid");
  const currentStep = activeLeadSteps()[currentTopicIndex];
  if (currentStep && !currentStep.querySelector(".lead-question-invalid")) setFeedback(leadFeedback, "");
}

leadForm.addEventListener("input", refreshHighlightedQuestion);
leadForm.addEventListener("change", refreshHighlightedQuestion);

leadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isSeller || !selectedParticipant || !validateAllTopics()) return;
  const leadData = new FormData(leadForm);
  const respostas = Object.fromEntries(configuredFields.map((field) => {
    if (field.tipo === "checkbox") return [field.id, leadData.has(field.id) ? "true" : "false"];
    if (field.dependeDe && !leadData.has(field.dependeDe)) return [field.id, ""];
    if (field.tipo === "multipla-escolha" && field.permiteMultiplaSelecao) {
      return [field.id, leadData.getAll(field.id).map(String)];
    }
    return [field.id, leadData.get(field.id) || ""];
  }));
  leadSave.disabled = true;
  leadSave.textContent = "Salvando no aparelho...";
  try {
    const offlineId = crypto.randomUUID().replaceAll("-", "");
    await queueOfflineLead({
      id: offlineId,
      userId,
      qrCode: selectedParticipant.qrCode,
      respostas,
      capturedAt: Date.now(),
      participant: offlineParticipantValue(selectedParticipant),
    });
    selectedParticipant = null;
    manualQrForm.reset();
    leadForm.reset();
    renderParticipant();
    setFeedback(collectorFeedback, navigator.onLine
      ? "Lead salvo neste aparelho e enviado automaticamente. Pronto para a próxima conversa."
      : "Lead salvo neste aparelho. Ele será enviado automaticamente quando a internet voltar.", "success");
    await refreshOfflineStatus();
    void synchronizeOfflineLeads();
  } catch (error) {
    console.error(error);
    setFeedback(leadFeedback, error.message || "Não foi possível salvar o lead.", "error");
  } finally {
    leadSave.disabled = false;
    leadSave.textContent = "Salvar lead";
  }
});

const {auth, authModule} = await getAuthServices();
authModule.onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  let profileData = null;
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const profile = await firestoreModule.getDoc(firestoreModule.doc(db, "users", user.uid));
    if (profile.exists()) {
      profileData = profile.data();
      saveOfflineProfile(user.uid, profileData);
    }
  } catch (error) {
    profileData = getOfflineProfile(user.uid);
    if (!profileData) {
      setFeedback(collectorFeedback, "Não foi possível confirmar seu acesso neste aparelho. Conecte-se uma vez antes de usar a coleta offline.", "error");
      return;
    }
    setFeedback(collectorFeedback, "Sem conexão: usando a autorização salva neste aparelho.", "offline");
  }
  if (profileData?.active === false) {
    await authModule.signOut(auth);
    return;
  }
  userId = user.uid;
  isAdmin = profileData?.roles?.admin === true;
  isSeller = !isAdmin && profileData?.active !== false && profileData?.roles?.vendedor === true;
  if (!isAdmin && !isSeller) {
    window.location.replace("/app/");
    return;
  }
  adminPanels.forEach((panel) => { panel.hidden = !isAdmin; });
  sellerPanel.hidden = !isSeller;
  if (isAdmin) {
    pageEyebrow.textContent = "Administração";
    pageDescription.textContent = "Cadastre vendedores e acompanhe os leads registrados durante o evento.";
    try {
      const {functions, functionsModule} = await getFunctionsServices();
      await functionsModule.httpsCallable(functions, "consolidateCollectionStaff")();
    } catch (error) {
      console.error("Não foi possível consolidar os perfis legados.", error);
    }
    await Promise.all([loadConfiguredFields(), loadSellers(), loadLeads()]);
  } else {
    registerOfflineShell();
    await loadConfiguredFields();
    await refreshOfflineStatus();
    void (async () => {
      await synchronizeOfflineLeads();
      await prepareOfflineBaseOnLogin();
    })();
  }
});

window.addEventListener("beforeunload", () => { void stopQrReader(); });
