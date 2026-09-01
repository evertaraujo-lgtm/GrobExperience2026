import {getAuthServices, getFirestoreServices} from "/js/firebase-client.js";

const PAGE_SIZE = 100;
const requiredColumns = {
  idParticipante: ["id participante", "id", "id do participante"],
  nome: ["nome"],
  whatsapp: ["celular (whatsapp)", "celular whatsapp", "whatsapp", "celular", "telefone"],
  email: ["e-mail", "email"], empresa: ["empresa"], qrcode: ["qrcode", "qr code"],
  estado: ["estado", "uf"], cidade: ["cidade"],
  dataParticipacao: ["data de participacao", "data participacao"],
};
const mandatoryFields = ["idParticipante", "qrcode", "nome", "whatsapp"];
const fieldLabels = {idParticipante: "ID participante", qrcode: "QRCODE", nome: "Nome", whatsapp: "Celular (WhatsApp)"};
const list = document.querySelector("[data-list]");
const total = document.querySelector("[data-total]");
const feedback = document.querySelector("[data-feedback]");
const reload = document.querySelector("[data-reload]");
const search = document.querySelector("[data-search]");
const loadMore = document.querySelector("[data-load-more]");
const addToggle = document.querySelector("[data-add-toggle]");
const addEditor = document.querySelector("[data-add-editor]");
const addForm = document.querySelector("[data-add-form]");
const addSave = document.querySelector("[data-add-save]");
const addFeedback = document.querySelector("[data-add-feedback]");
const importToggle = document.querySelector("[data-import-toggle]");
const importEditor = document.querySelector("[data-import-editor]");
const importFile = document.querySelector("[data-import-file]");
const importFileName = document.querySelector("[data-import-file-name]");
const importSheet = document.querySelector("[data-import-sheet]");
const sheetChoice = document.querySelector("[data-sheet-choice]");
const extraColumns = document.querySelector("[data-extra-columns]");
const extraFields = document.querySelector("[data-extra-fields]");
const importSubmit = document.querySelector("[data-import-submit]");
const importFeedback = document.querySelector("[data-import-feedback]");
const deleteAllToggle = document.querySelector("[data-delete-all-toggle]");
const deleteAllEditor = document.querySelector("[data-delete-all-editor]");
const deleteAllForm = document.querySelector("[data-delete-all-form]");
const deleteAllFeedback = document.querySelector("[data-delete-all-feedback]");
const deleteAllConfirm = document.querySelector("[data-delete-all-confirm]");
const visibilityControl = document.querySelector("[data-visibility-control]");
const userVisibility = document.querySelector("[data-user-visibility]");
let canManage = false;
let lastDocument;
let loadedCount = 0;
let hasMore = false;
let isLoading = false;
let searchResults = [];
let searchOffset = 0;
let searchTimer;
let xlsxModulePromise;
let workbook;
let importRows = [];
let importExtraColumns = [];

function setFeedback(message, state = "neutral") { feedback.textContent = message; feedback.dataset.state = state; }
function setImportFeedback(message, state = "neutral") { importFeedback.textContent = message; importFeedback.dataset.state = state; }
function setAddFeedback(message, state = "neutral") { addFeedback.textContent = message; addFeedback.dataset.state = state; }
function normalized(value) { return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " "); }
function normalizedSortName(value) { return normalized(value).toLocaleLowerCase("pt-BR"); }
function normalizePhone(value) { let phone = String(value ?? "").replace(/\D/g, ""); if (phone.startsWith("55") && (phone.length === 12 || phone.length === 13)) phone = phone.slice(2); return phone; }
function documentId(id) { return encodeURIComponent(String(id).trim()); }
function getXlsxModule() { if (!xlsxModulePromise) xlsxModulePromise = import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm"); return xlsxModulePromise; }
function matchesColumn(field, header) {
  return requiredColumns[field].includes(header)
    || (field === "whatsapp" && header.startsWith("celular (whatsapp)"));
}
function fieldValue(row, field) { const header = Object.keys(row).find((key) => matchesColumn(field, key)); return header === undefined ? "" : String(row[header] ?? "").trim(); }
function selectedExtraColumns() { return [...extraFields.querySelectorAll("input:checked")].map((input) => input.value); }

function participantElement(participant, db, firestore) {
  const row = document.createElement("article");
  row.className = "participant-row";
  row.innerHTML = `<div class="participant-meta"><strong class="participant-name"></strong><span class="participant-id"></span></div><div class="participant-meta"><strong class="participant-company"></strong><span class="participant-email"></span></div><div class="participant-meta"><strong class="participant-phone"></strong><span>WhatsApp</span></div><div class="participant-meta"><strong class="participant-city"></strong><span class="participant-state"></span></div><div class="participant-meta"><strong class="participant-date"></strong><span class="participant-qr"></span></div><div class="participant-actions"><button class="danger-delete" type="button" ${canManage ? "" : "hidden"}>Excluir</button></div>`;
  row.querySelector(".participant-name").textContent = participant.nome || "Nome não informado";
  row.querySelector(".participant-id").textContent = `ID: ${participant.idParticipante}`;
  row.querySelector(".participant-company").textContent = participant.empresa || "Empresa não informada";
  row.querySelector(".participant-email").textContent = participant.email || "E-mail não informado";
  row.querySelector(".participant-phone").textContent = participant.whatsapp || "Não informado";
  row.querySelector(".participant-city").textContent = participant.cidade || "Cidade não informada";
  row.querySelector(".participant-state").textContent = participant.estado || "Estado não informado";
  row.querySelector(".participant-date").textContent = participant.dataParticipacao || "Data não informada";
  row.querySelector(".participant-qr").textContent = `QRCODE: ${participant.qrcode || "não informado"}`;
  const deleteButton = row.querySelector(".danger-delete");
  if (canManage) deleteButton.addEventListener("click", async () => {
    if (!window.confirm(`Excluir ${participant.nome} (ID ${participant.idParticipante})? Esta ação não pode ser desfeita.`)) return;
    deleteButton.disabled = true; deleteButton.textContent = "Excluindo...";
    try { await firestore.deleteDoc(participant.reference); setFeedback(`${participant.nome} foi excluído(a).`); await loadInscritos(); }
    catch (error) { console.error(error); setFeedback("Não foi possível excluir o inscrito.", "error"); deleteButton.disabled = false; deleteButton.textContent = "Excluir"; }
  });
  return row;
}

function participantMatches(participant, term) {
  return [participant.nome, participant.idParticipante, participant.whatsapp, participant.empresa, participant.email, participant.cidade, participant.estado]
    .some((value) => normalized(value).includes(term));
}

function renderSearchPage() {
  const page = searchResults.slice(searchOffset, searchOffset + PAGE_SIZE);
  for (const participant of page) list.append(participantElement(participant, participant.services.db, participant.services.firestoreModule));
  searchOffset += page.length;
  hasMore = searchOffset < searchResults.length;
  loadMore.hidden = !hasMore;
  total.textContent = `${searchOffset} de ${searchResults.length} inscrito${searchResults.length === 1 ? "" : "s"} encontrado${searchResults.length === 1 ? "" : "s"}`;
}

async function loadSearchResults(term) {
  list.replaceChildren(); total.textContent = "Buscando..."; loadMore.hidden = true; searchResults = []; searchOffset = 0;
  const {db, firestoreModule} = await getFirestoreServices();
  const reference = firestoreModule.collection(db, "inscritos");
  let cursor;
  do {
    const constraints = [firestoreModule.orderBy("nomeOrdenacao"), firestoreModule.limit(400)];
    if (cursor) constraints.splice(-1, 0, firestoreModule.startAfter(cursor));
    const snapshot = await firestoreModule.getDocs(firestoreModule.query(reference, ...constraints));
    snapshot.docs.forEach((document) => {
      const participant = {reference: document.ref, ...document.data(), services: {db, firestoreModule}};
      if (participantMatches(participant, term)) searchResults.push(participant);
    });
    cursor = snapshot.docs.at(-1);
    if (snapshot.size < 400) break;
  } while (cursor);
  if (!searchResults.length) { total.textContent = "Nenhum inscrito encontrado"; list.innerHTML = '<p class="empty-state">Nenhum inscrito encontrado para esta busca.</p>'; return; }
  renderSearchPage();
}

async function loadInscritos(reset = true) {
  const term = normalized(search.value);
  if (term) { if (reset) await loadSearchResults(term); else renderSearchPage(); return; }
  if (isLoading || (!reset && !hasMore)) return;
  isLoading = true;
  if (reset) { list.replaceChildren(); lastDocument = undefined; loadedCount = 0; hasMore = false; loadMore.hidden = true; total.textContent = "Carregando..."; }
  else { loadMore.disabled = true; loadMore.textContent = "Carregando..."; }
  setFeedback("");
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const constraints = [firestoreModule.orderBy("nomeOrdenacao"), firestoreModule.limit(PAGE_SIZE)];
    if (lastDocument) constraints.splice(-1, 0, firestoreModule.startAfter(lastDocument));
    const snapshot = await firestoreModule.getDocs(firestoreModule.query(firestoreModule.collection(db, "inscritos"), ...constraints));
    if (snapshot.empty) { hasMore = false; loadMore.hidden = true; if (reset) list.innerHTML = '<p class="empty-state">Nenhum inscrito encontrado.</p>'; return; }
    snapshot.docs.forEach((document) => list.append(participantElement({reference: document.ref, ...document.data()}, db, firestoreModule)));
    lastDocument = snapshot.docs.at(-1); loadedCount += snapshot.size; hasMore = snapshot.size === PAGE_SIZE;
    total.textContent = `${loadedCount} inscrito${loadedCount === 1 ? "" : "s"} carregado${loadedCount === 1 ? "" : "s"}`; loadMore.hidden = !hasMore;
  } catch (error) { console.error(error); total.textContent = "Erro ao carregar"; setFeedback("Não foi possível carregar os inscritos. Verifique as permissões.", "error"); }
  finally { isLoading = false; loadMore.disabled = false; loadMore.textContent = "Carregar mais"; }
}

function spreadsheetRows(XLSX, sheet) {
  const matrix = XLSX.utils.sheet_to_json(sheet, {header: 1, defval: "", raw: true});
  const headerIndex = matrix.findIndex((row) => { const headers = row.map(normalized); return mandatoryFields.every((field) => headers.some((header) => matchesColumn(field, header))); });
  if (headerIndex === -1) {
    const candidateHeaders = matrix.flatMap((row) => row.map(normalized));
    const missing = mandatoryFields.filter((field) => !candidateHeaders.some((header) => matchesColumn(field, header))).map((field) => fieldLabels[field]);
    throw new Error(`Não encontrei os cabeçalhos obrigatórios: ${missing.join(", ") || "verifique a aba selecionada"}.`);
  }
  const originalHeaders = matrix[headerIndex].map((value) => String(value).trim());
  const headers = originalHeaders.map(normalized);
  const rows = matrix.slice(headerIndex + 1).map((values, index) => ({values, rowNumber: headerIndex + index + 2}))
    .filter(({values}) => values.some((value) => String(value).trim())).map(({values, rowNumber}) => {
      const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
      Object.defineProperty(row, "sheetRowNumber", {value: rowNumber});
      return row;
    });
  return {rows, extras: originalHeaders.map((label, index) => ({label, key: headers[index]})).filter(({label, key}) => label && key && !Object.keys(requiredColumns).some((field) => matchesColumn(field, key)))};
}

async function prepareSheet() {
  try {
    const XLSX = await getXlsxModule();
    const parsed = spreadsheetRows(XLSX, workbook.Sheets[importSheet.value]);
    importRows = parsed.rows; importExtraColumns = parsed.extras; extraFields.replaceChildren();
    parsed.extras.forEach(({label, key}) => { const field = document.createElement("label"); const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.value = key; field.append(checkbox, ` ${label}`); extraFields.append(field); });
    extraColumns.hidden = !parsed.extras.length; importSubmit.disabled = false;
    setImportFeedback(`${parsed.rows.length} linha(s) encontradas na aba “${importSheet.value}”.`);
  } catch (error) { importRows = []; importSubmit.disabled = true; extraColumns.hidden = true; setImportFeedback(error.message || "Não foi possível ler esta aba.", "error"); }
}

importToggle.addEventListener("click", () => { importEditor.hidden = false; importFile.click(); });
importFile.addEventListener("change", async () => {
  const file = importFile.files[0]; if (!file) return;
  importFileName.textContent = file.name; importSubmit.disabled = true; setImportFeedback("Lendo planilha...");
  try {
    const XLSX = await getXlsxModule(); workbook = XLSX.read(await file.arrayBuffer(), {type: "array"});
    importSheet.replaceChildren(...workbook.SheetNames.map((name) => new Option(name, name)));
    sheetChoice.hidden = workbook.SheetNames.length < 2;
    await prepareSheet();
  } catch (error) { setImportFeedback("Não foi possível abrir a planilha.", "error"); }
});
importSheet.addEventListener("change", prepareSheet);
document.querySelector("[data-import-cancel]").addEventListener("click", () => { importEditor.hidden = true; importFile.value = ""; workbook = undefined; importRows = []; importSubmit.disabled = true; extraColumns.hidden = true; setImportFeedback(""); });
importEditor.addEventListener("submit", async (event) => {
  event.preventDefault(); if (!canManage || !importRows.length) return;
  const extras = selectedExtraColumns(); const invalid = []; const withoutWhatsApp = []; const valid = [];
  importRows.forEach((row, index) => {
    const participant = Object.fromEntries(Object.keys(requiredColumns).map((field) => [field, fieldValue(row, field)])); participant.whatsapp = normalizePhone(participant.whatsapp);
    const reasons = mandatoryFields.filter((field) => field !== "whatsapp" && !String(participant[field]).trim()).map((field) => `${fieldLabels[field]} vazio`);
    const entry = {participant, extras: Object.fromEntries(extras.map((key) => [key, String(row[key] ?? "").trim()])), rowNumber: row.sheetRowNumber || index + 1};
    if (reasons.length) invalid.push({...entry, reasons});
    else if (participant.whatsapp.length < 10 || participant.whatsapp.length > 11) withoutWhatsApp.push(entry);
    else valid.push(entry);
  });
  let approvedWithoutWhatsApp = 0;
  if (withoutWhatsApp.length) {
    const approved = window.confirm(`${withoutWhatsApp.length} contato(s) estão com WhatsApp inválido ou ausente. Adicionar mesmo assim, sem WhatsApp?`);
    if (approved) {
      withoutWhatsApp.forEach((entry) => { entry.participant.whatsapp = ""; valid.push(entry); });
      approvedWithoutWhatsApp = withoutWhatsApp.length;
    } else {
      invalid.push(...withoutWhatsApp.map((entry) => ({...entry, reasons: ["Celular (WhatsApp) inválido ou ausente"]})));
    }
  }
  if (!valid.length) { setImportFeedback(`Nenhuma linha foi importada. ${invalid.map(({rowNumber, reasons}) => `linha ${rowNumber} (${reasons.join(", ")})`).join("; ")}`, "error"); return; }
  importSubmit.disabled = true; importSubmit.textContent = "Importando...";
  try {
    const {db, firestoreModule} = await getFirestoreServices(); let batch = firestoreModule.writeBatch(db); let operations = 0;
    async function commit() { if (operations) await batch.commit(); batch = firestoreModule.writeBatch(db); operations = 0; }
    for (const {participant, extras: extraData} of valid) {
      batch.set(firestoreModule.doc(db, "inscritos", documentId(participant.idParticipante)), {...participant, nomeOrdenacao: normalizedSortName(participant.nome), ...(extras.length ? {dadosExtras: extraData} : {}), origem: "importacao-excel", atualizadoEm: firestoreModule.serverTimestamp(), importadoEm: firestoreModule.serverTimestamp()}, {merge: true});
      operations += 1; if (operations === 400) await commit();
    }
    await commit(); const withoutPhoneDetail = approvedWithoutWhatsApp ? ` ${approvedWithoutWhatsApp} inscrito(s) adicionado(s) sem WhatsApp por confirmação do administrador.` : ""; const skipped = invalid.length ? ` ${invalid.length} linha(s) ignorada(s): ${invalid.map(({rowNumber, reasons}) => `linha ${rowNumber} (${reasons.join(", ")})`).join("; ")}.` : "";
    setImportFeedback(`${valid.length} inscrito(s) importado(s) ou atualizado(s) pelo ID participante.${withoutPhoneDetail}${skipped}`, "success"); await loadInscritos();
  } catch (error) { console.error(error); setImportFeedback(error.message || "Não foi possível importar a planilha.", "error"); }
  finally { importSubmit.disabled = false; importSubmit.textContent = "Confirmar importação"; }
});

addToggle.addEventListener("click", () => { addForm.reset(); setAddFeedback(""); addEditor.showModal(); });
document.querySelectorAll("[data-add-cancel]").forEach((button) => button.addEventListener("click", () => addEditor.close()));
addForm.addEventListener("submit", async (event) => {
  event.preventDefault(); if (!canManage || !addForm.reportValidity()) return;
  const participant = Object.fromEntries(Object.keys(requiredColumns).map((field) => [field, String(new FormData(addForm).get(field) || "").trim()])); participant.whatsapp = normalizePhone(participant.whatsapp);
  if (participant.whatsapp.length < 10 || participant.whatsapp.length > 11) { setAddFeedback("Informe um celular válido com DDD.", "error"); return; }
  addSave.disabled = true; addSave.textContent = "Criando...";
  try { const {db, firestoreModule} = await getFirestoreServices(); const reference = firestoreModule.doc(db, "inscritos", documentId(participant.idParticipante)); if ((await firestoreModule.getDoc(reference)).exists()) throw new Error("Já existe um inscrito com este ID participante."); await firestoreModule.setDoc(reference, {...participant, nomeOrdenacao: normalizedSortName(participant.nome), dadosExtras: {}, origem: "cadastro-manual", criadoEm: firestoreModule.serverTimestamp(), atualizadoEm: firestoreModule.serverTimestamp()}); addEditor.close(); setFeedback(`${participant.nome} foi cadastrado(a).`); await loadInscritos(); }
  catch (error) { console.error(error); setAddFeedback(error.message || "Não foi possível criar o inscrito.", "error"); }
  finally { addSave.disabled = false; addSave.textContent = "Criar inscrito"; }
});

deleteAllToggle.addEventListener("click", () => { deleteAllForm.reset(); deleteAllFeedback.textContent = ""; deleteAllEditor.showModal(); });
document.querySelectorAll("[data-delete-all-cancel]").forEach((button) => button.addEventListener("click", () => deleteAllEditor.close()));
deleteAllForm.addEventListener("submit", async (event) => {
  event.preventDefault(); if (!canManage || !window.confirm("Deseja mesmo excluir todos os inscritos?")) return;
  if (!window.confirm("Esta ação será irreversível. Confirmar exclusão definitiva?")) return;
  deleteAllConfirm.disabled = true; deleteAllConfirm.textContent = "Excluindo...";
  try {
    const {db, firestoreModule} = await getFirestoreServices(); let removed = 0;
    while (true) { const snapshot = await firestoreModule.getDocs(firestoreModule.query(firestoreModule.collection(db, "inscritos"), firestoreModule.orderBy(firestoreModule.documentId()), firestoreModule.limit(400))); if (snapshot.empty) break; const batch = firestoreModule.writeBatch(db); snapshot.docs.forEach((document) => batch.delete(document.ref)); await batch.commit(); removed += snapshot.size; }
    deleteAllEditor.close(); setFeedback(`${removed} inscrito(s) excluído(s) permanentemente.`); await loadInscritos();
  } catch (error) { console.error(error); deleteAllFeedback.textContent = "Não foi possível excluir a lista."; deleteAllFeedback.dataset.state = "error"; }
  finally { deleteAllConfirm.disabled = false; deleteAllConfirm.textContent = "Excluir todos permanentemente"; }
});

reload.addEventListener("click", () => loadInscritos());
loadMore.addEventListener("click", () => loadInscritos(false));
search.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadInscritos(), 300); });
const {auth, authModule} = await getAuthServices();
authModule.onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const {db, firestoreModule} = await getFirestoreServices(); const profile = await firestoreModule.getDoc(firestoreModule.doc(db, "users", user.uid));
  canManage = profile.exists() && profile.data().active !== false && profile.data().roles?.admin === true;
  const settings = await firestoreModule.getDoc(firestoreModule.doc(db, "configuracoes", "inscritos"));
  const visibleToUsers = !settings.exists() || settings.data().visivelParaUsuarios !== false;
  if (!canManage && !visibleToUsers) { window.location.replace("/app/"); return; }
  visibilityControl.hidden = !canManage;
  userVisibility.checked = visibleToUsers;
  addToggle.hidden = !canManage; importToggle.hidden = !canManage; deleteAllToggle.hidden = !canManage; loadInscritos();
});

userVisibility.addEventListener("change", async () => {
  if (!canManage) return;
  userVisibility.disabled = true;
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    await firestoreModule.setDoc(firestoreModule.doc(db, "configuracoes", "inscritos"), {
      visivelParaUsuarios: userVisibility.checked,
      atualizadoEm: firestoreModule.serverTimestamp(),
    }, {merge: true});
    setFeedback(userVisibility.checked ? "A lista de inscritos está visível para usuários." : "A lista de inscritos foi ocultada para usuários.");
  } catch (error) {
    console.error(error); userVisibility.checked = !userVisibility.checked;
    setFeedback("Não foi possível atualizar a visibilidade da lista.", "error");
  } finally { userVisibility.disabled = false; }
});
