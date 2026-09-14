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
const fieldForm = document.querySelector("[data-field-form]");
const fieldSave = document.querySelector("[data-field-save]");
const fieldType = fieldForm.elements.tipo;
const fieldOptions = document.querySelector("[data-field-options]");
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
let configuredFields = [];
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

function normalizedFields(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((field) => field && typeof field === "object"
    && typeof field.id === "string" && typeof field.rotulo === "string"
    && ["texto", "texto-longo", "numero", "selecao"].includes(field.tipo));
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

function renderConfiguredFields() {
  fieldsList.replaceChildren();
  fieldsTotal.textContent = `${configuredFields.length} cadastrado(s)`;
  if (!configuredFields.length) {
    fieldsList.innerHTML = '<p class="empty-management">Nenhum campo adicional cadastrado.</p>';
    return;
  }
  configuredFields.forEach((field) => {
    const card = document.createElement("article");
    card.className = "management-card";
    const title = document.createElement("h3");
    title.textContent = field.rotulo;
    const details = document.createElement("p");
    const typeLabel = {texto: "Texto curto", "texto-longo": "Texto longo", numero: "Número", selecao: "Seleção"}[field.tipo];
    details.textContent = `${typeLabel}${field.obrigatorio ? " · obrigatório" : ""}${field.opcoes?.length ? ` · ${field.opcoes.join(", ")}` : ""}`;
    const actions = document.createElement("div");
    actions.className = "management-card-actions";
    const remove = document.createElement("button");
    remove.className = "danger-delete";
    remove.type = "button";
    remove.textContent = "Remover";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Remover o campo “${field.rotulo}”? As respostas já registradas serão preservadas.`)) return;
      configuredFields = configuredFields.filter((item) => item.id !== field.id);
      try {
        await saveConfiguredFields();
        setFeedback(adminFeedback, "Campo removido.", "success");
      } catch (error) {
        console.error(error);
        setFeedback(adminFeedback, "Não foi possível remover o campo.", "error");
        await loadConfiguredFields();
      }
    });
    actions.append(remove);
    card.append(title, details, actions);
    fieldsList.append(card);
  });
}

function renderLeadFields() {
  leadFields.replaceChildren();
  if (!configuredFields.length) {
    leadFields.innerHTML = '<p class="empty-management">Não há perguntas adicionais cadastradas. Você ainda pode salvar este lead.</p>';
    return;
  }
  configuredFields.forEach((field) => {
    const label = document.createElement("label");
    label.className = "management-field";
    const title = document.createElement("span");
    title.textContent = field.rotulo + (field.obrigatorio ? " *" : "");
    label.append(title);
    let control;
    if (field.tipo === "texto-longo") {
      control = document.createElement("textarea");
      control.rows = 4;
    } else if (field.tipo === "selecao") {
      control = document.createElement("select");
      const empty = new Option("Selecione", "");
      control.add(empty);
      (field.opcoes || []).forEach((option) => control.add(new Option(option, option)));
    } else {
      control = document.createElement("input");
      control.type = field.tipo === "numero" ? "number" : "text";
    }
    control.name = field.id;
    control.required = field.obrigatorio === true;
    control.maxLength = 2000;
    label.append(control);
    leadFields.append(label);
  });
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
    configuredFields = normalizedFields(snapshot.data()?.campos);
    if (userId) await setOfflineMeta(userId, "fields", configuredFields);
  } catch (error) {
    const cachedFields = userId ? await getOfflineMeta(userId, "fields") : null;
    if (!cachedFields) throw error;
    configuredFields = normalizedFields(cachedFields);
    setFeedback(collectorFeedback, "Usando os campos da conversa salvos neste aparelho.", "offline");
  }
  if (isAdmin) renderConfiguredFields();
  if (isSeller && selectedParticipant) renderLeadFields();
}

async function saveConfiguredFields() {
  const {db, firestoreModule} = await getFirestoreServices();
  await firestoreModule.setDoc(firestoreModule.doc(db, "coletaLeadsConfiguracoes", "campos"), {
    campos: configuredFields,
    atualizadoEm: firestoreModule.serverTimestamp(),
  }, {merge: true});
  if (userId) await setOfflineMeta(userId, "fields", configuredFields);
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

function addDetail(label, value) {
  const item = document.createElement("div");
  item.className = "participant-meta";
  const strong = document.createElement("strong");
  strong.textContent = value || "Não informado";
  const caption = document.createElement("span");
  caption.textContent = label;
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
    responses.forEach((response) => addDetail(response.rotulo || "Resposta", response.valor));
  }
  leadDetailsModal.showModal();
}

function renderLeadCards(target, leads, emptyMessage) {
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
    card.append(title, company, actions);
    target.append(card);
  });
}

function renderLeads() {
  leadsTotal.textContent = `${collectedLeads.length} coletado(s)`;
  exportLeads.disabled = !collectedLeads.length;
  renderLeadCards(leadsList, collectedLeads, "Nenhum lead coletado.");
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

fieldType.addEventListener("change", () => { fieldOptions.hidden = fieldType.value !== "selecao"; });

fieldForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isAdmin || !fieldForm.reportValidity()) return;
  const form = new FormData(fieldForm);
  const tipo = String(form.get("tipo"));
  const opcoes = String(form.get("opcoes") || "").split("\n").map((option) => option.trim()).filter(Boolean);
  if (tipo === "selecao" && !opcoes.length) {
    setFeedback(adminFeedback, "Informe ao menos uma opção para o campo de seleção.", "error");
    return;
  }
  fieldSave.disabled = true;
  try {
    configuredFields.push({
      id: `campo_${crypto.randomUUID().replaceAll("-", "")}`,
      rotulo: String(form.get("rotulo") || "").trim(),
      tipo,
      obrigatorio: form.get("obrigatorio") === "on",
      opcoes,
    });
    await saveConfiguredFields();
    fieldForm.reset();
    fieldOptions.hidden = true;
    setFeedback(adminFeedback, "Campo adicionado.", "success");
  } catch (error) {
    console.error(error);
    configuredFields.pop();
    setFeedback(adminFeedback, "Não foi possível adicionar o campo.", "error");
  } finally {
    fieldSave.disabled = false;
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

leadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isSeller || !selectedParticipant || !leadForm.reportValidity()) return;
  const respostas = Object.fromEntries(configuredFields.map((field) => [field.id, new FormData(leadForm).get(field.id) || ""]));
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
    pageDescription.textContent = "Cadastre vendedores e defina os campos que serão preenchidos durante cada conversa.";
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
