import {getFirestoreServices} from "/js/firebase-client.js";

const loading = document.querySelector("[data-survey-loading]");
const content = document.querySelector("[data-survey-content]");
const thanks = document.querySelector("[data-survey-thanks]");
const errorSection = document.querySelector("[data-survey-error]");
const errorMessage = document.querySelector("[data-error-message]");
const title = document.querySelector("[data-survey-title]");
const description = document.querySelector("[data-survey-description]");
const form = document.querySelector("[data-response-form]");
const questionsContainer = document.querySelector("[data-public-questions]");
const submitButton = document.querySelector("[data-submit-response]");
const feedback = document.querySelector("[data-public-feedback]");

const surveyId = new URLSearchParams(window.location.search).get("id")?.trim() || "";
let questions = [];

function showError(message) {
  loading.hidden = true;
  content.hidden = true;
  thanks.hidden = true;
  errorSection.hidden = false;
  errorMessage.textContent = message;
}

function showThanks() {
  loading.hidden = true;
  content.hidden = true;
  errorSection.hidden = true;
  thanks.hidden = false;
}

function renderQuestions() {
  questionsContainer.replaceChildren();
  questions.forEach((question, index) => {
    const wrapper = document.createElement("section");
    wrapper.className = "survey-public-question";
    const labelText = `${index + 1}. ${question.texto}`;
    if (question.tipo === "alternativa") {
      const fieldset = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = labelText;
      fieldset.append(legend);
      (question.opcoes || []).forEach((option, optionIndex) => {
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.type = "radio";
        input.name = question.id;
        input.value = option;
        input.required = question.obrigatoria === true && optionIndex === 0;
        label.append(input, option);
        fieldset.append(label);
      });
      wrapper.append(fieldset);
    } else {
      const label = document.createElement("label");
      label.textContent = labelText;
      const textarea = document.createElement("textarea");
      textarea.name = question.id;
      textarea.rows = 4;
      textarea.maxLength = 2000;
      textarea.required = question.obrigatoria === true;
      label.append(textarea);
      wrapper.append(label);
    }
    if (question.obrigatoria === true) {
      const required = document.createElement("small");
      required.textContent = "Obrigatória";
      wrapper.append(required);
    }
    questionsContainer.append(wrapper);
  });
}

async function loadSurvey() {
  if (!/^[a-f0-9]{48}$/.test(surveyId)) {
    showError("O link da pesquisa é inválido. Solicite um novo link à organização do evento.");
    return;
  }
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const snapshot = await firestoreModule.getDoc(firestoreModule.doc(db, "pesquisasSatisfacao", surveyId));
    if (!snapshot.exists()) {
      showError("Esta pesquisa não foi encontrada. Confira se o link foi copiado por completo.");
      return;
    }
    const survey = snapshot.data();
    if (survey.ativa !== true) {
      showError("Esta pesquisa não está recebendo novas respostas no momento.");
      return;
    }
    questions = Array.isArray(survey.perguntas) ? survey.perguntas : [];
    if (!questions.length) {
      showError("Esta pesquisa ainda não possui perguntas publicadas.");
      return;
    }
    title.textContent = survey.titulo || "Pesquisa de satisfação";
    description.textContent = survey.descricao || "Compartilhe sua experiência conosco.";
    renderQuestions();
    loading.hidden = true;
    content.hidden = false;
  } catch (error) {
    console.error(error);
    showError("Não foi possível abrir a pesquisa agora. Verifique sua conexão e tente novamente.");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  submitButton.disabled = true;
  submitButton.textContent = "Enviando...";
  feedback.textContent = "Registrando suas respostas...";
  feedback.dataset.state = "neutral";
  try {
    const formData = new FormData(form);
    const respostas = questions.map((question) => ({
      perguntaId: question.id,
      pergunta: question.texto,
      tipo: question.tipo,
      valor: String(formData.get(question.id) || "").trim(),
    }));
    const missing = questions.findIndex((question, index) => question.obrigatoria === true && !respostas[index].valor);
    if (missing >= 0) throw new Error(`Responda à pergunta ${missing + 1}.`);
    const {db, firestoreModule} = await getFirestoreServices();
    await firestoreModule.addDoc(firestoreModule.collection(db, "respostasPesquisaSatisfacao"), {
      pesquisaId: surveyId,
      respostas,
      coletadoEm: firestoreModule.serverTimestamp(),
    });
    showThanks();
  } catch (error) {
    console.error(error);
    feedback.textContent = error.message || "Não foi possível enviar suas respostas. Tente novamente.";
    feedback.dataset.state = "error";
    submitButton.disabled = false;
    submitButton.textContent = "Enviar respostas";
  }
});

await loadSurvey();
