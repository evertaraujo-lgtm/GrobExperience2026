import {getAuthServices, getFirestoreServices} from "/js/firebase-client.js";

const editor = document.querySelector("[data-form-editor]");
const fieldList = document.querySelector("[data-field-list]");
const editorFeedback = document.querySelector("[data-editor-feedback]");
const saveButton = document.querySelector("[data-save]");
const formStatus = document.querySelector("[data-form-status]");
const editorTitle = document.querySelector("[data-editor-title]");
const formList = document.querySelector("[data-form-list]");
const shareSection = document.querySelector("[data-share-section]");
const publicLink = document.querySelector("[data-public-link]");
const openLink = document.querySelector("[data-open-link]");
const shareLinkButton = document.querySelector("[data-share-link]");
const shareFeedback = document.querySelector("[data-share-feedback]");
const qrImage = document.querySelector("[data-qr-image]");
const qrDownload = document.querySelector("[data-qr-download]");
const responsesSection = document.querySelector("[data-responses-section]");
const responsesTotal = document.querySelector("[data-responses-total]");
const responseList = document.querySelector("[data-response-list]");
const responsesFeedback = document.querySelector("[data-responses-feedback]");
const exportButton = document.querySelector("[data-export-responses]");
const newFormButton = document.querySelector("[data-new-form]");

const FIELD_TYPES = [
  ["texto", "Texto curto"], ["paragrafo", "Texto longo"], ["email", "E-mail"],
  ["telefone", "Telefone"], ["data", "Data"], ["selecao", "Lista de opções"],
  ["multipla", "Caixas de seleção"],
  ["confirmacao", "Confirmação"],
];
const DEFAULT_FIELDS = [
  {rotulo: "Nome completo", tipo: "texto", obrigatorio: true, opcoes: []},
  {rotulo: "E-mail", tipo: "email", obrigatorio: true, opcoes: []},
  {rotulo: "Empresa", tipo: "texto", obrigatorio: false, opcoes: []},
];

let formId = null;
let savedForms = [];
let responses = [];
let activeFields = [];

function randomHex(bytes = 24) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (value) => value.toString(16).padStart(2, "0")).join("");
}

function newFieldId() {
  return crypto.randomUUID?.() || randomHex(16);
}

function setMessage(element, message, state = "neutral") {
  element.textContent = message;
  element.dataset.state = state;
}

function moveField(id, direction) {
  const card = fieldList.querySelector(`[data-field-id="${CSS.escape(id)}"]`);
  if (!card) return;
  if (direction < 0 && card.previousElementSibling) fieldList.insertBefore(card, card.previousElementSibling);
  if (direction > 0 && card.nextElementSibling) fieldList.insertBefore(card.nextElementSibling, card);
  updateFieldNumbers();
}

function updateFieldNumbers() {
  fieldList.querySelectorAll("[data-field-number]").forEach((element, index) => {
    element.textContent = `Campo ${index + 1}`;
  });
}

function optionRow(value = "") {
  const row = document.createElement("div");
  row.className = "survey-option-row";
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.maxLength = 160;
  input.placeholder = "Digite uma opção";
  input.setAttribute("aria-label", "Opção da lista");
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "survey-icon-button";
  remove.textContent = "×";
  remove.setAttribute("aria-label", "Remover opção");
  remove.addEventListener("click", () => row.remove());
  row.append(input, remove);
  return row;
}

function fieldCard(field) {
  const card = document.createElement("article");
  card.className = "survey-question-card registration-field-card";
  card.dataset.fieldId = field.id;

  const heading = document.createElement("div");
  heading.className = "survey-question-heading";
  const number = document.createElement("strong");
  number.dataset.fieldNumber = "";
  const controls = document.createElement("div");
  controls.className = "survey-question-controls";
  for (const [label, direction] of [["↑", -1], ["↓", 1]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "survey-icon-button";
    button.textContent = label;
    button.setAttribute("aria-label", direction < 0 ? "Mover campo para cima" : "Mover campo para baixo");
    button.addEventListener("click", () => moveField(field.id, direction));
    controls.append(button);
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger-delete";
  remove.textContent = "Remover";
  remove.addEventListener("click", () => {
    if (fieldList.children.length === 1) {
      setMessage(editorFeedback, "O formulário precisa ter pelo menos um campo.", "error");
      return;
    }
    card.remove();
    updateFieldNumbers();
  });
  controls.append(remove);
  heading.append(number, controls);

  const label = document.createElement("label");
  label.className = "management-field";
  label.append("Nome do campo");
  const input = document.createElement("input");
  input.type = "text";
  input.required = true;
  input.maxLength = 160;
  input.value = field.rotulo || "";
  input.dataset.fieldLabel = "";
  label.append(input);

  const settings = document.createElement("div");
  settings.className = "survey-question-settings";
  const typeLabel = document.createElement("label");
  typeLabel.className = "management-field";
  typeLabel.append("Tipo de campo");
  const select = document.createElement("select");
  select.dataset.fieldType = "";
  FIELD_TYPES.forEach(([value, text]) => select.add(new Option(text, value)));
  select.value = FIELD_TYPES.some(([value]) => value === field.tipo) ? field.tipo : "texto";
  typeLabel.append(select);
  const requiredLabel = document.createElement("label");
  requiredLabel.className = "survey-required";
  const required = document.createElement("input");
  required.type = "checkbox";
  required.checked = field.obrigatorio === true;
  required.dataset.fieldRequired = "";
  requiredLabel.append(required, " Campo obrigatório");
  settings.append(typeLabel, requiredLabel);

  const optionsArea = document.createElement("div");
  optionsArea.className = "survey-options-area";
  const optionsList = document.createElement("div");
  optionsList.className = "survey-options-list";
  optionsList.dataset.fieldOptions = "";
  const optionValues = field.opcoes?.length ? field.opcoes : ["Opção 1", "Opção 2"];
  optionValues.forEach((value) => optionsList.append(optionRow(value)));
  const addOption = document.createElement("button");
  addOption.type = "button";
  addOption.className = "back-link survey-add-option";
  addOption.textContent = "+ Adicionar opção";
  addOption.addEventListener("click", () => {
    if (optionsList.children.length >= 20) return;
    optionsList.append(optionRow());
    optionsList.lastElementChild.querySelector("input").focus();
  });
  optionsArea.append(optionsList, addOption);
  const updateOptions = () => { optionsArea.hidden = !["selecao", "multipla"].includes(select.value); };
  select.addEventListener("change", updateOptions);
  updateOptions();
  card.append(heading, label, settings, optionsArea);
  return card;
}

function renderFields(fields) {
  fieldList.replaceChildren();
  fields.forEach((field) => fieldList.append(fieldCard(field)));
  updateFieldNumbers();
}

function addField() {
  if (fieldList.children.length >= 40) {
    setMessage(editorFeedback, "O limite é de 40 campos por formulário.", "error");
    return;
  }
  const field = {id: newFieldId(), rotulo: "", tipo: "texto", obrigatorio: false, opcoes: []};
  const card = fieldCard(field);
  fieldList.append(card);
  updateFieldNumbers();
  card.querySelector("[data-field-label]").focus();
}

function collectFields() {
  const fields = Array.from(fieldList.querySelectorAll("[data-field-id]")).map((card, index) => {
    const rotulo = card.querySelector("[data-field-label]").value.trim();
    const tipo = card.querySelector("[data-field-type]").value;
    const opcoes = ["selecao", "multipla"].includes(tipo)
      ? Array.from(card.querySelectorAll("[data-field-options] input")).map((input) => input.value.trim()).filter(Boolean)
      : [];
    if (!rotulo) throw new Error(`Informe o nome do campo ${index + 1}.`);
    if (["selecao", "multipla"].includes(tipo) && opcoes.length < 2) throw new Error(`O campo ${index + 1} precisa ter pelo menos duas opções.`);
    if (new Set(opcoes.map((option) => option.toLocaleLowerCase("pt-BR"))).size !== opcoes.length) {
      throw new Error(`O campo ${index + 1} possui opções repetidas.`);
    }
    return {id: card.dataset.fieldId, rotulo, tipo, obrigatorio: card.querySelector("[data-field-required]").checked, opcoes};
  });
  if (!fields.length) throw new Error("Adicione pelo menos um campo.");
  return fields;
}

function formUrl() {
  return `${window.location.origin}/formularios-inscricao/?id=${encodeURIComponent(formId)}`;
}

function sortTime(form) {
  return form.criadoEm?.toMillis?.() || form.atualizadoEm?.toMillis?.() || 0;
}

function renderFormList() {
  formList.replaceChildren();
  if (!savedForms.length) {
    formList.innerHTML = '<p class="empty-management">Ainda não há formulários salvos. Crie um para compartilhar inscrições.</p>';
    return;
  }
  savedForms.forEach((form) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "survey-library-item";
    if (form.id === formId) button.classList.add("is-selected");
    button.setAttribute("aria-current", form.id === formId ? "true" : "false");
    button.addEventListener("click", () => loadForm(form.id));
    const details = document.createElement("span");
    details.className = "survey-library-item-details";
    const title = document.createElement("strong");
    title.textContent = form.titulo || "Formulário sem título";
    const metadata = document.createElement("small");
    const count = Number.isInteger(form.campos?.length) ? `${form.campos.length} campo(s)` : "Formulário salvo";
    metadata.textContent = `${form.ativa === false ? "Pausado" : "Recebendo inscrições"} · ${count}`;
    details.append(title, metadata);
    const action = document.createElement("span");
    action.className = "survey-library-item-action";
    action.textContent = form.id === formId ? "Aberto" : "Abrir";
    button.append(details, action);
    formList.append(button);
  });
}

async function loadFormList() {
  const {db, firestoreModule} = await getFirestoreServices();
  const snapshot = await firestoreModule.getDocs(firestoreModule.collection(db, "formulariosInscricao"));
  savedForms = snapshot.docs.map((document) => ({id: document.id, ...document.data()}))
    .sort((first, second) => sortTime(second) - sortTime(first));
  renderFormList();
}

function startNewForm() {
  formId = null;
  responses = [];
  activeFields = DEFAULT_FIELDS.map((field) => ({id: newFieldId(), ...field}));
  editor.elements.titulo.value = "";
  editor.elements.descricao.value = "";
  editor.elements.ativa.checked = true;
  formStatus.textContent = "Novo formulário ainda não salvo";
  editorTitle.textContent = "Configuração do novo formulário";
  renderFields(activeFields);
  renderFormList();
  setMessage(editorFeedback, "Defina o nome e a finalidade, ajuste os campos e salve para gerar o link público.");
  setMessage(shareFeedback, "");
  setMessage(responsesFeedback, "");
  shareSection.hidden = true;
  responsesSection.hidden = true;
  editor.scrollIntoView({behavior: "smooth", block: "start"});
}

async function renderShare() {
  if (!formId) return;
  const url = formUrl();
  publicLink.value = url;
  openLink.href = url;
  shareSection.hidden = false;
  shareLinkButton.hidden = !navigator.share;
  try {
    const qrLibrary = await import("https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm");
    const toDataURL = qrLibrary.toDataURL || qrLibrary.default?.toDataURL;
    if (!toDataURL) throw new Error("Gerador indisponível");
    const imageUrl = await toDataURL(url, {width: 640, margin: 2, errorCorrectionLevel: "M"});
    qrImage.src = imageUrl;
    qrDownload.href = imageUrl;
    qrDownload.download = "qr-code-formulario-inscricao.png";
  } catch (error) {
    console.error(error);
    setMessage(shareFeedback, "O formulário foi salvo, mas o QR Code não pôde ser gerado agora. O link continua disponível.", "error");
  }
}

function formatDate(timestamp) {
  if (!timestamp?.toDate) return "Horário em processamento";
  return timestamp.toDate().toLocaleString("pt-BR", {dateStyle: "short", timeStyle: "short"});
}

function renderResponses() {
  responsesTotal.textContent = `${responses.length} inscrição(ões)`;
  responseList.replaceChildren();
  exportButton.disabled = responses.length === 0;
  if (!responses.length) {
    responseList.innerHTML = '<p class="empty-management">Nenhuma inscrição recebida ainda.</p>';
    return;
  }
  responses.forEach((response, index) => {
    const item = document.createElement("details");
    item.className = "survey-response-item";
    const summary = document.createElement("summary");
    const title = document.createElement("strong");
    title.textContent = `Inscrição ${responses.length - index}`;
    const date = document.createElement("span");
    date.textContent = formatDate(response.enviadoEm);
    summary.append(title, date);
    const answers = document.createElement("div");
    answers.className = "survey-response-answers";
    (Array.isArray(response.respostas) ? response.respostas : []).forEach((answer) => {
      const row = document.createElement("div");
      const field = document.createElement("strong");
      field.textContent = answer.rotulo || "Campo";
      const value = document.createElement("p");
      value.textContent = answer.valor || "—";
      row.append(field, value);
      answers.append(row);
    });
    item.append(summary, answers);
    responseList.append(item);
  });
}

async function loadResponses() {
  if (!formId) return;
  setMessage(responsesFeedback, "Carregando inscrições...");
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const snapshot = await firestoreModule.getDocs(firestoreModule.query(
      firestoreModule.collection(db, "respostasFormulariosInscricao"),
      firestoreModule.where("formularioId", "==", formId),
    ));
    responses = snapshot.docs.map((document) => ({id: document.id, ...document.data()}))
      .sort((first, second) => (second.enviadoEm?.toMillis?.() || 0) - (first.enviadoEm?.toMillis?.() || 0));
    renderResponses();
    responsesSection.hidden = false;
    setMessage(responsesFeedback, responses.length ? "Inscrições atualizadas." : "");
  } catch (error) {
    console.error(error);
    setMessage(responsesFeedback, "Não foi possível carregar as inscrições.", "error");
  }
}

async function loadForm(id = null) {
  setMessage(editorFeedback, "Carregando formulário...");
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    await loadFormList();
    if (!savedForms.length) {
      startNewForm();
      return;
    }
    const selected = id ? savedForms.find((form) => form.id === id) : savedForms[0];
    if (!selected) throw new Error("Esse formulário não está mais disponível.");
    const snapshot = await firestoreModule.getDoc(firestoreModule.doc(db, "formulariosInscricao", selected.id));
    if (!snapshot.exists()) throw new Error("Esse formulário não está mais disponível.");
    const data = snapshot.data();
    formId = snapshot.id;
    activeFields = Array.isArray(data.campos) ? data.campos : [];
    editor.elements.titulo.value = data.titulo || "";
    editor.elements.descricao.value = data.descricao || "";
    editor.elements.ativa.checked = data.ativa !== false;
    formStatus.textContent = data.ativa !== false ? "Publicado e recebendo inscrições" : "Publicado, mas pausado";
    editorTitle.textContent = "Configuração do formulário";
    renderFields(activeFields.length ? activeFields : DEFAULT_FIELDS.map((field) => ({id: newFieldId(), ...field})));
    renderFormList();
    setMessage(editorFeedback, "");
    await Promise.all([renderShare(), loadResponses()]);
  } catch (error) {
    console.error(error);
    setMessage(editorFeedback, error.message || "Não foi possível carregar o formulário.", "error");
  }
}

editor.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!editor.reportValidity()) return;
  saveButton.disabled = true;
  saveButton.textContent = "Salvando...";
  let creating = false;
  let writeCompleted = false;
  try {
    const fields = collectFields();
    const title = editor.elements.titulo.value.trim();
    if (!title) throw new Error("Informe o nome do formulário.");
    const {db, firestoreModule} = await getFirestoreServices();
    creating = !formId;
    if (creating) formId = randomHex();
    const data = {
      titulo: title,
      descricao: editor.elements.descricao.value.trim(),
      ativa: editor.elements.ativa.checked,
      campos: fields,
      atualizadoEm: firestoreModule.serverTimestamp(),
    };
    if (creating) data.criadoEm = firestoreModule.serverTimestamp();
    await firestoreModule.setDoc(firestoreModule.doc(db, "formulariosInscricao", formId), data, {merge: !creating});
    writeCompleted = true;
    activeFields = fields;
    formStatus.textContent = data.ativa ? "Publicado e recebendo inscrições" : "Publicado, mas pausado";
    editorTitle.textContent = "Configuração do formulário";
    setMessage(editorFeedback, "Formulário salvo com sucesso.", "success");
    await Promise.all([loadFormList(), renderShare(), loadResponses()]);
  } catch (error) {
    console.error(error);
    if (creating && !writeCompleted) formId = null;
    setMessage(editorFeedback, error.message || "Não foi possível salvar o formulário.", "error");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Salvar formulário";
  }
});

document.querySelector("[data-add-field]").addEventListener("click", addField);
document.querySelector("[data-reload]").addEventListener("click", () => loadForm(formId));
document.querySelector("[data-reload-responses]").addEventListener("click", loadResponses);
newFormButton.addEventListener("click", startNewForm);

document.querySelector("[data-copy-link]").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(publicLink.value);
    setMessage(shareFeedback, "Link copiado.", "success");
  } catch {
    publicLink.focus();
    publicLink.select();
    const copied = document.execCommand("copy");
    setMessage(shareFeedback, copied ? "Link copiado." : "Selecione e copie o link acima.", copied ? "success" : "error");
  }
});

shareLinkButton.addEventListener("click", async () => {
  try {
    await navigator.share({title: editor.elements.titulo.value, text: "Preencha o formulário de inscrição do GROB Experience.", url: publicLink.value});
  } catch (error) {
    if (error.name !== "AbortError") setMessage(shareFeedback, "Não foi possível compartilhar. Copie o link acima.", "error");
  }
});

function csvCell(value) {
  const text = String(value ?? "");
  const safeText = /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

exportButton.addEventListener("click", () => {
  if (!responses.length) return;
  const header = ["Data e hora", ...activeFields.map((field) => field.rotulo)];
  const rows = responses.map((response) => {
    const answers = new Map((response.respostas || []).map((answer) => [answer.campoId, answer.valor]));
    return [formatDate(response.enviadoEm), ...activeFields.map((field) => answers.get(field.id) || "")];
  });
  const csv = "\ufeff" + [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
  const link = document.createElement("a");
  link.href = url;
  link.download = "inscricoes-formulario.csv";
  link.click();
  URL.revokeObjectURL(url);
});

const {auth, authModule} = await getAuthServices();
authModule.onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const profile = await firestoreModule.getDoc(firestoreModule.doc(db, "users", user.uid));
    const isAdmin = profile.exists() && profile.data().active !== false && profile.data().roles?.admin === true;
    if (!isAdmin) {
      window.location.replace("/app/");
      return;
    }
    await loadForm();
  } catch (error) {
    console.error(error);
    setMessage(editorFeedback, "Não foi possível validar o acesso ou carregar os formulários.", "error");
  }
});
