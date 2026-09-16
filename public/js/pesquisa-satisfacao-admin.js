import {getAuthServices, getFirestoreServices} from "/js/firebase-client.js";

const surveyForm = document.querySelector("[data-survey-form]");
const questionList = document.querySelector("[data-question-list]");
const editorFeedback = document.querySelector("[data-editor-feedback]");
const saveButton = document.querySelector("[data-save]");
const surveyStatus = document.querySelector("[data-survey-status]");
const shareSection = document.querySelector("[data-share-section]");
const publicLink = document.querySelector("[data-public-link]");
const openLink = document.querySelector("[data-open-link]");
const copyLinkButton = document.querySelector("[data-copy-link]");
const shareLinkButton = document.querySelector("[data-share-link]");
const shareFeedback = document.querySelector("[data-share-feedback]");
const qrImage = document.querySelector("[data-qr-image]");
const qrDownload = document.querySelector("[data-qr-download]");
const responsesSection = document.querySelector("[data-responses-section]");
const responsesTotal = document.querySelector("[data-responses-total]");
const responseList = document.querySelector("[data-response-list]");
const responsesFeedback = document.querySelector("[data-responses-feedback]");
const exportResponsesButton = document.querySelector("[data-export-responses]");

const DEFAULT_QUESTIONS = [
  {texto: "De modo geral, como você avalia sua experiência no GROB Experience?", tipo: "alternativa", obrigatoria: true, opcoes: ["1 — Muito ruim", "2 — Ruim", "3 — Regular", "4 — Boa", "5 — Excelente"]},
  {texto: "Como você avalia a organização do evento?", tipo: "alternativa", obrigatoria: true, opcoes: ["Muito ruim", "Ruim", "Regular", "Boa", "Excelente"]},
  {texto: "Como você avalia o conteúdo apresentado?", tipo: "alternativa", obrigatoria: true, opcoes: ["Muito ruim", "Ruim", "Regular", "Bom", "Excelente"]},
  {texto: "Você recomendaria o GROB Experience a um colega?", tipo: "alternativa", obrigatoria: true, opcoes: ["Sim", "Talvez", "Não"]},
  {texto: "Qual foi o ponto alto do evento para você?", tipo: "texto", obrigatoria: false, opcoes: []},
  {texto: "O que podemos melhorar para as próximas edições?", tipo: "texto", obrigatoria: false, opcoes: []},
];

let surveyId = null;
let surveyQuestions = [];
let responses = [];

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, "0")).join("");
}

function newSurveyId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (value) => value.toString(16).padStart(2, "0")).join("");
}

function setMessage(element, message, state = "neutral") {
  element.textContent = message;
  element.dataset.state = state;
}

function moveQuestion(id, direction) {
  const card = questionList.querySelector(`[data-question-id="${CSS.escape(id)}"]`);
  if (!card) return;
  if (direction < 0 && card.previousElementSibling) questionList.insertBefore(card, card.previousElementSibling);
  if (direction > 0 && card.nextElementSibling) questionList.insertBefore(card.nextElementSibling, card);
  updateQuestionNumbers();
}

function updateQuestionNumbers() {
  questionList.querySelectorAll("[data-question-number]").forEach((number, index) => {
    number.textContent = `Pergunta ${index + 1}`;
  });
}

function optionRow(value = "") {
  const row = document.createElement("div");
  row.className = "survey-option-row";
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.maxLength = 160;
  input.placeholder = "Digite uma alternativa";
  input.setAttribute("aria-label", "Alternativa");
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "survey-icon-button";
  remove.textContent = "×";
  remove.title = "Remover alternativa";
  remove.setAttribute("aria-label", "Remover alternativa");
  remove.addEventListener("click", () => row.remove());
  row.append(input, remove);
  return row;
}

function questionCard(question) {
  const card = document.createElement("article");
  card.className = "survey-question-card";
  card.dataset.questionId = question.id;

  const heading = document.createElement("div");
  heading.className = "survey-question-heading";
  const number = document.createElement("strong");
  number.dataset.questionNumber = "";
  const controls = document.createElement("div");
  controls.className = "survey-question-controls";
  const up = document.createElement("button");
  up.type = "button";
  up.className = "survey-icon-button";
  up.textContent = "↑";
  up.title = "Mover para cima";
  up.addEventListener("click", () => moveQuestion(question.id, -1));
  const down = document.createElement("button");
  down.type = "button";
  down.className = "survey-icon-button";
  down.textContent = "↓";
  down.title = "Mover para baixo";
  down.addEventListener("click", () => moveQuestion(question.id, 1));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger-delete";
  remove.textContent = "Remover";
  remove.addEventListener("click", () => {
    if (questionList.children.length === 1) {
      setMessage(editorFeedback, "A pesquisa precisa ter pelo menos uma pergunta.", "error");
      return;
    }
    card.remove();
    updateQuestionNumbers();
  });
  controls.append(up, down, remove);
  heading.append(number, controls);

  const textLabel = document.createElement("label");
  textLabel.className = "management-field";
  textLabel.append("Enunciado");
  const textInput = document.createElement("input");
  textInput.type = "text";
  textInput.required = true;
  textInput.maxLength = 300;
  textInput.value = question.texto;
  textInput.dataset.questionText = "";
  textLabel.append(textInput);

  const settings = document.createElement("div");
  settings.className = "survey-question-settings";
  const typeLabel = document.createElement("label");
  typeLabel.className = "management-field";
  typeLabel.append("Tipo de resposta");
  const typeSelect = document.createElement("select");
  typeSelect.dataset.questionType = "";
  typeSelect.innerHTML = '<option value="texto">Texto</option><option value="alternativa">Alternativas</option>';
  typeSelect.value = question.tipo;
  typeLabel.append(typeSelect);
  const requiredLabel = document.createElement("label");
  requiredLabel.className = "survey-required";
  const required = document.createElement("input");
  required.type = "checkbox";
  required.checked = question.obrigatoria;
  required.dataset.questionRequired = "";
  requiredLabel.append(required, " Resposta obrigatória");
  settings.append(typeLabel, requiredLabel);

  const optionsArea = document.createElement("div");
  optionsArea.className = "survey-options-area";
  optionsArea.dataset.optionsArea = "";
  const optionsList = document.createElement("div");
  optionsList.className = "survey-options-list";
  optionsList.dataset.optionsList = "";
  const values = question.opcoes?.length ? question.opcoes : ["Opção 1", "Opção 2"];
  values.forEach((value) => optionsList.append(optionRow(value)));
  const addOption = document.createElement("button");
  addOption.type = "button";
  addOption.className = "back-link survey-add-option";
  addOption.textContent = "+ Adicionar alternativa";
  addOption.addEventListener("click", () => {
    if (optionsList.children.length >= 20) return;
    optionsList.append(optionRow());
    optionsList.lastElementChild.querySelector("input").focus();
  });
  optionsArea.append(optionsList, addOption);

  function updateType() {
    optionsArea.hidden = typeSelect.value !== "alternativa";
  }
  typeSelect.addEventListener("change", updateType);
  updateType();
  card.append(heading, textLabel, settings, optionsArea);
  return card;
}

function renderQuestions(questions) {
  questionList.replaceChildren();
  questions.forEach((question) => questionList.append(questionCard(question)));
  updateQuestionNumbers();
}

function addQuestion(type) {
  if (questionList.children.length >= 50) {
    setMessage(editorFeedback, "O limite é de 50 perguntas por pesquisa.", "error");
    return;
  }
  const question = {id: newId(), texto: "", tipo: type, obrigatoria: false, opcoes: type === "alternativa" ? ["Opção 1", "Opção 2"] : []};
  const card = questionCard(question);
  questionList.append(card);
  updateQuestionNumbers();
  card.querySelector("[data-question-text]").focus();
}

function collectQuestions() {
  return Array.from(questionList.querySelectorAll("[data-question-id]")).map((card, index) => {
    const texto = card.querySelector("[data-question-text]").value.trim();
    const tipo = card.querySelector("[data-question-type]").value;
    const opcoes = tipo === "alternativa"
      ? Array.from(card.querySelectorAll("[data-options-list] input")).map((input) => input.value.trim()).filter(Boolean)
      : [];
    if (!texto) throw new Error(`Informe o enunciado da pergunta ${index + 1}.`);
    if (tipo === "alternativa" && opcoes.length < 2) throw new Error(`A pergunta ${index + 1} precisa ter pelo menos duas alternativas.`);
    if (new Set(opcoes.map((option) => option.toLocaleLowerCase("pt-BR"))).size !== opcoes.length) throw new Error(`A pergunta ${index + 1} possui alternativas repetidas.`);
    return {id: card.dataset.questionId, texto, tipo, obrigatoria: card.querySelector("[data-question-required]").checked, opcoes};
  });
}

function formatDate(timestamp) {
  if (!timestamp?.toDate) return "Horário em processamento";
  return timestamp.toDate().toLocaleString("pt-BR", {dateStyle: "short", timeStyle: "short"});
}

function publicSurveyUrl() {
  return `${window.location.origin}/pesquisa-satisfacao/?id=${encodeURIComponent(surveyId)}`;
}

async function renderShare() {
  if (!surveyId) return;
  const url = publicSurveyUrl();
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
    qrDownload.download = "qr-code-pesquisa-satisfacao.png";
  } catch (error) {
    console.error(error);
    setMessage(shareFeedback, "A pesquisa foi salva, mas o QR Code não pôde ser gerado agora. O link continua disponível.", "error");
  }
}

function answerValue(response, questionId) {
  const answer = Array.isArray(response.respostas) ? response.respostas.find((item) => item.perguntaId === questionId) : null;
  return String(answer?.valor || "");
}

function renderResponses() {
  responsesTotal.textContent = `${responses.length} resposta(s)`;
  responseList.replaceChildren();
  if (!responses.length) {
    responseList.innerHTML = '<p class="empty-management">Nenhuma resposta recebida ainda.</p>';
    exportResponsesButton.disabled = true;
    return;
  }
  exportResponsesButton.disabled = false;
  responses.forEach((response, index) => {
    const item = document.createElement("details");
    item.className = "survey-response-item";
    const summary = document.createElement("summary");
    const title = document.createElement("strong");
    title.textContent = `Resposta ${responses.length - index}`;
    const date = document.createElement("span");
    date.textContent = formatDate(response.coletadoEm);
    summary.append(title, date);
    const answers = document.createElement("div");
    answers.className = "survey-response-answers";
    const items = Array.isArray(response.respostas) ? response.respostas : [];
    items.forEach((answer) => {
      const row = document.createElement("div");
      const question = document.createElement("strong");
      question.textContent = answer.pergunta || "Pergunta";
      const value = document.createElement("p");
      value.textContent = String(answer.valor || "Não respondida");
      row.append(question, value);
      answers.append(row);
    });
    item.append(summary, answers);
    responseList.append(item);
  });
}

async function loadResponses() {
  if (!surveyId) return;
  setMessage(responsesFeedback, "Carregando respostas...");
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const snapshot = await firestoreModule.getDocs(firestoreModule.query(
      firestoreModule.collection(db, "respostasPesquisaSatisfacao"),
      firestoreModule.where("pesquisaId", "==", surveyId),
    ));
    responses = snapshot.docs
      .map((document) => ({id: document.id, ...document.data()}))
      .sort((first, second) => (second.coletadoEm?.toMillis?.() || 0) - (first.coletadoEm?.toMillis?.() || 0));
    renderResponses();
    responsesSection.hidden = false;
    setMessage(responsesFeedback, responses.length ? "Dados atualizados." : "");
  } catch (error) {
    console.error(error);
    setMessage(responsesFeedback, "Não foi possível carregar as respostas.", "error");
  }
}

async function loadSurvey() {
  setMessage(editorFeedback, "Carregando configuração...");
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const snapshot = await firestoreModule.getDocs(firestoreModule.query(
      firestoreModule.collection(db, "pesquisasSatisfacao"),
      firestoreModule.limit(1),
    ));
    if (snapshot.empty) {
      surveyId = null;
      surveyQuestions = DEFAULT_QUESTIONS.map((question) => ({id: newId(), ...question}));
      surveyForm.elements.titulo.value = "Pesquisa de satisfação — GROB Experience";
      surveyForm.elements.descricao.value = "Conte como foi sua experiência. Suas respostas são anônimas e nos ajudam a tornar o evento cada vez melhor.";
      surveyForm.elements.ativa.checked = true;
      surveyStatus.textContent = "Ainda não publicada";
      renderQuestions(surveyQuestions);
      setMessage(editorFeedback, "Revise as perguntas e salve para gerar o link e o QR Code.");
      shareSection.hidden = true;
      responsesSection.hidden = true;
      return;
    }
    const document = snapshot.docs[0];
    const data = document.data();
    surveyId = document.id;
    surveyQuestions = Array.isArray(data.perguntas) ? data.perguntas : [];
    surveyForm.elements.titulo.value = data.titulo || "Pesquisa de satisfação — GROB Experience";
    surveyForm.elements.descricao.value = data.descricao || "";
    surveyForm.elements.ativa.checked = data.ativa !== false;
    surveyStatus.textContent = data.ativa !== false ? "Publicada e recebendo respostas" : "Publicada, mas pausada";
    renderQuestions(surveyQuestions.length ? surveyQuestions : DEFAULT_QUESTIONS.map((question) => ({id: newId(), ...question})));
    setMessage(editorFeedback, "");
    await Promise.all([renderShare(), loadResponses()]);
  } catch (error) {
    console.error(error);
    setMessage(editorFeedback, "Não foi possível carregar a pesquisa.", "error");
  }
}

surveyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!surveyForm.reportValidity()) return;
  saveButton.disabled = true;
  saveButton.textContent = "Salvando...";
  let creating = false;
  let writeCompleted = false;
  try {
    const questions = collectQuestions();
    if (!questions.length) throw new Error("Adicione pelo menos uma pergunta.");
    const surveyTitle = surveyForm.elements.titulo.value.trim();
    if (!surveyTitle) throw new Error("Informe o título da pesquisa.");
    const {db, firestoreModule} = await getFirestoreServices();
    creating = !surveyId;
    if (creating) surveyId = newSurveyId();
    const data = {
      titulo: surveyTitle,
      descricao: surveyForm.elements.descricao.value.trim(),
      ativa: surveyForm.elements.ativa.checked,
      perguntas: questions,
      atualizadoEm: firestoreModule.serverTimestamp(),
    };
    if (creating) data.criadoEm = firestoreModule.serverTimestamp();
    await firestoreModule.setDoc(firestoreModule.doc(db, "pesquisasSatisfacao", surveyId), data, {merge: !creating});
    writeCompleted = true;
    surveyQuestions = questions;
    surveyStatus.textContent = data.ativa ? "Publicada e recebendo respostas" : "Publicada, mas pausada";
    setMessage(editorFeedback, "Pesquisa salva com sucesso.", "success");
    await Promise.all([renderShare(), loadResponses()]);
  } catch (error) {
    console.error(error);
    if (creating && !writeCompleted) surveyId = null;
    setMessage(editorFeedback, error.message || "Não foi possível salvar a pesquisa.", "error");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Salvar pesquisa";
  }
});

document.querySelector("[data-add-text]").addEventListener("click", () => addQuestion("texto"));
document.querySelector("[data-add-choice]").addEventListener("click", () => addQuestion("alternativa"));
document.querySelector("[data-reload]").addEventListener("click", loadSurvey);
document.querySelector("[data-reload-responses]").addEventListener("click", loadResponses);

copyLinkButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(publicLink.value);
    setMessage(shareFeedback, "Link copiado.", "success");
  } catch (error) {
    publicLink.focus();
    publicLink.select();
    const copied = document.execCommand("copy");
    setMessage(shareFeedback, copied ? "Link copiado." : "Selecione e copie o link acima.", copied ? "success" : "error");
  }
});

shareLinkButton.addEventListener("click", async () => {
  try {
    await navigator.share({title: surveyForm.elements.titulo.value, text: "Responda à pesquisa de satisfação do GROB Experience.", url: publicLink.value});
  } catch (error) {
    if (error.name !== "AbortError") setMessage(shareFeedback, "Não foi possível abrir o compartilhamento. Copie o link acima.", "error");
  }
});

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

exportResponsesButton.addEventListener("click", () => {
  if (!responses.length) return;
  const header = ["Data e hora", ...surveyQuestions.map((question) => question.texto)];
  const rows = responses.map((response) => [formatDate(response.coletadoEm), ...surveyQuestions.map((question) => answerValue(response, question.id))]);
  const csv = "\ufeff" + [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
  const link = document.createElement("a");
  link.href = url;
  link.download = "respostas-pesquisa-satisfacao.csv";
  link.click();
  URL.revokeObjectURL(url);
});

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
  await loadSurvey();
});
