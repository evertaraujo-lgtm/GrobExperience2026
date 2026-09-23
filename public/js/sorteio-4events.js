import {getAuthServices, getFunctionsServices} from "/js/firebase-client.js";

const FIXED_EVENT_EID = "2";
const modeButtons = [...document.querySelectorAll("[data-mode]")];
const modeAlert = document.querySelector("[data-mode-alert]");
const eventForm = document.querySelector("[data-event-form]");
const eidInput = document.querySelector("[data-eid]");
const loadEventButton = document.querySelector("[data-load-event]");
const syncButton = document.querySelector("[data-sync-event]");
const categorySelect = document.querySelector("[data-category]");
const syncStatus = document.querySelector("[data-sync-status]");
const testControls = document.querySelector("[data-test-controls]");
const testSessionLabel = document.querySelector("[data-test-session]");
const newTestSessionButton = document.querySelector("[data-new-test-session]");
const testFilter = document.querySelector("[data-test-filter]");
const presenceActions = document.querySelector("[data-presence-actions]");
const markAllButton = document.querySelector("[data-mark-all]");
const clearAllButton = document.querySelector("[data-clear-all]");
const totalStat = document.querySelector("[data-stat-total]");
const presentStat = document.querySelector("[data-stat-present]");
const winnersStat = document.querySelector("[data-stat-winners]");
const eligibleStat = document.querySelector("[data-stat-eligible]");
const presenceStatLabel = document.querySelector("[data-stat-presence-label]");
const drawForm = document.querySelector("[data-draw-form]");
const prizeInput = document.querySelector("[data-prize]");
const prizeSelect = document.querySelector("[data-prize-select]");
const addPrizeButton = document.querySelector("[data-prize-add]");
const savePrizeButton = document.querySelector("[data-prize-save]");
const manifestationTimeInput = document.querySelector("[data-manifestation-time]");
const fullscreenInput = document.querySelector("[data-fullscreen]");
const drawButton = document.querySelector("[data-draw]");
const feedback = document.querySelector("[data-feedback]");
const participantsContainer = document.querySelector("[data-participants]");
const searchInput = document.querySelector("[data-search]");
const historyContainer = document.querySelector("[data-history]");
const refreshButton = document.querySelector("[data-refresh]");
const clearHistoryButton = document.querySelector("[data-clear-history]");
const stage = document.querySelector("[data-stage]");
const stageMode = document.querySelector("[data-stage-mode]");
const stageCategory = document.querySelector("[data-stage-category]");
const stagePrize = document.querySelector("[data-stage-prize]");
const stageName = document.querySelector("[data-stage-name]");
const stageDetails = document.querySelector("[data-stage-details]");
const stageStatus = document.querySelector("[data-stage-status]");
const manifestationTimer = document.querySelector("[data-manifestation-timer]");
const manifestationLabel = document.querySelector("[data-manifestation-label]");
const manifestationValue = document.querySelector("[data-manifestation-value]");
const countdown = document.querySelector("[data-countdown]");
const confetti = document.querySelector("[data-confetti]");
const stageNextPrize = document.querySelector("[data-stage-next-prize]");
const stagePrizeSelect = document.querySelector("[data-stage-prize-select]");
const stagePrizeInput = document.querySelector("[data-stage-prize-input]");
const stageNewDraw = document.querySelector("[data-stage-new]");
const stageClose = document.querySelector("[data-stage-close]");

const apiCache = new Map();
const LEGACY_PRIZE_LIST_KEY = "grob-raffle-prizes";
const LEGACY_SELECTED_PRIZE_KEY = "grob-raffle-selected-prize";
const SELECTED_PRIZE_KEY = "grob-raffle-selected-prize-id";
let savedPrizes = [];
let prizesLoaded = false;
let prizeBusy = false;
const state = {
  mode: localStorage.getItem("grob-raffle-mode") === "final" ? "final" : "teste",
  eid: FIXED_EVENT_EID,
  category: "",
  sessionId: "",
  filter: localStorage.getItem("grob-raffle-test-filter") === "presenca_simulada" ? "presenca_simulada" : "todos",
  categories: [],
  data: null,
  participants: [],
  history: [],
  requestId: 0,
  stageBusy: false,
  manifestationInterval: null,
};

function loadLegacyPrizes() {
  try {
    const stored = JSON.parse(localStorage.getItem(LEGACY_PRIZE_LIST_KEY) || "[]");
    return Array.isArray(stored)
      ? [...new Set(stored.filter((item) => typeof item === "string").map((item) => item.trim().slice(0, 120)).filter(Boolean))].slice(0, 200)
      : [];
  } catch {
    return [];
  }
}

function updatePrizeControls() {
  const selected = savedPrizes.find((item) => item.id === prizeSelect.value);
  prizeSelect.disabled = prizeBusy || !prizesLoaded;
  addPrizeButton.disabled = prizeBusy || !prizesLoaded || !prizeInput.value.trim();
  savePrizeButton.disabled = prizeBusy || !selected || !prizeInput.value.trim() || prizeInput.value.trim() === selected.nome;
  stagePrizeSelect.disabled = prizeBusy || !prizesLoaded || state.stageBusy;
  stagePrizeSelect.value = prizeSelect.value;
  stagePrizeInput.disabled = prizeBusy || state.stageBusy;
  stagePrizeInput.value = prizeInput.value;
}

function renderPrizeOptions(selectedId = "") {
  prizeSelect.replaceChildren(new Option("Selecione um brinde salvo", ""));
  stagePrizeSelect.replaceChildren(new Option("Selecione um brinde salvo", ""));
  savedPrizes.forEach((prize) => {
    prizeSelect.add(new Option(prize.nome, prize.id));
    stagePrizeSelect.add(new Option(prize.nome, prize.id));
  });
  const selected = savedPrizes.find((item) => item.id === selectedId);
  prizeSelect.value = selected?.id || "";
  if (selected) prizeInput.value = selected.nome;
  if (selected) localStorage.setItem(SELECTED_PRIZE_KEY, selected.id);
  else localStorage.removeItem(SELECTED_PRIZE_KEY);
  updatePrizeControls();
}

async function loadPrizes() {
  if (prizeBusy) return;
  prizeBusy = true;
  updatePrizeControls();
  try {
    let response = await callable("get4EventsRafflePrizes");
    let selectedId = localStorage.getItem(SELECTED_PRIZE_KEY) || "";
    const legacyPrizes = loadLegacyPrizes();
    if (legacyPrizes.length) {
      const oldSelection = localStorage.getItem(LEGACY_SELECTED_PRIZE_KEY);
      const oldName = oldSelection === null ? "" : legacyPrizes[Number(oldSelection)] || "";
      try {
        response = await callable("save4EventsRafflePrize", {acao: "importar", brindes: legacyPrizes});
        localStorage.removeItem(LEGACY_PRIZE_LIST_KEY);
        localStorage.removeItem(LEGACY_SELECTED_PRIZE_KEY);
        const migrated = response.brindes?.find((item) => item.nome.toLocaleLowerCase("pt-BR") === oldName.toLocaleLowerCase("pt-BR"));
        if (migrated) selectedId = migrated.id;
      } catch (error) {
        console.error(error);
        setFeedback(errorText(error, "Não foi possível importar os brindes deste navegador."), "error");
      }
    }
    savedPrizes = Array.isArray(response.brindes) ? response.brindes : [];
    prizesLoaded = true;
    renderPrizeOptions(selectedId);
  } catch (error) {
    console.error(error);
    setFeedback(errorText(error, "Não foi possível carregar os brindes salvos."), "error");
    if (!prizesLoaded) renderPrizeOptions();
  } finally {
    prizeBusy = false;
    updatePrizeControls();
  }
}

async function savePrize(action) {
  if (prizeBusy || !prizesLoaded) return;
  const prize = prizeInput.value.trim().slice(0, 120);
  if (!prize) {
    prizeInput.focus();
    return;
  }
  const selectedId = prizeSelect.value;
  if (action === "editar" && !selectedId) return;
  prizeBusy = true;
  updatePrizeControls();
  try {
    const result = await callable("save4EventsRafflePrize", {acao: action, nome: prize, id: selectedId});
    savedPrizes = Array.isArray(result.brindes) ? result.brindes : [];
    renderPrizeOptions(result.selecionadoId || selectedId);
    setFeedback(action === "editar" ? "Brinde atualizado no Firestore." : "Brinde salvo no Firestore.", "success");
  } catch (error) {
    console.error(error);
    setFeedback(errorText(error, "Não foi possível salvar o brinde."), "error");
  } finally {
    prizeBusy = false;
    updatePrizeControls();
  }
}

function setFeedback(message, status = "neutral") {
  feedback.textContent = message;
  feedback.dataset.state = status;
}

function errorText(error, fallback) {
  const message = typeof error?.message === "string" ? error.message.replace(/^FirebaseError:\s*/i, "") : "";
  return message || fallback;
}

function maskedEmail(value) {
  if (typeof value !== "string") return "";
  const email = value.trim();
  const at = email.indexOf("@");
  if (at < 1 || at === email.length - 1 || email.lastIndexOf("@") !== at) return "";
  const local = Array.from(email.slice(0, at));
  const visible = local.length < 3 ? 1 : 3;
  return `${local.slice(0, visible).join("")}${"*".repeat(Math.max(1, local.length - visible))}${email.slice(at)}`;
}

async function callable(name, data = {}) {
  let fn = apiCache.get(name);
  if (!fn) {
    const {functions, functionsModule} = await getFunctionsServices();
    const options = name === "sync4EventsParticipants" ? {timeout: 540000} : undefined;
    fn = functionsModule.httpsCallable(functions, name, options);
    apiCache.set(name, fn);
  }
  const response = await fn(data);
  return response.data;
}

function formatDateTime(value) {
  if (!value) return "Não registrada";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Não registrada" : date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });
}

function testSessionStorageKey() {
  return state.eid && state.category ? `grob-raffle-test-session:${state.eid}:${state.category}` : "";
}

function restoreTestSession() {
  const key = testSessionStorageKey();
  state.sessionId = key ? localStorage.getItem(key) || "" : "";
}

function saveTestSession(id) {
  const key = testSessionStorageKey();
  state.sessionId = id;
  if (key) localStorage.setItem(key, id);
}

function currentCategory() {
  return state.categories.find((item) => item.categoria === state.category) || null;
}

function renderMode() {
  modeButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode)));
  testControls.hidden = state.mode !== "teste";
  presenceStatLabel.textContent = state.mode === "teste" ? "Presentes simulados" : "Presentes na API";
  modeAlert.classList.toggle("raffle-alert-test", state.mode === "teste");
  modeAlert.classList.toggle("raffle-alert-final", state.mode === "final");
  modeAlert.querySelector("strong").textContent = state.mode === "teste" ? "MODO TESTE" : "SORTEIO FINAL";
  modeAlert.querySelector("span").textContent = state.mode === "teste"
    ? "Os resultados desta sessão não afetam o sorteio definitivo."
    : "Somente presentes da categoria correspondente ao dia atual podem participar.";
  testFilter.value = state.filter;
  presenceActions.hidden = state.mode !== "teste" || state.filter !== "presenca_simulada";
  clearHistoryButton.hidden = false;
  clearHistoryButton.textContent = state.mode === "teste" ? "Limpar testes" : "Limpar sorteio final";
  renderCategoryOptions();
}

function renderCategoryOptions() {
  const previous = state.category;
  categorySelect.replaceChildren();
  if (!state.categories.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = state.eid ? "Nenhuma categoria encontrada" : "Carregue um evento";
    categorySelect.append(option);
    categorySelect.disabled = true;
    state.category = "";
    return;
  }
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Selecione uma categoria";
  categorySelect.append(placeholder);
  const categoriesForMode = state.categories.filter((item) =>
    state.mode === "teste" || (item.visitante && item.data),
  );
  categoriesForMode.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.categoria;
    option.textContent = `${item.categoria} · ${item.total} participante(s)${item.hoje ? " · HOJE" : ""}`;
    option.disabled = state.mode === "final" && !item.hoje;
    categorySelect.append(option);
  });
  const available = categoriesForMode.filter((item) => state.mode === "teste" || item.hoje);
  const selected = available.find((item) => item.categoria === previous) || available[0];
  state.category = selected?.categoria || "";
  categorySelect.value = state.category;
  categorySelect.disabled = !available.length;
  restoreTestSession();
}

function renderSyncStatus() {
  if (!state.data) {
    syncStatus.textContent = state.eid ? "Selecione uma categoria." : "Nenhum evento carregado.";
    syncStatus.dataset.state = "neutral";
    return;
  }
  const syncAt = state.data.ultimaSincronizacaoEm;
  if (!syncAt) {
    syncStatus.textContent = "Ainda não existe sincronização registrada para este EID. Atualize pela API antes do sorteio final.";
    syncStatus.dataset.state = "warning";
    return;
  }
  syncStatus.textContent = `Última sincronização da API: ${formatDateTime(syncAt)}.${state.data.sincronizacaoHoje ? " Atualizada hoje." : " É necessário atualizar novamente no dia do sorteio final."}`;
  syncStatus.dataset.state = state.data.sincronizacaoHoje ? "success" : "warning";
}

function renderStats() {
  const totals = state.data?.totais || {};
  totalStat.textContent = String(totals.participantes || 0);
  presentStat.textContent = String(state.mode === "teste" ? totals.presencasSimuladas || 0 : totals.presentes || 0);
  winnersStat.textContent = String(totals.vencedores || 0);
  eligibleStat.textContent = String(totals.elegiveis || 0);
}

function participantSearchText(participant) {
  return [participant.nome, participant.empresa, participant.cargo, participant.qrCode, participant.id4Events]
    .join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function situation(participant) {
  if (participant.jaSorteado) return {label: "Já sorteado", className: "winner"};
  if (participant.elegivel) return {label: "Elegível", className: "eligible"};
  if (state.mode === "final" && !participant.presente) return {label: "Ausente", className: ""};
  if (state.mode === "teste" && state.filter === "presenca_simulada" && !participant.presencaSimulada) return {label: "Fora da simulação", className: ""};
  return {label: "Não elegível", className: ""};
}

function renderParticipants() {
  participantsContainer.replaceChildren();
  const term = searchInput.value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const filtered = state.participants.filter((participant) => !term || participantSearchText(participant).includes(term));
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = state.participants.length ? "Nenhum participante corresponde à busca." : "Nenhum participante nessa categoria.";
    participantsContainer.append(empty);
    return;
  }
  filtered.forEach((participant) => {
    const row = document.createElement("article");
    row.className = "raffle-participant";
    row.dataset.eligible = String(participant.elegivel);
    row.dataset.winner = String(participant.jaSorteado);

    const identity = document.createElement("div");
    identity.className = "raffle-participant-copy";
    const name = document.createElement("strong");
    name.textContent = participant.nome;
    const identifier = document.createElement("small");
    identifier.textContent = participant.qrCode || (participant.id4Events ? `ID ${participant.id4Events}` : "Sem identificador visível");
    identity.append(name, identifier);

    const professional = document.createElement("div");
    professional.className = "raffle-participant-copy";
    const company = document.createElement("span");
    company.textContent = participant.empresa || "Empresa não informada";
    const cargo = document.createElement("small");
    cargo.textContent = participant.cargo || "Cargo não informado";
    professional.append(company, cargo);

    const presence = document.createElement("label");
    presence.className = "raffle-presence-toggle";
    if (state.mode === "teste") {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = participant.presencaSimulada;
      checkbox.disabled = !state.sessionId || participant.jaSorteado;
      checkbox.setAttribute("aria-label", `Presença simulada de ${participant.nome}`);
      checkbox.addEventListener("change", () => updateSimulatedPresence([participant.participantDocumentId], checkbox.checked, checkbox));
      presence.append(checkbox, document.createTextNode(checkbox.checked ? "Simulada" : "Não marcada"));
    } else {
      presence.textContent = participant.presente ? "Presente" : "Ausente";
    }

    const status = situation(participant);
    const pill = document.createElement("span");
    pill.className = `raffle-status-pill ${status.className}`.trim();
    pill.textContent = status.label;
    row.append(identity, professional, presence, pill);
    participantsContainer.append(row);
  });
}

function renderHistory() {
  historyContainer.replaceChildren();
  if (!state.history.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = state.mode === "teste" && !state.sessionId
      ? "Crie uma sessão de teste para registrar os ensaios."
      : "Nenhum sorteio realizado neste contexto.";
    historyContainer.append(empty);
    return;
  }
  state.history.forEach((item, index) => {
    const winner = item.vencedor || {};
    const card = document.createElement("article");
    card.className = "raffle-history-item";
    const order = document.createElement("small");
    order.textContent = `#${state.history.length - index} · ${formatDateTime(item.sorteadoEm)}`;
    const name = document.createElement("strong");
    name.textContent = winner.nome || "Vencedor";
    const prize = document.createElement("span");
    prize.className = "raffle-history-prize";
    prize.textContent = item.brinde || "Brinde não informado";
    const details = document.createElement("span");
    details.textContent = `${winner.empresa || "Empresa não informada"} · ${item.quantidadeElegiveis || 0} elegível(is)`;
    card.append(order, name, prize, details);
    historyContainer.append(card);
  });
}

function updateControls() {
  const hasCategory = Boolean(state.eid && state.category);
  syncButton.disabled = !state.eid;
  refreshButton.disabled = !hasCategory;
  newTestSessionButton.disabled = state.mode !== "teste" || !hasCategory;
  markAllButton.disabled = !state.sessionId || !state.participants.length;
  clearAllButton.disabled = !state.sessionId || !state.participants.length;
  clearHistoryButton.disabled = !state.history.length || (state.mode === "teste" && !state.sessionId);
  testSessionLabel.textContent = state.sessionId
    ? `Sessão ativa · ${state.sessionId.slice(0, 8)}`
    : "Nenhuma sessão criada";
  const eligible = Number(state.data?.totais?.elegiveis || 0);
  const finalReady = state.mode === "final" && state.data?.categoriaPermitidaHoje && state.data?.sincronizacaoHoje;
  const testReady = state.mode === "teste" && Boolean(state.sessionId);
  drawButton.disabled = !hasCategory || !eligible || !(finalReady || testReady);
  stageNewDraw.disabled = state.stageBusy || drawButton.disabled || !prizeInput.value.trim();
}

function render() {
  renderMode();
  renderSyncStatus();
  renderStats();
  renderParticipants();
  renderHistory();
  updateControls();
}

async function loadEvent() {
  if (!eventForm.reportValidity()) return;
  const eid = FIXED_EVENT_EID;
  eidInput.value = FIXED_EVENT_EID;
  const requestId = ++state.requestId;
  loadEventButton.disabled = true;
  loadEventButton.textContent = "Carregando...";
  setFeedback("");
  syncStatus.textContent = "Consultando categorias do evento...";
  syncStatus.dataset.state = "neutral";
  try {
    const data = await callable("get4EventsRaffleState", {eid, modo: state.mode});
    if (requestId !== state.requestId) return;
    state.eid = eid;
    state.categories = Array.isArray(data.categorias) ? data.categorias : [];
    state.data = data;
    renderCategoryOptions();
    if (state.category) await refreshState();
    else {
      state.participants = [];
      state.history = [];
      render();
      if (state.mode === "final") setFeedback("Nenhuma categoria corresponde ao dia de hoje.", "error");
    }
  } catch (error) {
    console.error(error);
    state.categories = [];
    state.participants = [];
    state.history = [];
    state.data = null;
    render();
    setFeedback(errorText(error, "Não foi possível carregar o evento."), "error");
  } finally {
    loadEventButton.disabled = false;
    loadEventButton.textContent = "Recarregar evento";
  }
}

async function refreshState(retryWithoutSession = true) {
  if (!state.eid || !state.category) return;
  const requestId = ++state.requestId;
  refreshButton.disabled = true;
  setFeedback("Atualizando elegibilidade...");
  try {
    const data = await callable("get4EventsRaffleState", {
      eid: state.eid,
      categoria: state.category,
      modo: state.mode,
      sessaoTesteId: state.mode === "teste" ? state.sessionId : "",
      filtroTeste: state.filter,
    });
    if (requestId !== state.requestId) return;
    state.data = data;
    state.categories = Array.isArray(data.categorias) ? data.categorias : state.categories;
    state.participants = Array.isArray(data.participantes) ? data.participantes : [];
    state.history = Array.isArray(data.historico) ? data.historico : [];
    setFeedback("");
    render();
  } catch (error) {
    if (state.mode === "teste" && state.sessionId && retryWithoutSession && ["functions/not-found", "functions/failed-precondition"].includes(error?.code)) {
      saveTestSession("");
      await refreshState(false);
      return;
    }
    console.error(error);
    setFeedback(errorText(error, "Não foi possível atualizar o sorteio."), "error");
  } finally {
    refreshButton.disabled = false;
  }
}

async function synchronizeEvent() {
  if (!state.eid) return;
  syncButton.disabled = true;
  syncButton.textContent = "Sincronizando...";
  setFeedback("Consultando todos os participantes na API da 4 Events...");
  try {
    const result = await callable("sync4EventsParticipants", {eid: state.eid});
    setFeedback(`${result.imported || 0} participante(s) atualizado(s) pela API.`, "success");
    await loadEvent();
  } catch (error) {
    console.error(error);
    setFeedback(errorText(error, "Não foi possível atualizar os participantes."), "error");
  } finally {
    syncButton.disabled = false;
    syncButton.textContent = "Atualizar pela API";
  }
}

async function createTestSession() {
  if (!state.eid || !state.category) return;
  if (state.sessionId && !window.confirm("Iniciar uma nova sessão de teste? A sessão atual continuará preservada no histórico, mas os vencedores serão zerados na nova sessão.")) return;
  newTestSessionButton.disabled = true;
  newTestSessionButton.textContent = "Criando...";
  try {
    const result = await callable("create4EventsRaffleTestSession", {eid: state.eid, categoria: state.category});
    saveTestSession(result.sessaoTesteId);
    setFeedback("Nova sessão de teste criada. Os vencedores começam zerados.", "success");
    await refreshState();
  } catch (error) {
    console.error(error);
    setFeedback(errorText(error, "Não foi possível criar a sessão de teste."), "error");
  } finally {
    newTestSessionButton.disabled = false;
    newTestSessionButton.textContent = "Nova sessão";
  }
}

async function clearTestHistory() {
  if (state.mode !== "teste" || !state.sessionId || !state.history.length) return;
  const confirmed = window.confirm(
    "Limpar o histórico desta sessão de teste? Os vencedores voltarão a participar. A presença simulada será mantida e os sorteios finais não serão afetados.",
  );
  if (!confirmed) return;
  clearHistoryButton.disabled = true;
  clearHistoryButton.textContent = "Limpando...";
  try {
    const result = await callable("clear4EventsRaffleTestHistory", {
      eid: state.eid,
      categoria: state.category,
      sessaoTesteId: state.sessionId,
    });
    const removed = Number(result.resultadosRemovidos || 0);
    setFeedback(`${removed} resultado(s) de teste removido(s). Os participantes estão elegíveis novamente.`, "success");
    await refreshState();
  } catch (error) {
    console.error(error);
    setFeedback(errorText(error, "Não foi possível limpar o histórico de testes."), "error");
  } finally {
    clearHistoryButton.textContent = "Limpar testes";
    updateControls();
  }
}

async function clearFinalHistory() {
  if (state.mode !== "final" || !state.category || !state.history.length) return;
  const confirmed = window.confirm(
    `Limpar todo o histórico FINAL da categoria “${state.category}”? Os vencedores voltarão a ficar elegíveis. A presença e os participantes da API serão mantidos.`,
  );
  if (!confirmed) return;
  clearHistoryButton.disabled = true;
  clearHistoryButton.textContent = "Limpando...";
  try {
    const result = await callable("clear4EventsRaffleFinalHistory", {
      eid: state.eid,
      categoria: state.category,
    });
    const removed = Number(result.resultadosRemovidos || 0);
    const released = Number(result.vencedoresLiberados || 0);
    setFeedback(`${removed} resultado(s) final(is) removido(s) e ${released} participante(s) novamente elegível(is).`, "success");
    await refreshState();
  } catch (error) {
    console.error(error);
    setFeedback(errorText(error, "Não foi possível limpar o histórico do sorteio final."), "error");
  } finally {
    clearHistoryButton.textContent = "Limpar sorteio final";
    updateControls();
  }
}

function clearCurrentHistory() {
  return state.mode === "teste" ? clearTestHistory() : clearFinalHistory();
}

async function updateSimulatedPresence(participantIds, present, control = null) {
  if (!state.sessionId || !participantIds.length) return;
  if (control) control.disabled = true;
  try {
    for (let index = 0; index < participantIds.length; index += 350) {
      await callable("set4EventsRaffleTestPresence", {
        eid: state.eid,
        categoria: state.category,
        sessaoTesteId: state.sessionId,
        participanteIds: participantIds.slice(index, index + 350),
        presente: present,
      });
    }
    setFeedback(`${participantIds.length} presença(s) simulada(s) atualizada(s).`, "success");
    await refreshState();
  } catch (error) {
    console.error(error);
    setFeedback(errorText(error, "Não foi possível atualizar a presença simulada."), "error");
    if (control) control.disabled = false;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function openStage() {
  if (stage.open) return;
  try {
    // Keep the presentation in the document instead of the dialog top layer.
    // Edge can place a modal dialog behind a fullscreen document on later draws.
    if (typeof stage.show === "function") stage.show();
    else stage.setAttribute("open", "");
  } catch (error) {
    console.warn("Não foi possível abrir a apresentação.", error);
    stage.setAttribute("open", "");
  }
  stage.classList.add("raffle-stage-fallback-open");
}

async function requestStageFullscreen() {
  if (!fullscreenInput.checked || document.fullscreenElement) return;
  const target = document.documentElement;
  const request = target.requestFullscreen || target.webkitRequestFullscreen || target.msRequestFullscreen;
  if (typeof request !== "function") return;
  try {
    await request.call(target);
  } catch (error) {
    console.warn("Tela cheia não disponível.", error);
  }
}

function manifestationSeconds() {
  const supplied = Math.trunc(Number(manifestationTimeInput.value));
  const seconds = Number.isFinite(supplied) ? Math.min(600, Math.max(0, supplied)) : 30;
  manifestationTimeInput.value = String(seconds);
  localStorage.setItem("grob-raffle-manifestation-seconds", String(seconds));
  return seconds;
}

function timerText(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function stopManifestationTimer(hide = true) {
  if (state.manifestationInterval) window.clearInterval(state.manifestationInterval);
  state.manifestationInterval = null;
  if (hide) manifestationTimer.hidden = true;
  manifestationTimer.dataset.state = "";
}

function startManifestationTimer(seconds) {
  stopManifestationTimer();
  if (!seconds) return;
  let remaining = seconds;
  manifestationTimer.hidden = false;
  manifestationTimer.dataset.state = "running";
  manifestationLabel.textContent = "Aguardando o vencedor se manifestar";
  manifestationValue.textContent = timerText(remaining);
  state.manifestationInterval = window.setInterval(() => {
    remaining -= 1;
    manifestationValue.textContent = timerText(Math.max(remaining, 0));
    if (remaining > 0) return;
    stopManifestationTimer(false);
    manifestationTimer.dataset.state = "ended";
    manifestationLabel.textContent = "Tempo de manifestação encerrado";
  }, 1000);
}

function randomVisualIndex(length, previousIndex = -1) {
  if (length <= 1) return 0;
  let index = previousIndex;
  while (index === previousIndex) {
    if (globalThis.crypto?.getRandomValues) {
      const value = new Uint32Array(1);
      globalThis.crypto.getRandomValues(value);
      index = value[0] % length;
    } else {
      index = Math.floor(Math.random() * length);
    }
  }
  return index;
}

async function showCountdown() {
  stopManifestationTimer();
  stage.dataset.phase = "countdown";
  stageName.textContent = "";
  stageDetails.textContent = "";
  for (const value of ["3", "2", "1"]) {
    countdown.textContent = value;
    countdown.classList.remove("active");
    void countdown.offsetWidth;
    countdown.classList.add("active");
    await wait(780);
  }
  countdown.classList.remove("active");
  countdown.textContent = "";
}

function createConfetti() {
  confetti.replaceChildren();
  const colors = ["#70dfff", "#ffffff", "#76efb4", "#ffc65f", "#348fe5"];
  for (let index = 0; index < 90; index += 1) {
    const particle = document.createElement("i");
    particle.style.setProperty("--x", `${Math.random() * 100}%`);
    particle.style.setProperty("--w", `${5 + Math.random() * 8}px`);
    particle.style.setProperty("--color", colors[index % colors.length]);
    particle.style.setProperty("--rotate", `${Math.random() * 180}deg`);
    particle.style.setProperty("--duration", `${2.6 + Math.random() * 2.8}s`);
    particle.style.setProperty("--delay", `${Math.random() * .8}s`);
    particle.style.setProperty("--drift", `${-90 + Math.random() * 180}px`);
    confetti.append(particle);
  }
}

async function revealWinner(result, drawnPrize) {
  const winner = result.vencedor || {};
  const names = state.participants.filter((participant) => participant.elegivel).map((participant) => participant.nome);
  if (!names.length) names.push(winner.nome || "Participante");
  await showCountdown();
  stage.dataset.phase = "spinning";
  stageStatus.textContent = "Sorteando entre os participantes elegíveis";
  let visualIndex = -1;
  for (let index = 0; index < 22; index += 1) {
    visualIndex = randomVisualIndex(names.length, visualIndex);
    stageName.textContent = names[visualIndex];
    const progress = index / 21;
    await wait(38 + Math.round(progress * progress * 105));
  }
  stage.dataset.phase = "winner";
  stageName.textContent = winner.nome || "Vencedor";
  stageDetails.textContent = [winner.empresa, winner.cargo].filter(Boolean).join(" · ");
  const emailText = maskedEmail(winner.email);
  if (emailText) {
    const email = document.createElement("small");
    email.textContent = emailText;
    stageDetails.append(email);
  }
  stageStatus.textContent = `Vencedor do brinde ${drawnPrize}`;
  createConfetti();
  stageNewDraw.hidden = false;
  stageClose.hidden = false;
}

async function executeDraw(event) {
  event.preventDefault();
  if (state.stageBusy || !drawForm.reportValidity() || drawButton.disabled) return;
  const drawnPrize = prizeInput.value.trim();
  if (!drawnPrize) return;
  if (state.mode === "final" && !window.confirm(`Confirmar o sorteio FINAL do brinde “${drawnPrize}” para a categoria selecionada? O vencedor sairá dos próximos sorteios dessa categoria.`)) return;

  stopManifestationTimer();
  stage.dataset.mode = state.mode;
  stage.dataset.phase = "loading";
  stageMode.textContent = state.mode === "teste" ? "MODO TESTE" : "SORTEIO FINAL";
  stageCategory.textContent = state.category;
  stagePrize.textContent = drawnPrize;
  stageName.textContent = "Validando elegíveis";
  stageDetails.textContent = "";
  stageStatus.textContent = "O resultado será definido e registrado no servidor";
  stageNewDraw.hidden = true;
  stageNewDraw.disabled = true;
  stageClose.hidden = true;
  stageNextPrize.hidden = true;
  confetti.replaceChildren();
  state.stageBusy = true;
  updatePrizeControls();

  // Fullscreen must enter before the dialog. In Edge, entering it afterwards
  // puts the document above the dialog in the browser's top layer.
  await requestStageFullscreen();
  openStage();

  drawButton.disabled = true;
  try {
    const result = await callable("draw4EventsRaffle", {
      modo: state.mode,
      eid: state.eid,
      categoria: state.category,
      sessaoTesteId: state.mode === "teste" ? state.sessionId : "",
      filtroTeste: state.filter,
      brinde: drawnPrize,
    });
    await revealWinner(result, drawnPrize);
    startManifestationTimer(manifestationSeconds());
    setFeedback(`${result.vencedor?.nome || "Participante"} venceu o sorteio de ${drawnPrize}.`, "success");
    await refreshState();
  } catch (error) {
    console.error(error);
    stage.dataset.phase = "error";
    stageName.textContent = "Sorteio não realizado";
    stageDetails.textContent = errorText(error, "Não foi possível realizar o sorteio.");
    stageStatus.textContent = "Nenhum vencedor foi registrado";
    stageNewDraw.hidden = false;
    stageClose.hidden = false;
    setFeedback(errorText(error, "Não foi possível realizar o sorteio."), "error");
  } finally {
    state.stageBusy = false;
    stageNextPrize.hidden = false;
    updatePrizeControls();
    updateControls();
  }
}

async function closeStage() {
  if (state.stageBusy) return;
  stopManifestationTimer();
  if (document.fullscreenElement) {
    try { await document.exitFullscreen(); } catch (error) { console.warn(error); }
  }
  if (typeof stage.close === "function") stage.close();
  else stage.removeAttribute("open");
  stage.classList.remove("raffle-stage-fallback-open");
  stageNextPrize.hidden = true;
  confetti.replaceChildren();
}

modeButtons.forEach((button) => button.addEventListener("click", async () => {
  const mode = button.dataset.mode;
  if (mode === state.mode) return;
  state.mode = mode;
  localStorage.setItem("grob-raffle-mode", mode);
  state.data = null;
  state.participants = [];
  state.history = [];
  renderMode();
  renderCategoryOptions();
  if (state.category) await refreshState();
  else render();
}));

eventForm.addEventListener("submit", (event) => { event.preventDefault(); loadEvent(); });
syncButton.addEventListener("click", synchronizeEvent);
categorySelect.addEventListener("change", async () => {
  state.category = categorySelect.value;
  restoreTestSession();
  await refreshState();
});
testFilter.addEventListener("change", async () => {
  state.filter = testFilter.value === "presenca_simulada" ? "presenca_simulada" : "todos";
  localStorage.setItem("grob-raffle-test-filter", state.filter);
  await refreshState();
});
newTestSessionButton.addEventListener("click", createTestSession);
clearHistoryButton.addEventListener("click", clearCurrentHistory);
markAllButton.addEventListener("click", () => updateSimulatedPresence(state.participants.filter((item) => !item.jaSorteado).map((item) => item.participantDocumentId), true, markAllButton));
clearAllButton.addEventListener("click", () => updateSimulatedPresence(state.participants.filter((item) => !item.jaSorteado).map((item) => item.participantDocumentId), false, clearAllButton));
refreshButton.addEventListener("click", () => refreshState());
searchInput.addEventListener("input", renderParticipants);
drawForm.addEventListener("submit", executeDraw);
prizeSelect.addEventListener("change", () => {
  renderPrizeOptions(prizeSelect.value);
});
prizeInput.addEventListener("input", () => { updatePrizeControls(); updateControls(); });
addPrizeButton.addEventListener("click", () => savePrize("adicionar"));
savePrizeButton.addEventListener("click", () => savePrize("editar"));
stagePrizeSelect.addEventListener("change", () => {
  renderPrizeOptions(stagePrizeSelect.value);
  updateControls();
});
stagePrizeInput.addEventListener("input", () => {
  prizeInput.value = stagePrizeInput.value;
  const selected = savedPrizes.find((item) => item.id === prizeSelect.value);
  if (selected && stagePrizeInput.value.trim() !== selected.nome) {
    prizeSelect.value = "";
    stagePrizeSelect.value = "";
    localStorage.removeItem(SELECTED_PRIZE_KEY);
  }
  updatePrizeControls();
  updateControls();
});
stageNewDraw.addEventListener("click", () => {
  if (typeof drawForm.requestSubmit === "function") drawForm.requestSubmit();
  else drawButton.click();
});
stageClose.addEventListener("click", closeStage);
stage.addEventListener("cancel", (event) => {
  if (state.stageBusy) event.preventDefault();
  else stopManifestationTimer();
});

eidInput.value = FIXED_EVENT_EID;
updatePrizeControls();
testFilter.value = state.filter;
manifestationTimeInput.value = localStorage.getItem("grob-raffle-manifestation-seconds") || "30";
manifestationTimeInput.addEventListener("change", manifestationSeconds);
render();
const {auth, authModule} = await getAuthServices();
await new Promise((resolve) => {
  const unsubscribe = authModule.onAuthStateChanged(auth, (user) => {
    if (!user) return;
    unsubscribe();
    resolve();
  });
});
window.addEventListener("focus", () => {
  if (!stage.open && !prizeBusy && !state.stageBusy && document.activeElement !== prizeInput && savePrizeButton.disabled) loadPrizes();
});
loadPrizes();
loadEvent();
