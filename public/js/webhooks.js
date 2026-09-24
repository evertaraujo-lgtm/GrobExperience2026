import {getAuthServices, getFirestoreServices} from "/js/firebase-client.js";

const list = document.querySelector("[data-list]");
const total = document.querySelector("[data-total]");
const feedback = document.querySelector("[data-feedback]");
const reload = document.querySelector("[data-reload]");
const typeFilter = document.querySelector("[data-type-filter]");
const loadMore = document.querySelector("[data-load-more]");
const pageSize = 100;
const sources = [
  {id: "gerais", collection: "whatsappEventos"},
  {id: "campanhas", collection: "campanhasWhatsappEventos"},
  {id: "lembretes", collection: "lembretePresencaEventos"},
];
let sourceStates = [];
let loadedCount = 0;
let hasMore = false;
let isLoading = false;
let pendingReset = false;
let currentUserId = "";
let canMarkResponded = false;
const participantCache = new Map();

function setFeedback(message, state = "neutral") {
  feedback.textContent = message;
  feedback.dataset.state = state;
}

function formatDate(value) {
  if (!value) return "Horário não informado";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime())
    ? "Horário não informado"
    : new Intl.DateTimeFormat("pt-BR", {dateStyle: "medium", timeStyle: "medium"}).format(date);
}

function statusLabel(value) {
  return ({enviado: "Enviado", entregue: "Entregue", lido: "Lido", falhou: "Falhou", apagado: "Apagado"})[value] || value || "Mensagem recebida";
}

function participantPath(event) {
  if (event.source === "campanhas") {
    if (event.campanhaId && event.participanteId) return ["campanhasWhatsapp", event.campanhaId, "destinatarios", event.participanteId];
    if (event.messageId) return ["campanhasWhatsappMensagens", event.messageId];
    return null;
  }
  if (event.source === "lembretes") {
    if (event.participanteId) return ["lembretePresencaParticipantes", event.participanteId];
    if (event.messageId) return ["lembretePresencaMensagens", event.messageId];
    return null;
  }
  const id = typeof event.preInscritoId === "string" ? event.preInscritoId : "";
  if (id) return ["preInscritos", id];
  let phone = typeof event.whatsapp === "string" ? event.whatsapp.replace(/\D/g, "") : "";
  if (phone.startsWith("55") && [12, 13].includes(phone.length)) phone = phone.slice(2);
  return phone ? ["preInscritos", phone] : null;
}

async function loadParticipantContacts(events, db, firestore) {
  const missing = new Map();
  for (const event of events) {
    const path = participantPath(event);
    if (path && !participantCache.has(path.join("/"))) missing.set(path.join("/"), path);
  }
  await Promise.all([...missing].map(async ([key, path]) => {
    try {
      const participant = await firestore.getDoc(firestore.doc(db, ...path));
      const data = participant.data();
      participantCache.set(key, participant.exists() ? {
        nome: typeof data?.nome === "string" ? data.nome : "",
        whatsapp: typeof data?.whatsapp === "string" ? data.whatsapp : "",
      } : null);
    } catch (error) {
      console.warn("Não foi possível buscar o contato do evento.", error);
      participantCache.set(key, null);
    }
  }));
}

function sourceLabel(event) {
  if (event.source === "campanhas") {
    const name = event.campanhaId === "participacao-chegando" ? "Participação chegando" : event.campanhaId;
    return name ? `Campanha: ${name}` : "Campanha";
  }
  return event.source === "lembretes" ? "Lembrete de presença" : "Eventos gerais";
}

function eventElement(event, firestore) {
  const row = document.createElement("article");
  row.className = "webhook-event";
  row.dataset.type = event.tipo || "mensagem";
  row.dataset.source = event.source;
  const title = event.tipo === "status"
    ? statusLabel(event.status)
    : event.tipo === "envio"
      ? "Disparo pela API"
      : "Mensagem recebida";
  const path = participantPath(event);
  const contact = path ? participantCache.get(path.join("/")) : null;
  const contactName = event.nome || contact?.nome || "Contato não associado";
  const contactPhone = event.whatsapp || contact?.whatsapp || "Número não informado";
  row.innerHTML = `
    <div class="event-summary"><strong></strong><span class="event-origin"></span><span class="event-time"></span></div>
    <div class="event-contact"><span>Contato</span><strong class="event-name"></strong><span class="event-phone"></span></div>
    <div><span>ID da mensagem</span><code class="event-id"></code></div>
    <div class="event-detail"></div>`;
  row.querySelector(".event-summary strong").textContent = title;
  row.querySelector(".event-origin").textContent = sourceLabel(event);
  row.querySelector(".event-time").textContent = formatDate(event.ocorridoEm || event.registradoEm);
  row.querySelector(".event-name").textContent = contactName;
  row.querySelector(".event-phone").textContent = contactPhone;
  row.querySelector(".event-id").textContent = event.messageId || "—";
  const sender = event.enviadoPorNome || event.enviadoPorEmail;
  row.querySelector(".event-detail").textContent = event.erroMensagem || event.resposta || event.texto
    || (sender ? `Enviado por ${sender}` : "Sem detalhes adicionais");
  if (event.source === "gerais") {
    const response = document.createElement("label");
    response.className = "event-response";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = event.respondido === true;
    checkbox.disabled = !canMarkResponded;
    checkbox.setAttribute("aria-label", `Marcar ${contactName} como respondido`);
    checkbox.title = canMarkResponded ? "Marcar como respondido" : "Apenas administradores podem alterar este status";
    const label = document.createElement("span");
    label.textContent = "Respondido";
    response.append(checkbox, label);
    checkbox.addEventListener("change", async () => {
      const responded = checkbox.checked;
      checkbox.disabled = true;
      try {
        await firestore.updateDoc(event.reference, {
          respondido: responded,
          respondidoEm: responded ? firestore.serverTimestamp() : firestore.deleteField(),
          respondidoPorUid: responded ? currentUserId : firestore.deleteField(),
        });
        event.respondido = responded;
        setFeedback(responded ? "Evento marcado como respondido." : "Evento marcado como pendente.", "success");
      } catch (error) {
        console.error(error);
        checkbox.checked = !responded;
        setFeedback("Não foi possível atualizar o status do evento.", "error");
      } finally {
        checkbox.disabled = !canMarkResponded;
      }
    });
    row.append(response);
  }
  return row;
}

function configuredSources() {
  const filter = typeFilter.value;
  const visible = filter === "todos"
    ? sources.filter((source) => source.id === "gerais" || canMarkResponded)
    : sources.filter((source) => source.id === (filter === "mensagens" ? "gerais" : filter)
      && (source.id === "gerais" || canMarkResponded));
  return visible.map((source) => ({...source, messagesOnly: filter === "mensagens", cursor: null, buffer: [], exhausted: false}));
}

function eventTime(event) {
  const value = event.registradoEm;
  if (typeof value?.toMillis === "function") return value.toMillis();
  const milliseconds = new Date(value).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : 0;
}

async function fillSource(source, db, firestore) {
  const next = {...source, buffer: [...source.buffer]};
  while (next.buffer.length < pageSize && !next.exhausted) {
    const constraints = [];
    if (next.messagesOnly) constraints.push(firestore.where("tipo", "==", "mensagem"));
    constraints.push(firestore.orderBy("registradoEm", "desc"));
    if (next.cursor) constraints.push(firestore.startAfter(next.cursor));
    constraints.push(firestore.limit(pageSize));
    const query = firestore.query(firestore.collection(db, next.collection), ...constraints);
    const snapshot = await firestore.getDocs(query);
    next.buffer.push(...snapshot.docs.map((document) => ({
      reference: document.ref,
      ...document.data(),
      documentId: document.id,
      source: next.id,
    })));
    next.cursor = snapshot.docs.at(-1) || next.cursor;
    next.exhausted = snapshot.size < pageSize;
  }
  return next;
}

async function loadEvents(reset = true) {
  if (isLoading) {
    if (reset) pendingReset = true;
    return;
  }
  if (!reset && !hasMore) return;
  isLoading = true;
  if (reset) {
    list.replaceChildren();
    sourceStates = configuredSources();
    loadedCount = 0;
    hasMore = false;
    loadMore.hidden = true;
    total.textContent = "Carregando...";
  } else {
    loadMore.disabled = true;
    loadMore.textContent = "Carregando...";
  }
  feedback.textContent = "";
  feedback.dataset.state = "";
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const showingReceivedMessages = typeFilter.value === "mensagens";
    sourceStates = await Promise.all(sourceStates.map((source) => fillSource(source, db, firestoreModule)));
    const merged = sourceStates.flatMap((source) => source.buffer)
      .sort((left, right) => eventTime(right) - eventTime(left) ||
        left.source.localeCompare(right.source) || left.documentId.localeCompare(right.documentId));
    const events = merged.slice(0, pageSize);
    const consumed = new Set(events.map((event) => `${event.source}:${event.documentId}`));
    sourceStates = sourceStates.map((source) => ({...source,
      buffer: source.buffer.filter((event) => !consumed.has(`${event.source}:${event.documentId}`)),
    }));
    const itemLabel = showingReceivedMessages ? "mensagem recebida" : "evento";
    if (!events.length) {
      hasMore = false;
      loadMore.hidden = true;
      if (reset) list.innerHTML = `<p class="empty-state">Nenhuma ${showingReceivedMessages ? "mensagem recebida" : "evento"} desde a ativação desta página.</p>`;
      return;
    }
    await loadParticipantContacts(events, db, firestoreModule);
    events.forEach((event) => list.append(eventElement(event, firestoreModule)));
    loadedCount += events.length;
    hasMore = sourceStates.some((source) => source.buffer.length || !source.exhausted);
    const loadedLabel = showingReceivedMessages
      ? `carregad${loadedCount === 1 ? "a" : "as"}`
      : `carregad${loadedCount === 1 ? "o" : "os"}`;
    total.textContent = `${loadedCount} ${itemLabel}${loadedCount === 1 ? "" : "s"} ${loadedLabel}`;
    loadMore.hidden = !hasMore;
  } catch (error) {
    console.error(error);
    if (reset) total.textContent = "Erro ao carregar";
    feedback.textContent = "Não foi possível carregar os eventos. Verifique sua conexão e suas permissões.";
    feedback.dataset.state = "error";
  } finally {
    isLoading = false;
    loadMore.disabled = false;
    loadMore.textContent = "Carregar mais";
    if (pendingReset) {
      pendingReset = false;
      void loadEvents(true);
    }
  }
}

const {auth, authModule} = await getAuthServices();
authModule.onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  currentUserId = user.uid;
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const profile = await firestoreModule.getDoc(firestoreModule.doc(db, "users", user.uid));
    canMarkResponded = profile.exists() && profile.data()?.active !== false && profile.data()?.roles?.admin === true;
  } catch (error) {
    console.warn("Não foi possível verificar a permissão para marcar eventos.", error);
  }
  for (const option of typeFilter.options) {
    if (option.value === "campanhas" || option.value === "lembretes") option.disabled = !canMarkResponded;
  }
  loadEvents();
});
reload.addEventListener("click", loadEvents);
typeFilter.addEventListener("change", loadEvents);
loadMore.addEventListener("click", () => loadEvents(false));
