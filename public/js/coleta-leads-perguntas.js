import {getAuthServices, getFirestoreServices} from "/js/firebase-client.js";

const feedback = document.querySelector("[data-admin-feedback]");
const topicForm = document.querySelector("[data-topic-form]");
const topicSave = document.querySelector("[data-topic-save]");
const topicsList = document.querySelector("[data-topics-list]");
const topicsTotal = document.querySelector("[data-topics-total]");
const fieldForm = document.querySelector("[data-field-form]");
const fieldSave = document.querySelector("[data-field-save]");
const fieldCancel = document.querySelector("[data-field-cancel]");
const fieldType = fieldForm.elements.tipo;
const fieldTopic = document.querySelector("[data-field-topic]");
const fieldOptions = document.querySelector("[data-field-options]");
const checkboxBehavior = document.querySelector("[data-checkbox-behavior]");
const dependentQuestions = document.querySelector("[data-dependent-questions]");
const fieldsList = document.querySelector("[data-fields-list]");
const fieldsTotal = document.querySelector("[data-fields-total]");

const FIELD_TYPES = ["texto", "texto-longo", "numero", "selecao", "multipla-escolha", "checkbox"];
const LEGACY_TOPIC_ID = "topico_geral";

let configuredTopics = [];
let configuredFields = [];
let isAdmin = false;
let editingFieldId = "";

function setFeedback(message, state = "neutral") {
  feedback.textContent = message;
  feedback.dataset.state = state;
}

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
    return id && titulo ? [{id, titulo}] : [];
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

function fieldTypeLabel(type) {
  return {
    texto: "Texto curto",
    "texto-longo": "Texto longo",
    numero: "Número",
    selecao: "Lista de seleção",
    "multipla-escolha": "Múltipla escolha",
    checkbox: "Checkbox",
  }[type] || "Pergunta";
}

function renderTopics() {
  const selectedTopicId = fieldTopic.value;
  topicsTotal.textContent = `${configuredTopics.length} cadastrado(s)`;
  topicsList.replaceChildren();
  fieldTopic.replaceChildren(new Option(configuredTopics.length ? "Selecione o tópico" : "Crie um tópico primeiro", ""));
  configuredTopics.forEach((topic) => fieldTopic.add(new Option(topic.titulo, topic.id)));
  if (configuredTopics.some((topic) => topic.id === selectedTopicId)) fieldTopic.value = selectedTopicId;
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
        await saveQuestionnaire();
        if (editingFieldId && configuredFields.every((field) => field.id !== editingFieldId)) resetFieldForm();
        setFeedback("Tópico removido.", "success");
      } catch (error) {
        console.error(error);
        configuredTopics = previousTopics;
        configuredFields = previousFields;
        renderQuestionnaire();
        setFeedback("Não foi possível remover o tópico.", "error");
      }
    });
    actions.append(remove);
    card.append(title, details, actions);
    topicsList.append(card);
  });
}

function renderQuestionnaire() {
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
      const edit = document.createElement("button");
      edit.className = "back-link";
      edit.type = "button";
      edit.textContent = "Editar";
      edit.addEventListener("click", () => startFieldEditing(field));
      const remove = document.createElement("button");
      remove.className = "danger-delete";
      remove.type = "button";
      remove.textContent = "Remover";
      remove.addEventListener("click", async () => {
        if (!window.confirm(`Remover a pergunta “${field.rotulo}”? As respostas já registradas serão preservadas.`)) return;
        const previousFields = configuredFields;
        configuredFields = configuredFields.filter((item) => item.id !== field.id && item.dependeDe !== field.id);
        try {
          await saveQuestionnaire();
          if (editingFieldId === field.id) resetFieldForm();
          setFeedback("Pergunta removida.", "success");
        } catch (error) {
          console.error(error);
          configuredFields = previousFields;
          renderQuestionnaire();
          setFeedback("Não foi possível remover a pergunta.", "error");
        }
      });
      actions.append(edit, remove);
      card.append(actions);
      group.append(card);
    });
    fieldsList.append(group);
  });
}

async function saveQuestionnaire() {
  const {db, firestoreModule} = await getFirestoreServices();
  await firestoreModule.setDoc(firestoreModule.doc(db, "coletaLeadsConfiguracoes", "campos"), {
    topicos: configuredTopics,
    campos: configuredFields,
    atualizadoEm: firestoreModule.serverTimestamp(),
  }, {merge: true});
  renderQuestionnaire();
}

async function loadQuestionnaire() {
  setFeedback("Carregando perguntas...");
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const snapshot = await firestoreModule.getDoc(firestoreModule.doc(db, "coletaLeadsConfiguracoes", "campos"));
    setQuestionnaire(snapshot.data()?.topicos, snapshot.data()?.campos);
    renderQuestionnaire();
    setFeedback("");
  } catch (error) {
    console.error(error);
    setFeedback("Não foi possível carregar as perguntas da coleta.", "error");
  }
}

function updateFieldFormVisibility() {
  const hasOptions = fieldType.value === "selecao" || fieldType.value === "multipla-escolha";
  const isCheckbox = fieldType.value === "checkbox";
  fieldOptions.hidden = !hasOptions;
  fieldForm.elements.opcoes.required = hasOptions;
  checkboxBehavior.hidden = !isCheckbox;
  if (!isCheckbox) fieldForm.elements.abreDependentes.checked = false;
  dependentQuestions.hidden = !isCheckbox || !fieldForm.elements.abreDependentes.checked;
  fieldForm.elements.perguntasDependentes.required = isCheckbox && fieldForm.elements.abreDependentes.checked;
}

function resetFieldForm() {
  editingFieldId = "";
  fieldForm.reset();
  fieldSave.textContent = "Adicionar pergunta";
  fieldCancel.hidden = true;
  updateFieldFormVisibility();
}

function startFieldEditing(field) {
  editingFieldId = field.id;
  const children = configuredFields.filter((item) => item.dependeDe === field.id);
  fieldForm.elements.topicoId.value = field.topicoId;
  fieldForm.elements.rotulo.value = field.rotulo;
  fieldForm.elements.tipo.value = field.tipo;
  fieldForm.elements.opcoes.value = field.opcoes.join("\n");
  fieldForm.elements.obrigatorio.checked = field.obrigatorio;
  fieldForm.elements.abreDependentes.checked = field.tipo === "checkbox" && children.length > 0;
  fieldForm.elements.perguntasDependentes.value = children.map((item) => item.rotulo).join("\n");
  fieldSave.textContent = "Salvar alterações";
  fieldCancel.hidden = false;
  updateFieldFormVisibility();
  fieldForm.scrollIntoView({behavior: "smooth", block: "start"});
  fieldForm.elements.rotulo.focus({preventScroll: true});
  setFeedback(`Editando “${field.rotulo}”.`);
}

fieldType.addEventListener("change", updateFieldFormVisibility);
fieldForm.elements.abreDependentes.addEventListener("change", updateFieldFormVisibility);
fieldCancel.addEventListener("click", () => {
  resetFieldForm();
  setFeedback("Edição cancelada.");
});

topicForm.addEventListener("submit", async (event) => {
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
    await saveQuestionnaire();
    topicForm.reset();
    setFeedback("Tópico adicionado.", "success");
  } catch (error) {
    console.error(error);
    configuredTopics = previousTopics;
    renderQuestionnaire();
    setFeedback("Não foi possível adicionar o tópico.", "error");
  } finally {
    topicSave.disabled = false;
  }
});

fieldForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isAdmin || !fieldForm.reportValidity()) return;
  const form = new FormData(fieldForm);
  const tipo = String(form.get("tipo"));
  const acceptsOptions = tipo === "selecao" || tipo === "multipla-escolha";
  const opcoes = acceptsOptions
    ? String(form.get("opcoes") || "").split("\n").map((option) => option.trim()).filter(Boolean)
    : [];
  const topicoId = String(form.get("topicoId") || "");
  if (!configuredTopics.some((topic) => topic.id === topicoId)) {
    setFeedback("Selecione um tópico válido.", "error");
    return;
  }
  if (acceptsOptions && !opcoes.length) {
    setFeedback("Informe ao menos uma opção para essa pergunta.", "error");
    return;
  }
  const opensDependents = tipo === "checkbox" && form.get("abreDependentes") === "on";
  const dependentLabels = opensDependents
    ? String(form.get("perguntasDependentes") || "").split("\n").map((label) => label.trim()).filter(Boolean)
    : [];
  if (opensDependents && !dependentLabels.length) {
    setFeedback("Informe ao menos uma pergunta dependente.", "error");
    return;
  }
  fieldSave.disabled = true;
  const previousFields = configuredFields;
  const fieldBeingEdited = configuredFields.find((field) => field.id === editingFieldId && !field.dependeDe);
  try {
    const fieldId = fieldBeingEdited?.id || `campo_${crypto.randomUUID().replaceAll("-", "")}`;
    const updatedField = {
      id: fieldId,
      rotulo: String(form.get("rotulo") || "").trim(),
      tipo,
      obrigatorio: form.get("obrigatorio") === "on",
      opcoes,
      topicoId,
      dependeDe: "",
    };
    const currentDependents = fieldBeingEdited
      ? configuredFields.filter((field) => field.dependeDe === fieldId)
      : [];
    const updatedDependents = dependentLabels.map((rotulo, index) => ({
      id: currentDependents[index]?.id || `campo_${crypto.randomUUID().replaceAll("-", "")}`,
      rotulo,
      tipo: "texto",
      obrigatorio: false,
      opcoes: [],
      topicoId,
      dependeDe: fieldId,
    }));
    if (fieldBeingEdited) {
      configuredFields = configuredFields.flatMap((field) => {
        if (field.id === fieldId) return [updatedField, ...updatedDependents];
        if (field.dependeDe === fieldId) return [];
        return [field];
      });
    } else {
      configuredFields = [...configuredFields, updatedField, ...updatedDependents];
    }
    await saveQuestionnaire();
    const successMessage = fieldBeingEdited ? "Pergunta atualizada." : "Pergunta adicionada.";
    resetFieldForm();
    setFeedback(successMessage, "success");
  } catch (error) {
    console.error(error);
    configuredFields = previousFields;
    renderQuestionnaire();
    setFeedback(fieldBeingEdited ? "Não foi possível atualizar a pergunta." : "Não foi possível adicionar a pergunta.", "error");
  } finally {
    fieldSave.disabled = !configuredTopics.length;
  }
});

const {auth, authModule} = await getAuthServices();
authModule.onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const {db, firestoreModule} = await getFirestoreServices();
  const profile = await firestoreModule.getDoc(firestoreModule.doc(db, "users", user.uid));
  isAdmin = profile.exists() && profile.data().active !== false && profile.data().roles?.admin === true;
  if (!isAdmin) {
    window.location.replace("/coleta-leads/");
    return;
  }
  await loadQuestionnaire();
});
