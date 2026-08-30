import {getAuthServices, getFirestoreServices} from "/js/firebase-client.js";

const list = document.querySelector("[data-list]");
const total = document.querySelector("[data-total]");
const feedback = document.querySelector("[data-feedback]");
const reload = document.querySelector("[data-reload]");

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

async function loadEvents() {
  list.replaceChildren();
  total.textContent = "Carregando...";
  feedback.textContent = "";
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const reference = firestoreModule.collection(db, "whatsappEventos");
    const query = firestoreModule.query(reference, firestoreModule.orderBy("registradoEm", "desc"), firestoreModule.limit(100));
    const snapshot = await firestoreModule.getDocs(query);
    total.textContent = `${snapshot.size} evento${snapshot.size === 1 ? "" : "s"} recente${snapshot.size === 1 ? "" : "s"}`;
    if (snapshot.empty) {
      list.innerHTML = '<p class="empty-state">Nenhum evento recebido desde a ativação desta página.</p>';
      return;
    }
    for (const document of snapshot.docs) list.append(eventElement(document.data()));
  } catch (error) {
    console.error(error);
    total.textContent = "Erro ao carregar";
    feedback.textContent = "Não foi possível carregar os eventos. Confirme que seu usuário é administrador.";
    feedback.dataset.state = "error";
  }
}

const {auth, authModule} = await getAuthServices();
authModule.onAuthStateChanged(auth, (user) => {
  if (user) loadEvents();
});
reload.addEventListener("click", loadEvents);
