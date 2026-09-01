import {getAuthServices, getFirestoreServices, getFunctionsServices} from "/js/firebase-client.js";

const list = document.querySelector("[data-list]");
const total = document.querySelector("[data-total]");
const feedback = document.querySelector("[data-feedback]");
const reload = document.querySelector("[data-reload]");
const search = document.querySelector("[data-search]");
const addToggle = document.querySelector("[data-add-toggle]");
const addEditor = document.querySelector("[data-add-editor]");
const addForm = document.querySelector("[data-add-form]");
const addCancelButtons = document.querySelectorAll("[data-add-cancel]");
const addSave = document.querySelector("[data-add-save]");
const addFeedback = document.querySelector("[data-add-feedback]");
const exportButton = document.querySelector("[data-export]");
const exportEditor = document.querySelector("[data-export-editor]");
const exportForm = document.querySelector("[data-export-form]");
const exportCancel = document.querySelector("[data-export-cancel]");
const exportFields = document.querySelector("[data-export-fields]");
const exportConfirm = document.querySelector("[data-export-confirm]");
const messageEditor = document.querySelector("[data-message-editor]");
const messageForm = document.querySelector("[data-message-form]");
const messageVariantsElement = document.querySelector("[data-message-variants]");
const messageCancel = document.querySelector("[data-message-cancel]");
const messageSave = document.querySelector("[data-message-save]");
const messageRandomize = document.querySelector("[data-message-randomize]");
const messageModalFeedback = document.querySelector("[data-message-modal-feedback]");
const importToggle = document.querySelector("[data-import-toggle]");
const importEditor = document.querySelector("[data-import-editor]");
const importFile = document.querySelector("[data-import-file]");
const importFileName = document.querySelector("[data-import-file-name]");
const importCancel = document.querySelector("[data-import-cancel]");
const importSubmit = document.querySelector("[data-import-submit]");
const importFeedback = document.querySelector("[data-import-feedback]");
const batchSendToggle = document.querySelector("[data-batch-send]");
const batchEditor = document.querySelector("[data-batch-editor]");
const batchPreviewForm = document.querySelector("[data-batch-preview-form]");
const batchPreviewResult = document.querySelector("[data-batch-preview-result]");
const batchLimit = document.querySelector("[data-batch-limit]");
const batchPreviewButton = document.querySelector("[data-batch-preview]");
const batchPreviewFeedback = document.querySelector("[data-batch-preview-feedback]");
const batchRecipients = document.querySelector("[data-batch-recipients]");
const batchSummary = document.querySelector("[data-batch-summary]");
const batchConfirm = document.querySelector("[data-batch-confirm]");
const batchFeedback = document.querySelector("[data-batch-feedback]");
const batchCancelButtons = document.querySelectorAll("[data-batch-cancel]");
const batchBack = document.querySelector("[data-batch-back]");
const inscritosLink = document.querySelector(".inscritos-link");
const statuses = ["pendente", "contatado", "confirmado", "cancelado"];
const defaultMessageVariants = [
  "Olá, {nome}! Notamos que você ainda não escolheu uma data para o GROB Experience. Acesse seu link exclusivo e finalize sua inscrição:\n\n{link}",
  "Olá, {nome}! Falta só escolher a data da sua participação no GROB Experience. Confirme por aqui:\n\n{link}",
  "{nome}, queremos garantir sua vaga no GROB Experience. Selecione uma das datas disponíveis no link:\n\n{link}",
  "Olá, {nome}! Sua pré-inscrição está quase concluída. Escolha sua data preferida neste link:\n\n{link}",
  "{nome}, não deixe sua inscrição pendente. Escolha uma data para o GROB Experience agora:\n\n{link}",
  "Olá, {nome}! Para finalizar sua participação no GROB Experience, basta confirmar uma data:\n\n{link}",
  "{nome}, reservamos este convite para você. Informe sua data de preferência aqui:\n\n{link}",
  "Olá, {nome}! Ainda precisamos da sua escolha de data para concluir a inscrição. Acesse:\n\n{link}",
  "{nome}, sua presença no GROB Experience começa pela escolha da data. Confirme neste link:\n\n{link}",
  "Olá, {nome}! Escolha uma data disponível e finalize sua inscrição no GROB Experience:\n\n{link}",
];
let messageVariants = [...defaultMessageVariants];
let xlsxModulePromise;
let canImport = false;
let loadedParticipants = [];
let participantServices;
let batchRecipientIds = [];

function setFeedback(message, state = "neutral") {
  feedback.textContent = message;
  feedback.dataset.state = state;
}

function label(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Pendente";
}

function applyStatusStyle(select) {
  select.classList.remove("status-pendente", "status-confirmado");
  if (select.value === "pendente" || select.value === "confirmado") {
    select.classList.add(`status-${select.value}`);
  }
}

function setImportFeedback(message, state = "neutral") {
  importFeedback.textContent = message;
  importFeedback.dataset.state = state;
}

function setAddFeedback(message, state = "neutral") {
  addFeedback.textContent = message;
  addFeedback.dataset.state = state;
}

function setMessageModalFeedback(message, state = "neutral") {
  messageModalFeedback.textContent = message;
  messageModalFeedback.dataset.state = state;
}

function setBatchFeedback(message, state = "neutral") {
  batchFeedback.textContent = message;
  batchFeedback.dataset.state = state;
}

function setBatchPreviewFeedback(message, state = "neutral") {
  batchPreviewFeedback.textContent = message;
  batchPreviewFeedback.dataset.state = state;
}

function normalizedHeader(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizedSortName(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
}

function valueFor(row, aliases) {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizedHeader(key), value]));
  const key = aliases.find((alias) => normalized[alias] !== undefined);
  return key ? String(normalized[key]).trim() : "";
}

function isWhatsAppHeader(header) {
  return ["celular (whatsapp)", "celular whatsapp", "whatsapp", "celular", "telefone", "telefone (whatsapp)"]
    .includes(header);
}

function spreadsheetRows(XLSX, sheet) {
  // Telefones desta planilha estão armazenados como números de 13 dígitos.
  // `raw: true` evita que o Excel os apresente em notação científica.
  const matrix = XLSX.utils.sheet_to_json(sheet, {header: 1, defval: "", raw: true});
  const headerIndex = matrix.findIndex((row) => {
    const headers = row.map(normalizedHeader);
    return headers.includes("nome") && headers.some(isWhatsAppHeader);
  });
  if (headerIndex === -1) {
    throw new Error("Não encontrei os cabeçalhos Nome e Celular (WhatsApp) na planilha.");
  }
  const headers = matrix[headerIndex].map(normalizedHeader);
  return matrix.slice(headerIndex + 1)
    .filter((values) => values.some((value) => String(value).trim()))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function normalizeWhatsApp(value) {
  let phone = String(value).replace(/\D/g, "");
  if (phone.startsWith("55") && (phone.length === 12 || phone.length === 13)) phone = phone.slice(2);
  return phone;
}

function makeToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getXlsxModule() {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
  }
  return xlsxModulePromise;
}

function formatDate(value) {
  const dates = {"2026-09-22": "22 de setembro", "2026-09-23": "23 de setembro", "2026-09-24": "24 de setembro"};
  return dates[value] || "Ainda não escolhida";
}

function formatDateTime(value) {
  if (!value) return "Aguardando retorno";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "Aguardando retorno";
  return new Intl.DateTimeFormat("pt-BR", {dateStyle: "short", timeStyle: "short"}).format(date);
}

function whatsappDeliveryLabel(status) {
  const labels = {
    pendente: "Pendente",
    processando: "Processando",
    aceito: "Aceito pela Meta",
    enviado: "Enviado",
    entregue: "Entregue",
    lido: "Lido",
    falhou: "Falhou",
    apagado: "Apagado",
  };
  return labels[status] || "Pendente";
}

function csvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

const exportColumns = {
  email: {label: "E-mail", value: (participant) => participant.email},
  empresa: {label: "Empresa", value: (participant) => participant.empresa},
  status: {label: "Status", value: (participant) => label(participant.status || participant.inviteStatus || "pendente")},
  dataSelecionada: {label: "Data selecionada", value: (participant) => formatDate(participant.dataSelecionada)},
  linkPublico: {label: "Link público", value: (participant) => participant.linkPublico},
  mensagemWhatsApp: {label: "Mensagem WhatsApp", value: (participant) => participant.mensagemWhatsApp || (messageVariants[0]
    .replaceAll("{nome}", participant.nome || "participante")
    .replaceAll("{link}", participant.linkPublico || ""))},
};

async function getParticipantsWithInvitations() {
  const {db, firestoreModule} = await getFirestoreServices();
  const participantsQuery = firestoreModule.query(
    firestoreModule.collection(db, "preInscritos"),
    firestoreModule.orderBy("nomeOrdenacao"),
  );
  const snapshots = await firestoreModule.getDocs(participantsQuery);
  const participants = await Promise.all(snapshots.docs.map(async (document) => {
    const participant = {reference: document.ref, ...document.data()};
    if (participant.tokenPublico) {
      const invite = await firestoreModule.getDoc(firestoreModule.doc(db, "linksPublicos", participant.tokenPublico));
      if (invite.exists()) Object.assign(participant, {dataSelecionada: invite.data().dataSelecionada, inviteStatus: invite.data().status});
    }
    return participant;
  }));
  return {db, firestoreModule, participants};
}

function whatsappLink(participant) {
  const phone = participant.whatsapp.replace(/\D/g, "");
  const destination = phone.startsWith("55") ? phone : `55${phone}`;
  const message = (participant.mensagemWhatsApp || messageVariants[0])
    .replaceAll("{nome}", participant.nome)
    .replaceAll("{link}", participant.linkPublico);
  return `https://wa.me/${destination}?text=${encodeURIComponent(message)}`;
}

async function loadMessageTemplate(db, firestore) {
  const reference = firestore.doc(db, "configuracoes", "mensagens");
  const snapshot = await firestore.getDoc(reference);
  if (!snapshot.exists()) return;
  const savedVariants = snapshot.data().whatsappConviteVariantes;
  if (Array.isArray(savedVariants) && savedVariants.length === 10 && savedVariants.every((value) => typeof value === "string")) {
    messageVariants = savedVariants;
  } else if (typeof snapshot.data().whatsappConvite === "string") {
    messageVariants = [snapshot.data().whatsappConvite, ...defaultMessageVariants.slice(1)];
  }
}

function renderMessageVariants() {
  messageVariantsElement.replaceChildren();
  messageVariants.forEach((message, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "message-variant";
    const labelElement = document.createElement("label");
    const fieldId = `whatsapp-message-${index + 1}`;
    labelElement.htmlFor = fieldId;
    labelElement.textContent = `Mensagem ${index + 1}`;
    const textarea = document.createElement("textarea");
    textarea.id = fieldId;
    textarea.rows = 5;
    textarea.value = message;
    textarea.dataset.messageVariant = String(index);
    wrapper.append(labelElement, textarea);
    messageVariantsElement.append(wrapper);
  });
}

function readMessageVariants() {
  return [...messageVariantsElement.querySelectorAll("[data-message-variant]")]
    .map((textarea) => textarea.value.trim());
}

function validateMessageVariants(variants) {
  return variants.length === 10 && variants.every((value) => value.includes("{nome}") && value.includes("{link}"));
}

async function saveMessageVariants() {
  const variants = readMessageVariants();
  if (!validateMessageVariants(variants)) {
    throw new Error("Cada uma das 10 mensagens precisa conter as variáveis {nome} e {link}.");
  }
  const {db, firestoreModule} = await getFirestoreServices();
  const reference = firestoreModule.doc(db, "configuracoes", "mensagens");
  const data = {
    whatsappConvite: variants[0],
    whatsappConviteVariantes: variants,
    atualizadoEm: firestoreModule.serverTimestamp(),
  };
  try {
    await firestoreModule.updateDoc(reference, data);
  } catch (error) {
    if (error.code !== "not-found") throw error;
    await firestoreModule.setDoc(reference, data);
  }
  messageVariants = variants;
}

async function repopulateMessagesFromDashboard() {
  const {db, firestoreModule} = await getFirestoreServices();
  const snapshots = await firestoreModule.getDocs(firestoreModule.collection(db, "preInscritos"));
  let batch = firestoreModule.writeBatch(db);
  let pendingOperations = 0;

  async function commitBatch() {
    if (pendingOperations) await batch.commit();
    batch = firestoreModule.writeBatch(db);
    pendingOperations = 0;
  }

  for (const participant of snapshots.docs) {
    const data = participant.data();
    const variantIndex = Math.floor(Math.random() * messageVariants.length);
    const template = messageVariants[variantIndex];
    const nome = typeof data.nome === "string" && data.nome.trim() ? data.nome.trim() : "participante";
    const link = typeof data.linkPublico === "string" ? data.linkPublico : "";
    batch.update(participant.ref, {
      mensagemWhatsApp: template.replaceAll("{nome}", nome).replaceAll("{link}", link),
      mensagemVariante: variantIndex + 1,
      mensagemAtualizadaEm: firestoreModule.serverTimestamp(),
    });
    pendingOperations += 1;
    if (pendingOperations === 450) await commitBatch();
  }
  await commitBatch();
  return snapshots.size;
}

function participantElement(participant, db, firestore) {
  const row = document.createElement("article");
  row.className = "participant-row";
  const status = participant.status || participant.inviteStatus || "pendente";
  row.innerHTML = `
    <div class="participant-meta"><strong class="participant-name"></strong><span class="participant-company"></span></div>
    <div class="participant-meta"><strong></strong><span>WhatsApp</span></div>
    <div class="participant-meta"><strong></strong><span>Data escolhida</span></div>
    <div class="participant-meta whatsapp-delivery"><strong></strong><span>Envio WhatsApp</span><small></small></div>
    <label class="participant-meta"><span>Status</span><select class="status-control"></select></label>
    <div class="participant-actions">
      <button class="button save-status" type="button">Salvar</button>
      <button class="button api-send" type="button" ${canImport ? "" : "hidden"}>API</button>
      <a class="button whatsapp-link" target="_blank" rel="noreferrer">WhatsApp</a>
      <button class="danger-delete" type="button" ${canImport ? "" : "hidden"}>Excluir</button>
    </div>`;
  row.querySelector(".participant-name").textContent = participant.nome;
  row.querySelector(".participant-company").textContent = participant.empresa || "Empresa não informada";
  row.querySelectorAll(".participant-meta strong")[1].textContent = participant.whatsapp;
  row.querySelectorAll(".participant-meta strong")[2].textContent = formatDate(participant.dataSelecionada);
  const delivery = row.querySelector(".whatsapp-delivery");
  const deliveryStatus = participant.statusEnvioWhatsApp || "pendente";
  delivery.querySelector("strong").textContent = whatsappDeliveryLabel(deliveryStatus);
  delivery.dataset.status = deliveryStatus;
  const deliveryDetail = participant.tipoConviteWhatsApp === "botoes"
    ? "Convite por botões"
    : participant.tipoConviteWhatsApp === "link"
      ? "Convite com link"
      : participant.statusEnvioWhatsAppEm
        ? formatDateTime(participant.statusEnvioWhatsAppEm)
        : "Ainda não enviado";
  delivery.querySelector("small").textContent = participant.erroEnvioWhatsApp || deliveryDetail;
  const select = row.querySelector("select");
  const sendLink = row.querySelector(".whatsapp-link");
  sendLink.href = whatsappLink(participant);
  const apiSend = row.querySelector(".api-send");
  if (canImport) {
    apiSend.addEventListener("click", async () => {
      const confirmed = window.confirm(`Enviar o template de confirmação pela API para ${participant.nome} (${participant.whatsapp})?`);
      if (!confirmed) return;
      apiSend.disabled = true;
      apiSend.textContent = "Enviando...";
      try {
        const {functions, functionsModule} = await getFunctionsServices();
        const sendTemplate = functionsModule.httpsCallable(functions, "sendWhatsAppTemplate");
        const result = await sendTemplate({preInscritoId: participant.whatsapp});
        setFeedback(`${participant.nome}: envio aceito pela Meta (${result.data.messageId}). Aguarde os status do webhook.`);
      } catch (error) {
        console.error(error);
        setFeedback(error.message || "Não foi possível enviar o template pela API.", "error");
      } finally {
        apiSend.disabled = false;
        apiSend.textContent = "API";
      }
    });
  }
  for (const optionStatus of statuses) {
    const option = new Option(label(optionStatus), optionStatus, false, optionStatus === status);
    select.add(option);
  }
  applyStatusStyle(select);
  select.addEventListener("change", () => applyStatusStyle(select));
  row.querySelector("button").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Salvando...";
    try {
      const statusData = {
        status: select.value,
        atualizadoEm: firestore.serverTimestamp(),
      };
      if (canImport && select.value === "pendente" && participant.tokenPublico) {
        const batch = firestore.writeBatch(db);
        batch.update(participant.reference, statusData);
        batch.update(firestore.doc(db, "linksPublicos", participant.tokenPublico), {
          status: "pendente",
          dataSelecionada: firestore.deleteField(),
          confirmadoEm: firestore.deleteField(),
        });
        await batch.commit();
        setFeedback(`${participant.nome}: status pendente e data liberada novamente no link público.`);
      } else {
        await firestore.updateDoc(participant.reference, statusData);
        setFeedback(`${participant.nome}: status atualizado para ${label(select.value)}.`);
      }
    } catch (error) {
      console.error(error);
      setFeedback("Não foi possível atualizar o status.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Salvar";
    }
  });
  const deleteButton = row.querySelector(".danger-delete");
  if (canImport) {
    deleteButton.addEventListener("click", async () => {
      const confirmed = window.confirm(`Excluir ${participant.nome} e seu convite público? Esta ação não pode ser desfeita.`);
      if (!confirmed) return;
      deleteButton.disabled = true;
      deleteButton.textContent = "Excluindo...";
      try {
        const batch = firestore.writeBatch(db);
        batch.delete(participant.reference);
        if (participant.tokenPublico) batch.delete(firestore.doc(db, "linksPublicos", participant.tokenPublico));
        await batch.commit();
        setFeedback(`${participant.nome} foi excluído(a).`);
        await loadParticipants();
      } catch (error) {
        console.error(error);
        setFeedback("Não foi possível excluir o pré-inscrito.", "error");
        deleteButton.disabled = false;
        deleteButton.textContent = "Excluir";
      }
    });
  }
  return row;
}

async function loadParticipants() {
  total.textContent = "Carregando...";
  setFeedback("");
  try {
    const {db, firestoreModule, participants} = await getParticipantsWithInvitations();
    await loadMessageTemplate(db, firestoreModule);
    loadedParticipants = participants;
    participantServices = {db, firestoreModule};
    renderParticipants();
  } catch (error) {
    console.error(error);
    total.textContent = "Erro ao carregar";
    setFeedback("Não foi possível carregar os pré-inscritos. Verifique as permissões do usuário.", "error");
  }
}

function searchValue(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function renderParticipants() {
  list.replaceChildren();
  const term = searchValue(search.value).trim();
  const visible = term
    ? loadedParticipants.filter((participant) => [participant.nome, participant.whatsapp, participant.empresa, participant.email]
      .some((value) => searchValue(value).includes(term)))
    : loadedParticipants;
  total.textContent = term
    ? `${visible.length} de ${loadedParticipants.length} pré-inscrito${loadedParticipants.length === 1 ? "" : "s"}`
    : `${loadedParticipants.length} pré-inscrito${loadedParticipants.length === 1 ? "" : "s"}`;
  if (!visible.length) {
    list.innerHTML = `<p class="empty-state">${term ? "Nenhum pré-inscrito encontrado para esta busca." : "Nenhum pré-inscrito encontrado."}</p>`;
    return;
  }
  for (const participant of visible) {
    list.append(participantElement(participant, participantServices.db, participantServices.firestoreModule));
  }
}

const {auth, authModule} = await getAuthServices();
authModule.onAuthStateChanged(auth, async (user) => {
  if (user) {
    const {db, firestoreModule} = await getFirestoreServices();
    const profile = await firestoreModule.getDoc(firestoreModule.doc(db, "users", user.uid));
    canImport = profile.exists() && profile.data().active !== false && profile.data().roles?.admin === true;
    const inscritosSettings = await firestoreModule.getDoc(firestoreModule.doc(db, "configuracoes", "inscritos"));
    const inscritosVisibleToUsers = !inscritosSettings.exists() || inscritosSettings.data().visivelParaUsuarios !== false;
    inscritosLink.hidden = !canImport && !inscritosVisibleToUsers;
    addToggle.hidden = !canImport;
    // A importação permanece implementada para eventual reativação, mas não
    // deve ficar acessível na lista de pré-inscritos neste momento.
    importToggle.hidden = true;
    batchSendToggle.hidden = !canImport;
    messageRandomize.hidden = !canImport;
    loadParticipants();
  }
});
reload.addEventListener("click", loadParticipants);
search.addEventListener("input", renderParticipants);

function resetBatchDialog() {
  batchRecipientIds = [];
  batchPreviewForm.hidden = false;
  batchPreviewResult.hidden = true;
  batchRecipients.replaceChildren();
  setBatchFeedback("");
  setBatchPreviewFeedback("");
}

batchSendToggle.addEventListener("click", () => {
  if (!canImport) return;
  resetBatchDialog();
  batchEditor.showModal();
  batchLimit.focus();
});

batchCancelButtons.forEach((button) => button.addEventListener("click", () => batchEditor.close()));
batchBack.addEventListener("click", resetBatchDialog);

batchPreviewForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!canImport || !batchPreviewForm.reportValidity()) return;
  const limit = Number(batchLimit.value);
  batchPreviewButton.disabled = true;
  batchPreviewButton.textContent = "Buscando...";
  try {
    const {functions, functionsModule} = await getFunctionsServices();
    const previewBatch = functionsModule.httpsCallable(functions, "previewWhatsAppBatch");
    const result = await previewBatch({limit});
    const recipients = Array.isArray(result.data.recipients) ? result.data.recipients : [];
    if (!recipients.length) {
      setBatchPreviewFeedback("Não há pré-inscritos pendentes para enviar.", "error");
      return;
    }
    batchRecipientIds = recipients.map((recipient) => recipient.id);
    batchRecipients.replaceChildren(...recipients.map((recipient) => {
      const item = document.createElement("li");
      item.textContent = `${recipient.nome} — ${recipient.whatsapp}`;
      return item;
    }));
    batchSummary.textContent = `${recipients.length} mensagem(ns) será(ão) enviada(s), exatamente na ordem exibida.`;
    batchPreviewForm.hidden = true;
    batchPreviewResult.hidden = false;
    setBatchFeedback("");
  } catch (error) {
    console.error(error);
    setBatchPreviewFeedback(error.message || "Não foi possível gerar a prévia do lote.", "error");
  } finally {
    batchPreviewButton.disabled = false;
    batchPreviewButton.textContent = "Gerar prévia";
  }
});

batchConfirm.addEventListener("click", async () => {
  if (!canImport || !batchRecipientIds.length) return;
  batchConfirm.disabled = true;
  batchConfirm.textContent = "Enviando...";
  setBatchFeedback("O envio está em andamento. Não feche esta janela.");
  try {
    const {functions, functionsModule} = await getFunctionsServices();
    const sendBatch = functionsModule.httpsCallable(functions, "sendWhatsAppBatch");
    const result = await sendBatch({preInscritoIds: batchRecipientIds});
    const {sent, skipped, failures} = result.data;
    const failureDetail = Array.isArray(failures) && failures.length ? ` ${failures.length} falha(s) registrada(s).` : "";
    setBatchFeedback(`${sent} mensagem(ns) enviada(s); ${skipped} contato(s) ignorado(s) por já não estar(em) pendente(s).${failureDetail}`, failures?.length ? "error" : "success");
    await loadParticipants();
  } catch (error) {
    console.error(error);
    setBatchFeedback(error.message || "Não foi possível enviar o lote.", "error");
  } finally {
    batchConfirm.disabled = false;
    batchConfirm.textContent = "Confirmar envio";
  }
});

addToggle.addEventListener("click", () => {
  addForm.reset();
  setAddFeedback("");
  addEditor.showModal();
  addForm.elements.nome.focus();
});

addCancelButtons.forEach((button) => button.addEventListener("click", () => addEditor.close()));

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!canImport) {
    setAddFeedback("Somente administradores podem cadastrar pré-inscritos.", "error");
    return;
  }

  const formData = new FormData(addForm);
  const nome = String(formData.get("nome") || "").trim();
  const whatsapp = normalizeWhatsApp(formData.get("whatsapp"));
  const email = String(formData.get("email") || "").trim();
  const empresa = String(formData.get("empresa") || "").trim();
  if (!nome || whatsapp.length < 10 || whatsapp.length > 11) {
    setAddFeedback("Informe o nome e um celular válido com DDD.", "error");
    return;
  }

  addSave.disabled = true;
  addSave.textContent = "Criando...";
  setAddFeedback("");
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const participantRef = firestoreModule.doc(db, "preInscritos", whatsapp);
    const existing = await firestoreModule.getDoc(participantRef);
    if (existing.exists()) throw new Error("Já existe um pré-inscrito com este WhatsApp.");

    const token = makeToken();
    const linkPublico = `https://grobexperience.web.app/confirmar/?token=${token}`;
    const mensagemWhatsApp = messageVariants[Math.floor(Math.random() * messageVariants.length)]
      .replaceAll("{nome}", nome).replaceAll("{link}", linkPublico);
    const batch = firestoreModule.writeBatch(db);
    batch.set(participantRef, {
      nome, nomeOrdenacao: normalizedSortName(nome), whatsapp, email, empresa,
      origem: "cadastro-manual",
      importadoEm: firestoreModule.serverTimestamp(),
      tokenPublico: token,
      linkPublico,
      mensagemWhatsApp,
      statusEnvioWhatsApp: "pendente",
      conviteGeradoEm: firestoreModule.serverTimestamp(),
    });
    batch.set(firestoreModule.doc(db, "linksPublicos", token), {
      nome,
      preInscritoId: whatsapp,
      status: "pendente",
      datasDisponiveis: ["2026-09-22", "2026-09-23", "2026-09-24"],
      criadoEm: firestoreModule.serverTimestamp(),
    });
    await batch.commit();
    addEditor.close();
    setFeedback(`${nome} foi cadastrado(a) e já possui um link exclusivo.`);
    await loadParticipants();
  } catch (error) {
    console.error(error);
    setAddFeedback(error.message || "Não foi possível criar o pré-inscrito.", "error");
  } finally {
    addSave.disabled = false;
    addSave.textContent = "Criar pré-inscrito";
  }
});

async function downloadCsv(selectedFields) {
  exportConfirm.disabled = true;
  exportConfirm.textContent = "Gerando CSV...";
  try {
    const {participants} = await getParticipantsWithInvitations();
    const columns = selectedFields.map((field) => exportColumns[field]);
    const rows = [
      ["Nome", "Celular (WhatsApp)", ...columns.map((column) => column.label)],
      ...participants.map((participant) => [
        participant.nome,
        participant.whatsapp,
        ...columns.map((column) => column.value(participant)),
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvValue).join(";")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = `pre-inscritos-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    exportEditor.close();
    setFeedback(`${participants.length} pré-inscrito(s) exportado(s).`);
  } catch (error) {
    console.error(error);
    setFeedback("Não foi possível exportar os pré-inscritos.", "error");
  } finally {
    exportConfirm.disabled = false;
    exportConfirm.textContent = "Baixar CSV";
  }
}

exportButton.addEventListener("click", () => exportEditor.showModal());

exportCancel.addEventListener("click", () => exportEditor.close());

exportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const selectedFields = [...exportFields.querySelectorAll("input:checked")].map((field) => field.value);
  await downloadCsv(selectedFields);
});

messageCancel.addEventListener("click", () => {
  messageEditor.close();
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  messageSave.disabled = true;
  messageSave.textContent = "Salvando mensagens...";
  try {
    await saveMessageVariants();
    messageEditor.close();
    setFeedback("As 10 mensagens compartilhadas foram atualizadas.");
  } catch (error) {
    console.error(error);
    setMessageModalFeedback(error.message || "Não foi possível salvar as mensagens.", "error");
  } finally {
    messageSave.disabled = false;
    messageSave.textContent = "Salvar 10 mensagens";
  }
});

messageRandomize.addEventListener("click", async () => {
  if (!canImport) return;
  messageRandomize.disabled = true;
  messageSave.disabled = true;
  messageRandomize.textContent = "Distribuindo...";
  setMessageModalFeedback("");
  try {
    await saveMessageVariants();
    const updated = await repopulateMessagesFromDashboard();
    setMessageModalFeedback(`${updated} pré-inscrito(s) receberam uma mensagem sorteada.`, "success");
    await loadParticipants();
  } catch (error) {
    console.error(error);
    setMessageModalFeedback(error.message || "Não foi possível distribuir as mensagens.", "error");
  } finally {
    messageRandomize.disabled = false;
    messageSave.disabled = false;
    messageRandomize.textContent = "Distribuir aleatoriamente";
  }
});

importToggle.addEventListener("click", () => {
  importEditor.hidden = false;
  importFile.click();
});

importFile.addEventListener("change", () => {
  if (importFile.files[0]) {
    importFileName.textContent = importFile.files[0].name;
    setImportFeedback(`${importFile.files[0].name} selecionado. Clique em Confirmar importação.`);
  }
});

importCancel.addEventListener("click", () => {
  importEditor.hidden = true;
  importFile.value = "";
  importFileName.textContent = "Nenhuma planilha selecionada.";
  setImportFeedback("");
});

importEditor.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!canImport) {
    setImportFeedback("Somente administradores podem importar uma planilha.", "error");
    return;
  }
  const file = importFile.files[0];
  if (!file) return;
  importSubmit.disabled = true;
  importSubmit.textContent = "Lendo planilha...";
  setImportFeedback("");
  try {
    const XLSX = await getXlsxModule();
    const workbook = XLSX.read(await file.arrayBuffer(), {type: "array"});
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = spreadsheetRows(XLSX, sheet);
    const valid = [];
    const invalid = [];
    rows.forEach((row, index) => {
      const nome = valueFor(row, ["nome"]);
      const whatsapp = normalizeWhatsApp(valueFor(row, ["celular (whatsapp)", "celular whatsapp", "whatsapp", "celular", "telefone", "telefone (whatsapp)"]));
      const email = valueFor(row, ["e-mail", "email"]);
      const empresa = valueFor(row, ["empresa"]);
      if (!nome || whatsapp.length < 10 || whatsapp.length > 11) {
        invalid.push(index + 2);
      } else {
        valid.push({nome, whatsapp, email, empresa});
      }
    });
    if (!valid.length) throw new Error("Nenhuma linha válida encontrada. Confira Nome e Celular (WhatsApp).");

    importSubmit.textContent = "Importando...";
    const {db, firestoreModule} = await getFirestoreServices();
    let batch = firestoreModule.writeBatch(db);
    let operationCount = 0;
    let newInvitations = 0;
    async function commitBatch() {
      if (operationCount) await batch.commit();
      batch = firestoreModule.writeBatch(db);
      operationCount = 0;
    }

    for (const participant of valid) {
      const reference = firestoreModule.doc(db, "preInscritos", participant.whatsapp);
      const existing = await firestoreModule.getDoc(reference);
      const importedData = {
        ...participant,
        nomeOrdenacao: normalizedSortName(participant.nome),
        origem: "importacao-excel",
        importadoEm: firestoreModule.serverTimestamp(),
      };
      if (!existing.exists() || !existing.data().tokenPublico) {
        const token = makeToken();
        const linkPublico = `https://grobexperience.web.app/confirmar/?token=${token}`;
        Object.assign(importedData, {
          tokenPublico: token,
          linkPublico,
        mensagemWhatsApp: messageVariants[Math.floor(Math.random() * messageVariants.length)]
          .replaceAll("{nome}", participant.nome).replaceAll("{link}", linkPublico),
          statusEnvioWhatsApp: "pendente",
          conviteGeradoEm: firestoreModule.serverTimestamp(),
        });
        batch.set(firestoreModule.doc(db, "linksPublicos", token), {
          nome: participant.nome,
          preInscritoId: participant.whatsapp,
          status: "pendente",
          datasDisponiveis: ["2026-09-22", "2026-09-23", "2026-09-24"],
          criadoEm: firestoreModule.serverTimestamp(),
        });
        operationCount += 1;
        newInvitations += 1;
      }
      batch.set(reference, importedData, {merge: true});
      operationCount += 1;
      if (operationCount >= 400) await commitBatch();
    }
    await commitBatch();
    const skipped = invalid.length ? ` ${invalid.length} linha(s) ignorada(s): ${invalid.join(", ")}.` : "";
    setImportFeedback(`${valid.length} pré-inscrito(s) importado(s); ${newInvitations} convite(s) criado(s).${skipped}`);
    importFile.value = "";
    importFileName.textContent = "Nenhuma planilha selecionada.";
    await loadParticipants();
  } catch (error) {
    console.error(error);
    setImportFeedback(error.message || "Não foi possível importar a planilha.", "error");
  } finally {
    importSubmit.disabled = false;
  importSubmit.textContent = "Confirmar importação";
  }
});
