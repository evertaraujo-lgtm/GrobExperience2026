import {getAuthServices, getFirestoreServices, getFunctionsServices} from "/js/firebase-client.js";

const CAMPAIGN_ID = "participacao-chegando";
const TEMPLATE_NAME = "participacao_chegando";
const total = document.querySelector("[data-total]");
const quotaUsed = document.querySelector("[data-quota-used]");
const daysContainer = document.querySelector("[data-days]");
const search = document.querySelector("[data-search]");
const feedback = document.querySelector("[data-feedback]");
const campaignState = document.querySelector("[data-campaign-state]");
const fileSeal = document.querySelector("[data-file-seal]");
const fileNameLabel = document.querySelector("[data-file-name]");
const fileHashLabel = document.querySelector("[data-file-hash]");
const testStatus = document.querySelector("[data-test-status]");
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
const previewSeal = document.querySelector("[data-preview-seal]");
const previewList = document.querySelector("[data-preview-list]");
const previewConfirm = document.querySelector("[data-preview-confirm]");
const previewFeedback = document.querySelector("[data-preview-feedback]");
const previewClose = document.querySelectorAll("[data-preview-close]");
const confirmationLabel = document.querySelector("[data-confirmation-label]");
const confirmationInput = document.querySelector("[data-confirmation-input]");
const testOpen = document.querySelector("[data-test-open]");
const testModal = document.querySelector("[data-test-modal]");
const testForm = document.querySelector("[data-test-form]");
const testSubmit = document.querySelector("[data-test-submit]");
const testApprove = document.querySelector("[data-test-approve]");
const testFeedback = document.querySelector("[data-test-feedback]");
const testClose = document.querySelectorAll("[data-test-close]");

let firestoreServices;
let xlsxModule;
let currentCampaign = {};
let loadedParticipants = [];
let currentPreviewId = "";
let currentConfirmationCode = "";
let currentTestMessageId = "";
let unsubscribeCampaign;
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

function operationalStatus(data) {
  if (!data.versaoLista) return {label: "Sem planilha", state: "draft"};
  if (data.statusOperacional === "em_andamento") return {label: "Envios iniciados", state: "progress"};
  if (data.testeAprovadoEm) return {label: "Pronta para envio", state: "ready"};
  if (data.testeMensagemId) return {label: "Teste aguardando aprovação", state: "draft"};
  return {label: "Teste obrigatório", state: "draft"};
}

function renderCampaign(data) {
  currentCampaign = data;
  const status = operationalStatus(data);
  campaignState.textContent = status.label;
  campaignState.dataset.state = status.state;
  fileSeal.hidden = !data.versaoLista;
  fileNameLabel.textContent = data.arquivoNome || "—";
  fileHashLabel.textContent = data.arquivoHash ? data.arquivoHash.slice(0, 16) : "—";
  testStatus.textContent = data.testeAprovadoEm ? `Aprovado em ${formatDateTime(data.testeAprovadoEm)}` : data.testeMensagemId ? "Aguardando aprovação" : "Não realizado";
  importOpen.disabled = Number(data.enviosAceitos || 0) > 0;
  importOpen.title = importOpen.disabled ? "A lista foi bloqueada após o primeiro envio." : "Importar planilha";
  if (loadedParticipants.length) renderParticipants(loadedParticipants);
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
  loadedParticipants = participants;
  daysContainer.replaceChildren();
  total.textContent = `${participants.length} destinatário(s)`;
  if (!participants.length) {
    daysContainer.innerHTML = '<p class="empty-state">Importe a planilha exclusiva desta campanha para criar os lotes.</p>';
    return;
  }
  const groups = new Map();
  participants.forEach((participant) => {
    const group = Number(participant.lote) || 1;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(participant);
  });
  [...groups.entries()].sort(([first], [second]) => first - second).forEach(([group, entries]) => {
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
    title.querySelector(".reminder-day-number").textContent = group;
    title.querySelector("h2").textContent = `Lote ${group}`;
    title.querySelector("p").textContent = `${entries.length} destinatário(s) em ordem alfabética`;
    const summary = title.querySelector(".reminder-status-summary");
    Object.entries(statusCounts).forEach(([status, count]) => {
      const item = document.createElement("span");
      item.textContent = `${statusLabel(status)}: ${count}`;
      summary.append(item);
    });
    const send = document.createElement("button");
    send.className = "button save-status";
    send.type = "button";
    send.textContent = !eligible.length ? "Lote concluído" : currentCampaign.testeAprovadoEm ? `Prévia do Lote ${group}` : "Aguardando teste";
    send.disabled = !eligible.length || !currentCampaign.testeAprovadoEm;
    send.addEventListener("click", () => openPreview(group));
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
  unsubscribeCampaign?.();
  unsubscribeParticipants?.();
  unsubscribeQuota?.();
  unsubscribeCampaign = firestore.onSnapshot(firestore.doc(db, "campanhasWhatsapp", CAMPAIGN_ID), (snapshot) => {
    renderCampaign(snapshot.data() || {});
  }, (error) => {
    console.error(error);
    setFeedback("Não foi possível carregar a configuração da campanha.", "error");
  });
  const participantsQuery = firestore.query(
    firestore.collection(db, "campanhasWhatsapp", CAMPAIGN_ID, "destinatarios"),
    firestore.orderBy("ordem"),
  );
  unsubscribeParticipants = firestore.onSnapshot(participantsQuery, (snapshot) => {
    renderParticipants(snapshot.docs.map((document) => ({id: document.id, ...document.data()})));
  }, (error) => {
    console.error(error);
    setFeedback("Não foi possível carregar os destinatários desta campanha.", "error");
  });
  unsubscribeQuota = firestore.onSnapshot(
    firestore.doc(db, "campanhasWhatsappControleDiario", `${CAMPAIGN_ID}_${todayKey()}`),
    (snapshot) => { quotaUsed.textContent = String(snapshot.data()?.tentativas || 0); },
  );
}

async function callable(name, payload) {
  const {functions, functionsModule} = await getFunctionsServices();
  return (await functionsModule.httpsCallable(functions, name)(payload)).data;
}

function previewSealRow(label, value, code = false) {
  const row = document.createElement("div");
  const caption = document.createElement("span");
  const content = document.createElement(code ? "code" : "strong");
  caption.textContent = label;
  content.textContent = value;
  row.append(caption, content);
  return row;
}

function updateConfirmationButton() {
  previewConfirm.disabled = !currentPreviewId || normalizedConfirmationCode(confirmationInput.value) !== currentConfirmationCode;
}

function normalizedConfirmationCode(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

async function openPreview(group) {
  currentPreviewId = "";
  currentConfirmationCode = "";
  previewTitle.textContent = `Prévia do Lote ${group}`;
  previewSummary.textContent = "Validando campanha, template, planilha e cota diária...";
  previewSeal.replaceChildren();
  previewList.replaceChildren();
  confirmationInput.value = "";
  confirmationInput.disabled = true;
  previewFeedback.textContent = "";
  previewConfirm.disabled = true;
  previewModal.showModal();
  try {
    const data = await callable("previewWhatsAppCampaignBatch", {campanhaId: CAMPAIGN_ID, lote: group});
    currentPreviewId = data.previewId;
    currentConfirmationCode = data.campaign.codigoConfirmacao;
    confirmationLabel.textContent = currentConfirmationCode;
    confirmationInput.disabled = data.recipients.length === 0;
    previewSeal.append(
      previewSealRow("Campanha", data.campaign.nome),
      previewSealRow("Template fixado", data.campaign.template, true),
      previewSealRow("Planilha", data.file.nome),
      previewSealRow("Identificador da planilha", String(data.file.hash || "—").slice(0, 16), true),
      previewSealRow("Prévia", data.previewId.slice(0, 12), true),
    );
    data.recipients.forEach((recipient) => {
      const item = document.createElement("li");
      const name = document.createElement("strong");
      const phone = document.createElement("span");
      name.textContent = recipient.nome;
      phone.textContent = recipient.whatsapp;
      item.append(name, phone);
      previewList.append(item);
    });
    previewSummary.textContent = `${data.recipients.length} destinatário(s) estão congelados nesta prévia por 15 minutos. Cota de hoje: ${data.usedToday}/${data.dailyLimit} utilizada; ${data.availableToday} disponível(is).${data.skipped ? ` ${data.skipped} registro(s) já processado(s) serão ignorados.` : ""}${data.notIncludedByLimit ? ` ${data.notIncludedByLimit} registro(s) ficaram fora pelo limite diário.` : ""}`;
    if (!data.recipients.length) {
      previewFeedback.textContent = data.availableToday === 0 ? `A cota diária de ${data.dailyLimit} já foi utilizada.` : "Não há mensagens pendentes neste lote.";
    }
  } catch (error) {
    console.error(error);
    previewFeedback.textContent = error.message || "Não foi possível gerar a prévia.";
    previewFeedback.dataset.state = "error";
  }
}

confirmationInput.addEventListener("input", updateConfirmationButton);
previewConfirm.addEventListener("click", async () => {
  if (!currentPreviewId || normalizedConfirmationCode(confirmationInput.value) !== currentConfirmationCode) return;
  previewConfirm.disabled = true;
  previewConfirm.textContent = "Enviando...";
  confirmationInput.disabled = true;
  previewFeedback.textContent = "Mantenha esta janela aberta enquanto o lote congelado é processado.";
  previewFeedback.dataset.state = "neutral";
  try {
    const result = await callable("sendWhatsAppCampaignBatch", {
      previewId: currentPreviewId,
      codigoConfirmacao: normalizedConfirmationCode(confirmationInput.value),
    });
    const failures = Array.isArray(result.failures) ? result.failures.length : 0;
    setFeedback(`Lote ${result.group}: ${result.sent} mensagem(ns) aceita(s), ${result.skipped} ignorada(s) e ${failures} falha(s). Cota de hoje: ${result.usedToday}/${result.dailyLimit}.`, failures ? "error" : "success");
    previewModal.close();
  } catch (error) {
    console.error(error);
    previewFeedback.textContent = error.message || "Não foi possível enviar o lote.";
    previewFeedback.dataset.state = "error";
  } finally {
    previewConfirm.textContent = "Confirmar envio";
    confirmationInput.disabled = false;
    updateConfirmationButton();
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

async function sha256(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

importOpen.addEventListener("click", () => {
  if (importOpen.disabled) return;
  importForm.hidden = false;
  importFile.click();
});
importCancel.addEventListener("click", () => {
  importForm.hidden = true;
  importFile.value = "";
  importFileName.textContent = "Nenhuma planilha selecionada.";
});
importFile.addEventListener("change", () => { importFileName.textContent = importFile.files[0]?.name || "Nenhuma planilha selecionada."; });
importForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = importFile.files[0];
  if (!file) return;
  importSubmit.disabled = true;
  importSubmit.textContent = "Lendo planilha...";
  importFeedback.textContent = "";
  try {
    const bytes = await file.arrayBuffer();
    const fileHash = await sha256(bytes);
    xlsxModule ??= await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
    const workbook = xlsxModule.read(bytes, {type: "array"});
    const parsed = spreadsheetParticipants(xlsxModule, workbook.Sheets[workbook.SheetNames[0]]);
    const confirmation = `Campanha: Participação chegando\nTemplate: ${TEMPLATE_NAME}\nPlanilha: ${file.name}\nIdentificador: ${fileHash.slice(0, 16)}\nDestinatários válidos: ${parsed.participants.length}\nLotes de até 250: ${Math.ceil(parsed.participants.length / 250)}\n\nImportar esta combinação?`;
    if (!window.confirm(confirmation)) return;
    importSubmit.textContent = "Importando...";
    const result = await callable("importWhatsAppCampaignParticipants", {
      campanhaId: CAMPAIGN_ID,
      participantes: parsed.participants,
      arquivoNome: file.name,
      arquivoHash: fileHash,
    });
    importFeedback.textContent = `${result.importados} destinatário(s) vinculados ao template ${TEMPLATE_NAME} em ${result.lotes} lote(s).${result.duplicadosIgnorados ? ` ${result.duplicadosIgnorados} duplicado(s) ignorado(s).` : ""}${parsed.invalid.length ? ` ${parsed.invalid.length} linha(s) inválida(s) ignorada(s).` : ""}`;
    importFeedback.dataset.state = "success";
    setFeedback("Planilha vinculada. Confira o estado do teste antes de gerar a prévia.", "success");
    importFile.value = "";
    importFileName.textContent = "Nenhuma planilha selecionada.";
  } catch (error) {
    console.error(error);
    importFeedback.textContent = error.message || "Não foi possível importar a planilha.";
    importFeedback.dataset.state = "error";
  } finally {
    importSubmit.disabled = false;
    importSubmit.textContent = "Revisar e importar";
  }
});

testOpen.addEventListener("click", () => {
  testForm.reset();
  currentTestMessageId = "";
  testApprove.hidden = true;
  testFeedback.textContent = "";
  testModal.showModal();
  testForm.elements.nome.focus();
});
testForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!testForm.reportValidity()) return;
  testSubmit.disabled = true;
  testSubmit.textContent = "Enviando...";
  testFeedback.textContent = `Enviando o template fixado ${TEMPLATE_NAME} pela Meta...`;
  try {
    const result = await callable("sendWhatsAppCampaignTest", {
      campanhaId: CAMPAIGN_ID,
      nome: testForm.elements.nome.value,
      whatsapp: testForm.elements.whatsapp.value,
    });
    currentTestMessageId = result.messageId;
    testFeedback.textContent = `Teste aceito pela Meta. Confira o texto e os botões “${result.botoesFixos.join("” e “")}” no aparelho antes de aprovar.`;
    testFeedback.dataset.state = "success";
    testApprove.hidden = false;
  } catch (error) {
    console.error(error);
    testFeedback.textContent = error.message || "Não foi possível enviar o teste.";
    testFeedback.dataset.state = "error";
  } finally {
    testSubmit.disabled = false;
    testSubmit.textContent = "Enviar teste";
  }
});
testApprove.addEventListener("click", async () => {
  if (!currentTestMessageId || !window.confirm("Você recebeu a mensagem, conferiu o texto e testou os dois botões de URL fixa?")) return;
  testApprove.disabled = true;
  testApprove.textContent = "Aprovando...";
  try {
    await callable("approveWhatsAppCampaignTest", {
      campanhaId: CAMPAIGN_ID,
      messageId: currentTestMessageId,
      confirmado: true,
    });
    testFeedback.textContent = "Teste aprovado. As prévias dos lotes foram liberadas.";
    testFeedback.dataset.state = "success";
    setFeedback("Campanha pronta para gerar prévias e enviar lotes.", "success");
    testApprove.hidden = true;
  } catch (error) {
    console.error(error);
    testFeedback.textContent = error.message || "Não foi possível aprovar o teste.";
    testFeedback.dataset.state = "error";
  } finally {
    testApprove.disabled = false;
    testApprove.textContent = "Recebi e aprovei o teste";
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
