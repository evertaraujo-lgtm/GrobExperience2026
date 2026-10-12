import {getFirestoreServices} from "/js/firebase-client.js";

const loading = document.querySelector("[data-form-loading]");
const content = document.querySelector("[data-form-content]");
const thanks = document.querySelector("[data-form-thanks]");
const errorSection = document.querySelector("[data-form-error]");
const errorMessage = document.querySelector("[data-error-message]");
const title = document.querySelector("[data-form-title]");
const description = document.querySelector("[data-form-description]");
const form = document.querySelector("[data-registration-form]");
const fieldsContainer = document.querySelector("[data-public-fields]");
const submitButton = document.querySelector("[data-submit-form]");
const feedback = document.querySelector("[data-public-feedback]");
const formId = new URLSearchParams(window.location.search).get("id")?.trim() || "";
let fields = [];

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

function renderFields() {
  fieldsContainer.replaceChildren();
  fields.forEach((field, index) => {
    const wrapper = document.createElement("section");
    wrapper.className = "survey-public-question";
    wrapper.dataset.registrationField = field.id;
    const labelText = `${index + 1}. ${field.rotulo}`;
    let control;

    if (field.tipo === "selecao") {
      const label = document.createElement("label");
      label.textContent = labelText;
      control = document.createElement("select");
      control.name = field.id;
      control.required = field.obrigatorio === true;
      const placeholder = new Option("Selecione uma opção", "");
      placeholder.disabled = field.obrigatorio === true;
      placeholder.selected = true;
      control.add(placeholder);
      (field.opcoes || []).forEach((option) => control.add(new Option(option, option)));
      label.append(control);
      wrapper.append(label);
    } else if (field.tipo === "multipla") {
      const fieldset = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = labelText;
      fieldset.append(legend);
      (field.opcoes || []).forEach((option) => {
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.name = field.id;
        input.value = option;
        label.append(input, option);
        fieldset.append(label);
      });
      wrapper.append(fieldset);
    } else if (field.tipo === "confirmacao") {
      const label = document.createElement("label");
      label.className = "registration-confirmation";
      control = document.createElement("input");
      control.type = "checkbox";
      control.name = field.id;
      control.required = field.obrigatorio === true;
      const labelTextNode = document.createElement("span");
      labelTextNode.textContent = labelText;
      label.append(control, labelTextNode);
      wrapper.append(label);
    } else {
      const label = document.createElement("label");
      label.textContent = labelText;
      control = document.createElement(field.tipo === "paragrafo" ? "textarea" : "input");
      control.name = field.id;
      control.required = field.obrigatorio === true;
      if (field.tipo === "paragrafo") {
        control.rows = 4;
        control.maxLength = 2000;
        control.placeholder = "Digite sua resposta";
      } else {
        const inputTypes = {email: "email", telefone: "tel", data: "date"};
        control.type = inputTypes[field.tipo] || "text";
        control.maxLength = 300;
        if (field.tipo === "telefone") control.autocomplete = "tel";
        if (field.tipo === "email") control.autocomplete = "email";
      }
      label.append(control);
      wrapper.append(label);
    }

    if (field.obrigatorio === true) {
      const required = document.createElement("small");
      required.textContent = "Obrigatório";
      wrapper.append(required);
    }
    fieldsContainer.append(wrapper);
  });
}

async function loadForm() {
  if (!/^[a-f0-9]{48}$/.test(formId)) {
    showError("O link deste formulário é inválido. Solicite um novo link à organização do evento.");
    return;
  }
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const snapshot = await firestoreModule.getDoc(firestoreModule.doc(db, "formulariosInscricao", formId));
    if (!snapshot.exists()) {
      showError("Este formulário não foi encontrado. Confira se o link foi copiado por completo.");
      return;
    }
    const data = snapshot.data();
    if (data.ativa !== true) {
      showError("Este formulário não está recebendo inscrições no momento.");
      return;
    }
    fields = Array.isArray(data.campos) ? data.campos : [];
    if (!fields.length) {
      showError("Este formulário ainda não possui campos publicados.");
      return;
    }
    title.textContent = data.titulo || "Formulário de inscrição";
    description.textContent = data.descricao || "Preencha os campos para enviar sua inscrição.";
    renderFields();
    loading.hidden = true;
    content.hidden = false;
  } catch (error) {
    console.error(error);
    showError("Não foi possível abrir o formulário agora. Verifique sua conexão e tente novamente.");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  submitButton.disabled = true;
  submitButton.textContent = "Enviando...";
  feedback.textContent = "Registrando sua inscrição...";
  feedback.dataset.state = "neutral";
  try {
    const formData = new FormData(form);
    const respostas = fields.map((field) => {
      const value = field.tipo === "confirmacao"
        ? (formData.has(field.id) ? "Sim" : "Não")
        : field.tipo === "multipla"
          ? formData.getAll(field.id).map((answer) => String(answer).trim()).join("; ")
          : String(formData.get(field.id) || "").trim();
      return {campoId: field.id, rotulo: field.rotulo, tipo: field.tipo, valor: value};
    });
    const missing = fields.findIndex((field, index) => field.obrigatorio === true &&
      (field.tipo === "confirmacao" ? respostas[index].valor !== "Sim"
        : field.tipo === "multipla" ? !formData.getAll(field.id).length
          : !respostas[index].valor));
    if (missing >= 0) throw new Error(`Preencha o campo obrigatório ${missing + 1}.`);
    const {db, firestoreModule} = await getFirestoreServices();
    await firestoreModule.addDoc(firestoreModule.collection(db, "respostasFormulariosInscricao"), {
      formularioId: formId,
      respostas,
      enviadoEm: firestoreModule.serverTimestamp(),
    });
    showThanks();
  } catch (error) {
    console.error(error);
    feedback.textContent = error.message || "Não foi possível enviar sua inscrição. Tente novamente.";
    feedback.dataset.state = "error";
    submitButton.disabled = false;
    submitButton.textContent = "Enviar inscrição";
  }
});

await loadForm();
