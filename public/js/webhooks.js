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

function eventElement(event) {
  const row = document.createElement("article");
  row.className = "webhook-event";
  row.dataset.type = event.tipo || "mensagem";
  const title = event.tipo === "status"
    ? statusLabel(event.status)
    : event.tipo === "envio"
      ? "Disparo pela API"
      : "Mensagem recebida";
  row.innerHTML = `
    <div><strong></strong><span class="event-time"></span></div>
    <div><span>WhatsApp</span><strong class="event-phone"></strong></div>
    <div><span>ID da mensagem</span><code class="event-id"></code></div>
    <div class="event-detail"></div>`;
  row.querySelector("div strong").textContent = title;
  row.querySelector(".event-time").textContent = formatDate(event.ocorridoEm || event.registradoEm);
  row.querySelector(".event-phone").textContent = event.whatsapp || "Não associado";
  row.querySelector(".event-id").textContent = event.messageId || "—";
  const sender = event.enviadoPorNome || event.enviadoPorEmail;
  row.querySelector(".event-detail").textContent = event.erroMensagem || event.resposta || event.texto
    || (sender ? `Enviado por ${sender}` : "Sem detalhes adicionais");
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
    for (const document of snapshot.docs) list.append(eventElement(document.data()));
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
authModule.onAuthStateChanged(auth, (user) => {
  if (user) loadEvents();
});
reload.addEventListener("click", loadEvents);
typeFilter.addEventListener("change", loadEvents);
loadMore.addEventListener("click", () => loadEvents(false));
