import {getAuthServices, getFirestoreServices} from "/js/firebase-client.js";

const list = document.querySelector("[data-list]");
const total = document.querySelector("[data-total]");
const feedback = document.querySelector("[data-feedback]");
const reload = document.querySelector("[data-reload]");
const typeFilter = document.querySelector("[data-type-filter]");
const loadMore = document.querySelector("[data-load-more]");
const pageSize = 100;
let lastDocument;
let loadedCount = 0;
let hasMore = false;
let isLoading = false;
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

function participantKey(event) {
  const id = typeof event.preInscritoId === "string" ? event.preInscritoId : "";
  if (id) return id;
  let phone = typeof event.whatsapp === "string" ? event.whatsapp.replace(/\D/g, "") : "";
  if (phone.startsWith("55") && [12, 13].includes(phone.length)) phone = phone.slice(2);
  return phone;
}

async function loadParticipantContacts(events, db, firestore) {
  const missing = [...new Set(events.map(participantKey).filter((key) => key && !participantCache.has(key)))];
  await Promise.all(missing.map(async (key) => {
    try {
      const participant = await firestore.getDoc(firestore.doc(db, "preInscritos", key));
      const data = participant.data();
      participantCache.set(key, participant.exists() ? {
        nome: typeof data?.nome === "string" ? data.nome : "",
        whatsapp: typeof data?.whatsapp === "string" ? data.whatsapp : key,
      } : null);
    } catch (error) {
      console.warn("Não foi possível buscar o contato do evento.", error);
      participantCache.set(key, null);
    }
  }));
}

function eventElement(event, firestore) {
  const row = document.createElement("article");
  row.className = "webhook-event";
  row.dataset.type = event.tipo || "mensagem";
  const title = event.tipo === "status"
    ? statusLabel(event.status)
    : event.tipo === "envio"
      ? "Disparo pela API"
      : "Mensagem recebida";
  const contact = participantCache.get(participantKey(event));
  const contactName = contact?.nome || event.nome || "Contato não associado";
  const contactPhone = event.whatsapp || contact?.whatsapp || "Número não informado";
  row.innerHTML = `
    <div class="event-summary"><strong></strong><span class="event-time"></span></div>
    <div class="event-contact"><span>Contato</span><strong class="event-name"></strong><span class="event-phone"></span></div>
    <div><span>ID da mensagem</span><code class="event-id"></code></div>
    <div class="event-detail"></div>`;
  row.querySelector(".event-summary strong").textContent = title;
  row.querySelector(".event-time").textContent = formatDate(event.ocorridoEm || event.registradoEm);
  row.querySelector(".event-name").textContent = contactName;
  row.querySelector(".event-phone").textContent = contactPhone;
  row.querySelector(".event-id").textContent = event.messageId || "—";
  const sender = event.enviadoPorNome || event.enviadoPorEmail;
  row.querySelector(".event-detail").textContent = event.erroMensagem || event.resposta || event.texto
    || (sender ? `Enviado por ${sender}` : "Sem detalhes adicionais");
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
  return row;
}

async function loadEvents(reset = true) {
  if (isLoading || (!reset && !hasMore)) return;
  isLoading = true;
  if (reset) {
    list.replaceChildren();
    lastDocument = undefined;
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
    const reference = firestoreModule.collection(db, "whatsappEventos");
    const constraints = [firestoreModule.orderBy("registradoEm", "desc"), firestoreModule.limit(pageSize)];
    const showingReceivedMessages = typeFilter.value === "mensagens";
    if (showingReceivedMessages) constraints.unshift(firestoreModule.where("tipo", "==", "mensagem"));
    if (lastDocument) constraints.splice(-1, 0, firestoreModule.startAfter(lastDocument));
    const query = firestoreModule.query(reference, ...constraints);
    const snapshot = await firestoreModule.getDocs(query);
    const itemLabel = showingReceivedMessages ? "mensagem recebida" : "evento";
    if (snapshot.empty) {
      hasMore = false;
      loadMore.hidden = true;
      if (reset) list.innerHTML = `<p class="empty-state">Nenhuma ${showingReceivedMessages ? "mensagem recebida" : "evento"} desde a ativação desta página.</p>`;
      return;
    }
    const events = snapshot.docs.map((document) => ({reference: document.ref, ...document.data()}));
    await loadParticipantContacts(events, db, firestoreModule);
    events.forEach((event) => list.append(eventElement(event, firestoreModule)));
    lastDocument = snapshot.docs.at(-1) || lastDocument;
    loadedCount += snapshot.size;
    hasMore = snapshot.size === pageSize;
    const loadedLabel = showingReceivedMessages
      ? `carregad${loadedCount === 1 ? "a" : "as"}`
      : `carregad${loadedCount === 1 ? "o" : "os"}`;
    total.textContent = `${loadedCount} ${itemLabel}${loadedCount === 1 ? "" : "s"} ${loadedLabel}`;
    loadMore.hidden = !hasMore;
  } catch (error) {
    console.error(error);
    if (reset) total.textContent = "Erro ao carregar";
    feedback.textContent = "Não foi possível carregar os eventos. Confirme que seu usuário está autenticado.";
    feedback.dataset.state = "error";
  } finally {
    isLoading = false;
    loadMore.disabled = false;
    loadMore.textContent = "Carregar mais";
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
  loadEvents();
});
reload.addEventListener("click", loadEvents);
typeFilter.addEventListener("change", loadEvents);
loadMore.addEventListener("click", () => loadEvents(false));
