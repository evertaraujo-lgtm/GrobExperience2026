import {getAuthServices, getFirestoreServices, getFunctionsServices} from "/js/firebase-client.js";

const total = document.querySelector("[data-total]");
const quotaUsed = document.querySelector("[data-quota-used]");
const daysContainer = document.querySelector("[data-days]");
const search = document.querySelector("[data-search]");
const feedback = document.querySelector("[data-feedback]");
const importOpen = document.querySelector("[data-import-open]");
const importForm = document.querySelector("[data-import-form]");
const importFile = document.querySelector("[data-import-file]");
const importFileName = document.querySelector("[data-import-file-name]");
const importSubmit = document.querySelector("[data-import-submit]");
const importFeedback = document.querySelector("[data-import-feedback]");
const importCancel = document.querySelector("[data-import-cancel]");
const previewModal = document.querySelector("[data-preview-modal]");
const previewTitle = document.querySelector("[data-preview-title]");
const previewSummary = document.querySelector("[data-preview-summary]");
const previewList = document.querySelector("[data-preview-list]");
const previewConfirm = document.querySelector("[data-preview-confirm]");
const previewFeedback = document.querySelector("[data-preview-feedback]");
const previewClose = document.querySelectorAll("[data-preview-close]");
const testModal = document.querySelector("[data-test-modal]");
const testForm = document.querySelector("[data-test-form]");
const testSubmit = document.querySelector("[data-test-submit]");
const testFeedback = document.querySelector("[data-test-feedback]");
const testClose = document.querySelectorAll("[data-test-close]");

let firestoreServices;
let xlsxModule;
let currentPreviewDay;
let currentPreviewParticipantIds = [];
let unsubscribeParticipants;
let unsubscribeQuota;

const normalize = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

function setFeedback(message, state = "neutral") {
  feedback.textContent = message;
  feedback.dataset.state = state;
}

function formatDateTime(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {dateStyle: "short", timeStyle: "short"}).format(date);
}

function statusLabel(status) {
  return ({
    pendente: "Pendente",
    processando: "Processando",
    aceito: "Aceito pela Meta",
    enviado: "Enviado",
    entregue: "Entregue",
    lido: "Lido",
    falhou: "Falhou",
    apagado: "Apagado",
  })[status] || "Pendente";
}

function participantRow(participant) {
  const row = document.createElement("article");
  row.className = "reminder-row";
  row.dataset.searchValue = normalize(`${participant.nome} ${participant.whatsapp} ${statusLabel(participant.statusMensagem)}`);
  row.innerHTML = '<span class="reminder-order"></span><strong></strong><span></span><span class="reminder-delivery"></span><span></span>';
  row.children[0].textContent = `#${participant.ordem}`;
  row.children[1].textContent = participant.nome;
  row.children[2].textContent = participant.whatsapp;
  row.children[3].textContent = statusLabel(participant.statusMensagem);
  row.children[3].dataset.status = participant.statusMensagem || "pendente";
  row.children[4].textContent = formatDateTime(participant.statusMensagemEm || participant.ultimoEnvioEm);
  return row;
}

function renderParticipants(participants) {
  daysContainer.replaceChildren();
  total.textContent = `${participants.length} participante(s)`;
  if (!participants.length) {
    daysContainer.innerHTML = '<p class="empty-state">Importe uma planilha para montar os dias de envio.</p>';
    return;
  }
  const groups = new Map();
  participants.forEach((participant) => {
    const day = Number(participant.dia) || 1;
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(participant);
  });
  [...groups.entries()].sort(([first], [second]) => first - second).forEach(([day, entries]) => {
    const section = document.createElement("section");
    section.className = "reminder-day";
    const eligible = entries.filter((entry) => !entry.statusMensagem || ["pendente", "falhou"].includes(entry.statusMensagem));
    const statusCounts = entries.reduce((counts, entry) => {
      const status = entry.statusMensagem || "pendente";
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {});
    const header = document.createElement("header");
    header.className = "reminder-day-header";
    const title = document.createElement("div");
    title.className = "reminder-day-title";
    title.innerHTML = '<span class="reminder-day-number"></span><div><h2></h2><p></p><div class="reminder-status-summary"></div></div>';
    title.querySelector(".reminder-day-number").textContent = day;
    title.querySelector("h2").textContent = `Dia ${day}`;
    title.querySelector("p").textContent = `${entries.length} participante(s) em ordem alfabética`;
    const summary = title.querySelector(".reminder-status-summary");
    Object.entries(statusCounts).forEach(([status, count]) => {
      const item = document.createElement("span");
      item.textContent = `${statusLabel(status)}: ${count}`;
      summary.append(item);
    });
    const send = document.createElement("button");
    send.className = "button save-status";
    send.type = "button";
    send.textContent = eligible.length ? `Prévia do Dia ${day}` : "Dia concluído";
    send.disabled = !eligible.length;
    send.addEventListener("click", () => openPreview(day));
    header.append(title, send);
    const rows = document.createElement("div");
    rows.className = "reminder-participants";
    entries.sort((first, second) => first.ordem - second.ordem).forEach((entry) => rows.append(participantRow(entry)));
    section.append(header, rows);
    daysContainer.append(section);
  });
  applySearch();
}

function applySearch() {
  const term = normalize(search.value);
  document.querySelectorAll(".reminder-day").forEach((section) => {
    let visible = 0;
    section.querySelectorAll(".reminder-row").forEach((row) => {
      row.hidden = Boolean(term && !row.dataset.searchValue.includes(term));
      if (!row.hidden) visible += 1;
    });
    section.hidden = visible === 0;
  });
}

function todayKey() {
  const parts = new Intl.DateTimeFormat("en", {timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit"}).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function observeData(db, firestore) {
  unsubscribeParticipants?.();
  unsubscribeQuota?.();
  const participantsQuery = firestore.query(firestore.collection(db, "lembretePresencaParticipantes"), firestore.orderBy("ordem"));
  unsubscribeParticipants = firestore.onSnapshot(participantsQuery, (snapshot) => {
    renderParticipants(snapshot.docs.map((document) => ({id: document.id, ...document.data()})));
  }, (error) => {
    console.error(error);
    setFeedback("Não foi possível carregar a lista independente de lembretes.", "error");
  });
  unsubscribeQuota = firestore.onSnapshot(firestore.doc(db, "lembretePresencaControleDiario", todayKey()), (snapshot) => {
    quotaUsed.textContent = String(snapshot.data()?.tentativas || 0);
  });
}

async function callable(name, payload) {
  const {functions, functionsModule} = await getFunctionsServices();
  return (await functionsModule.httpsCallable(functions, name)(payload)).data;
}

async function openPreview(day) {
  currentPreviewDay = day;
  currentPreviewParticipantIds = [];
  previewTitle.textContent = `Prévia do Dia ${day}`;
  previewSummary.textContent = "Consultando destinatários e cota diária...";
  previewList.replaceChildren();
  previewFeedback.textContent = "";
  previewConfirm.disabled = true;
  previewModal.showModal();
  try {
    const data = await callable("previewPresenceReminderDay", {dia: day});
    currentPreviewParticipantIds = data.recipients.map((recipient) => recipient.id);
    data.recipients.forEach((recipient) => {
      const item = document.createElement("li");
      const name = document.createElement("strong");
      const phone = document.createElement("span");
      name.textContent = recipient.nome;
      phone.textContent = recipient.whatsapp;
      item.append(name, phone);
      previewList.append(item);
    });
    previewSummary.textContent = `${data.recipients.length} destinatário(s) serão enviados agora, em ordem alfabética. Cota de hoje: ${data.usedToday}/${data.dailyLimit} utilizada; ${data.availableToday} disponível(is).${data.skipped ? ` ${data.skipped} registro(s) já processado(s) serão ignorados.` : ""}${data.notIncludedByLimit ? ` ${data.notIncludedByLimit} registro(s) ficaram fora por causa do limite diário.` : ""}`;
    previewConfirm.disabled = data.recipients.length === 0;
    if (!data.recipients.length) {
      previewFeedback.textContent = data.availableToday === 0 ? `A cota diária de ${data.dailyLimit} já foi utilizada.` : "Não há mensagens pendentes neste dia.";
    }
  } catch (error) {
    console.error(error);
    previewFeedback.textContent = error.message || "Não foi possível gerar a prévia.";
    previewFeedback.dataset.state = "error";
  }
}

previewConfirm.addEventListener("click", async () => {
  if (!currentPreviewDay || !currentPreviewParticipantIds.length) return;
  previewConfirm.disabled = true;
  previewConfirm.textContent = "Enviando...";
  previewFeedback.textContent = "Mantenha esta janela aberta enquanto o lote é processado.";
  previewFeedback.dataset.state = "neutral";
  try {
    const result = await callable("sendPresenceReminderDay", {
      dia: currentPreviewDay,
      participanteIds: currentPreviewParticipantIds,
    });
    const failures = Array.isArray(result.failures) ? result.failures.length : 0;
    setFeedback(`Dia ${result.day}: ${result.sent} mensagem(ns) aceita(s), ${result.skipped} ignorada(s) e ${failures} falha(s). Cota de hoje: ${result.usedToday}/${result.dailyLimit}.`, failures ? "error" : "success");
    previewModal.close();
  } catch (error) {
    console.error(error);
    previewFeedback.textContent = error.message || "Não foi possível enviar o lote.";
    previewFeedback.dataset.state = "error";
  } finally {
    previewConfirm.disabled = false;
    previewConfirm.textContent = "Confirmar envio";
  }
});

function normalizedHeader(value) { return normalize(value); }
function isWhatsAppHeader(value) { return ["whatsapp", "celular (whatsapp)", "celular whatsapp", "celular", "telefone", "telefone (whatsapp)"].includes(value); }

function spreadsheetParticipants(XLSX, sheet) {
  const matrix = XLSX.utils.sheet_to_json(sheet, {header: 1, defval: "", raw: true});
  const headerIndex = matrix.findIndex((row) => {
    const headers = row.map(normalizedHeader);
    return headers.includes("nome") && headers.some(isWhatsAppHeader);
  });
  if (headerIndex < 0) throw new Error("Não encontrei as colunas Nome e WhatsApp na planilha.");
  const headers = matrix[headerIndex].map(normalizedHeader);
  const nameIndex = headers.indexOf("nome");
  const phoneIndex = headers.findIndex(isWhatsAppHeader);
  const invalid = [];
  const participants = matrix.slice(headerIndex + 1).filter((row) => row.some((value) => String(value).trim())).map((row, index) => {
    const nome = String(row[nameIndex] ?? "").trim();
    let whatsapp = String(row[phoneIndex] ?? "").replace(/\D/g, "");
    if (whatsapp.startsWith("55") && [12, 13].includes(whatsapp.length)) whatsapp = whatsapp.slice(2);
    if (!nome || whatsapp.length < 10 || whatsapp.length > 11) invalid.push(index + headerIndex + 2);
    return {nome, whatsapp};
  }).filter((participant) => participant.nome && participant.whatsapp.length >= 10 && participant.whatsapp.length <= 11);
  if (!participants.length) throw new Error("Nenhum participante válido foi encontrado.");
  return {participants, invalid};
}

importOpen.addEventListener("click", () => { importForm.hidden = false; importFile.click(); });
importCancel.addEventListener("click", () => { importForm.hidden = true; importFile.value = ""; importFileName.textContent = "Nenhuma planilha selecionada."; });
importFile.addEventListener("change", () => { importFileName.textContent = importFile.files[0]?.name || "Nenhuma planilha selecionada."; });
importForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!importFile.files[0]) return;
  importSubmit.disabled = true;
  importSubmit.textContent = "Lendo planilha...";
  importFeedback.textContent = "";
  try {
    xlsxModule ??= await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
    const workbook = xlsxModule.read(await importFile.files[0].arrayBuffer(), {type: "array"});
    const parsed = spreadsheetParticipants(xlsxModule, workbook.Sheets[workbook.SheetNames[0]]);
    if (!window.confirm(`Importar ${parsed.participants.length} participante(s)? A lista será reorganizada em ordem alfabética e dividida em dias de até 250.`)) return;
    importSubmit.textContent = "Importando...";
    const result = await callable("importPresenceReminderParticipants", {participantes: parsed.participants});
    importFeedback.textContent = `${result.importados} participante(s) distribuído(s) em ${result.dias} dia(s).${result.duplicadosIgnorados ? ` ${result.duplicadosIgnorados} duplicado(s) ignorado(s).` : ""}${parsed.invalid.length ? ` ${parsed.invalid.length} linha(s) inválida(s) ignorada(s).` : ""}`;
    importFeedback.dataset.state = "success";
    setFeedback("Planilha importada e ordenação diária recalculada.", "success");
  } catch (error) {
    console.error(error);
    importFeedback.textContent = error.message || "Não foi possível importar a planilha.";
    importFeedback.dataset.state = "error";
  } finally {
    importSubmit.disabled = false;
    importSubmit.textContent = "Confirmar importação";
  }
});

document.querySelector("[data-test-open]").addEventListener("click", () => {
  testForm.reset();
  testFeedback.textContent = "";
  testModal.showModal();
  testForm.elements.nome.focus();
});
testForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!testForm.reportValidity()) return;
  testSubmit.disabled = true;
  testSubmit.textContent = "Enviando...";
  testFeedback.textContent = "Enviando o template pela Meta...";
  try {
    const result = await callable("sendPresenceReminderTest", {nome: testForm.elements.nome.value, whatsapp: testForm.elements.whatsapp.value});
    testFeedback.textContent = `Teste aceito pela Meta. Mensagem: ${result.messageId}.`;
    testFeedback.dataset.state = "success";
  } catch (error) {
    console.error(error);
    testFeedback.textContent = error.message || "Não foi possível enviar o teste.";
    testFeedback.dataset.state = "error";
  } finally {
    testSubmit.disabled = false;
    testSubmit.textContent = "Enviar teste";
  }
});

previewClose.forEach((button) => button.addEventListener("click", () => previewModal.close()));
testClose.forEach((button) => button.addEventListener("click", () => testModal.close()));
search.addEventListener("input", applySearch);
document.querySelector("[data-reload]").addEventListener("click", () => {
  if (firestoreServices) observeData(firestoreServices.db, firestoreServices.firestoreModule);
});

const {auth, authModule} = await getAuthServices();
authModule.onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  firestoreServices = await getFirestoreServices();
  const profile = await firestoreServices.firestoreModule.getDoc(firestoreServices.firestoreModule.doc(firestoreServices.db, "users", user.uid));
  if (!profile.exists() || profile.data().active === false || profile.data().roles?.admin !== true) {
    window.location.replace("/app/");
    return;
  }
  observeData(firestoreServices.db, firestoreServices.firestoreModule);
});
