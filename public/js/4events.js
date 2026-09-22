import {getAuthServices, getFirestoreServices, getFunctionsServices} from "/js/firebase-client.js";

const list = document.querySelector("[data-list]");
const apiList = document.querySelector("[data-api-list]");
const apiTotal = document.querySelector("[data-api-total]");
const total = document.querySelector("[data-total]");
const feedback = document.querySelector("[data-feedback]");
const search = document.querySelector("[data-search]");
const more = document.querySelector("[data-load-more]");
const importToggle = document.querySelector("[data-import-toggle]");
const check = document.querySelector("[data-check-presence]");
const checkTimer = document.querySelector("[data-check-timer]");
const checkElapsed = document.querySelector("[data-check-elapsed]");
const deleteAll = document.querySelector("[data-delete-all]");
const editor = document.querySelector("[data-import-editor]");
const file = document.querySelector("[data-import-file]");
const fileName = document.querySelector("[data-file-name]");
const importFeedback = document.querySelector("[data-import-feedback]");
const submit = document.querySelector("[data-import-submit]");
const search4Events = document.querySelector("[data-search-4events]");
const search4EventsModal = document.querySelector("[data-search-4events-modal]");
const search4EventsForm = document.querySelector("[data-search-4events-form]");
const search4EventsValue = document.querySelector("[data-search-4events-value]");
const search4EventsSubmit = document.querySelector("[data-search-4events-submit]");
const search4EventsFeedback = document.querySelector("[data-search-4events-feedback]");
const search4EventsResults = document.querySelector("[data-search-4events-results]");
const search4EventsCancel = document.querySelectorAll("[data-search-4events-cancel]");
const presenceAutomation = document.querySelector("[data-presence-automation]");
const presenceStatus = document.querySelector("[data-presence-status]");
const presenceLast = document.querySelector("[data-presence-last]");
const presenceLastResult = document.querySelector("[data-presence-last-result]");
const presenceNext = document.querySelector("[data-presence-next]");
const presenceSource = document.querySelector("[data-presence-source]");
const presenceInterval = document.querySelector("[data-presence-interval]");
const presenceToggle = document.querySelector("[data-presence-toggle]");
const presenceAutomationFeedback = document.querySelector("[data-presence-automation-feedback]");

let admin = false;
let lastDoc;
let hasMore = false;
let loading = false;
let xlsx;
let presenceAutomationConfig = {ativa: false, intervaloMinutos: 5};
let unsubscribePresenceAutomation;
let observedLastCheck;

const normalize = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
const normalizedEmail = (value) => String(value ?? "").trim().toLowerCase();

function normalizedPhone(value) {
  let phone = String(value ?? "").replace(/\D/g, "");
  if (phone.startsWith("55") && (phone.length === 12 || phone.length === 13)) phone = phone.slice(2);
  return phone;
}

function setFeedback(message, state = "neutral") {
  feedback.textContent = message;
  feedback.dataset.state = state;
}

function setSearch4EventsFeedback(message, state = "neutral") {
  search4EventsFeedback.textContent = message;
  search4EventsFeedback.dataset.state = state;
}

function dateFromTimestamp(value) {
  if (value?.toDate) return value.toDate();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  return null;
}

function formattedDateTime(value) {
  const date = dateFromTimestamp(value);
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat("pt-BR", {dateStyle: "short", timeStyle: "medium"}).format(date)
    : "Nunca realizada";
}

function renderPresenceAutomation(data = {}) {
  const active = data.ativa === true;
  const running = typeof data.execucaoId === "string" && data.execucaoId;
  const interval = [5, 10, 15, 30, 60].includes(Number(data.intervaloMinutos)) ? Number(data.intervaloMinutos) : 5;
  presenceAutomationConfig = {ativa: active, intervaloMinutos: interval};
  presenceStatus.dataset.active = String(active);
  presenceStatus.textContent = `${active ? "Ativo" : "Inativo"}${running ? " • checando" : ""}`;
  presenceInterval.value = String(interval);
  presenceInterval.disabled = active || Boolean(running);
  presenceToggle.textContent = active ? "Stop" : "Start";
  presenceToggle.dataset.running = String(active);

  presenceLast.textContent = formattedDateTime(data.ultimaChecagemEm);
  const result = data.ultimoResultado;
  if (result && typeof result === "object") {
    const failures = Array.isArray(result.notificationFailures) ? result.notificationFailures.length : 0;
    presenceLastResult.textContent = `${result.checked ?? 0} consultado(s), ${result.attending ?? 0} presente(s), ${result.notificationsSent ?? 0} notificação(ões) enviada(s)${failures ? `, ${failures} falha(s)` : ""}.`;
  } else if (data.ultimoErro) presenceLastResult.textContent = `Falha: ${data.ultimoErro}`;
  else presenceLastResult.textContent = "";

  if (running) presenceNext.textContent = "Checando agora...";
  else if (active) presenceNext.textContent = formattedDateTime(data.proximaChecagemEm).replace("Nunca realizada", "Aguardando agendamento");
  else presenceNext.textContent = "Automação inativa";
  presenceSource.textContent = data.ultimaOrigem ? `Última execução: ${data.ultimaOrigem === "automatica" ? "automática" : "manual"}.` : "";
}

async function observePresenceAutomation(db, firestore) {
  unsubscribePresenceAutomation?.();
  const configRef = firestore.doc(db, "configuracoes", "checagemPresenca4Events");
  unsubscribePresenceAutomation = firestore.onSnapshot(configRef, (snapshot) => {
    const data = snapshot.exists() ? snapshot.data() : {};
    renderPresenceAutomation(data);
    const lastCheck = dateFromTimestamp(data.ultimaChecagemEm)?.getTime();
    if (observedLastCheck !== undefined && lastCheck && lastCheck !== observedLastCheck) load();
    observedLastCheck = lastCheck;
  }, (error) => {
    console.error(error);
    presenceAutomationFeedback.textContent = "Não foi possível acompanhar o estado da automação.";
    presenceAutomationFeedback.dataset.state = "error";
  });
}

function deleteButtonLabel() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg><span>Excluir</span>';
}

function searchResultElement(occurrence, firestore) {
  const item = document.createElement("article");
  item.className = "participant-row";
  item.innerHTML = '<div class="participant-meta"><strong></strong><span>E-mail</span></div><div class="participant-meta"><strong></strong><span>ID</span></div><div class="participant-meta"><strong></strong><span>QRCode</span></div><div class="participant-meta"><strong></strong><span>Data</span></div><div class="participant-meta"><strong></strong><span>Presença</span></div><div class="participant-meta whatsapp-delivery"><strong></strong><span>WhatsApp</span></div>';
  const values = item.querySelectorAll("strong");
  values[0].textContent = occurrence.nome || occurrence.email || "Nome não informado";
  item.querySelectorAll("span")[0].textContent = occurrence.email || "E-mail não informado";
  values[1].textContent = occurrence.id4Events || occurrence.id || "Não informado";
  values[2].textContent = occurrence.qrCode || "Não informado";
  values[3].textContent = occurrence.dataParticipacao || "Não informada";
  values[4].textContent = occurrence.presente === true ? "Presente" : occurrence.presente === false ? "Não presente" : "Não informado";
  values[5].textContent = occurrence.notificacaoWhatsAppStatus || (occurrence.presente === true ? "Aguardando notificação" : "Aguardando presença");
  if (admin && occurrence.reference && firestore) {
    item.classList.add("participant-row-api-actions");
    const actions = document.createElement("div");
    actions.className = "participant-actions";
    const remove = document.createElement("button");
    remove.className = "danger-delete";
    remove.type = "button";
    remove.title = "Excluir documento do Firestore";
    remove.innerHTML = deleteButtonLabel();
    remove.addEventListener("click", async () => {
      const name = occurrence.nome || occurrence.email || "este visitante";
      if (!window.confirm(`Excluir o documento de ${name} salvo em visitantes4Events? Esta ação não pode ser desfeita.`)) return;
      remove.disabled = true;
      try {
        await firestore.deleteDoc(occurrence.reference);
        setFeedback(`Documento de ${name} excluído do Firestore.`, "success");
        await load();
      } catch (error) {
        console.error(error);
        setFeedback("Não foi possível excluir o documento da 4 Events.", "error");
        remove.disabled = false;
      }
    });
    actions.append(remove);
    item.append(actions);
  }
  return item;
}

function row(visitor, firestore) {
  const element = document.createElement("article");
  element.className = "participant-row";
  element.innerHTML = '<div class="participant-meta"><strong></strong><span></span></div><div class="participant-meta"><strong></strong><span>Empresa</span></div><div class="participant-meta"><strong></strong><span>Coordenador</span></div><div class="participant-meta"><strong></strong><span>4 Events</span></div><div class="participant-actions"><button class="danger-delete" type="button" title="Excluir documento do Firestore" hidden></button></div>';
  element.querySelectorAll("strong")[0].textContent = visitor.nome || "Nome não informado";
  element.querySelectorAll("span")[0].textContent = visitor.email || "E-mail não informado";
  element.querySelectorAll("strong")[1].textContent = visitor.empresa || "Não informada";
  element.querySelectorAll("strong")[2].textContent = visitor.coordenador || "Coordenador não informado";
  element.querySelectorAll("strong")[3].textContent = visitor.attendeeAttendingEvent === true ? "Presente" : visitor.attendeeAttendingEvent === false ? "Não presente" : "Ainda não consultado";
  const remove = element.querySelector(".danger-delete");
  remove.innerHTML = deleteButtonLabel();
  if (admin) {
    remove.hidden = false;
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Excluir o documento de ${visitor.nome} salvo em visitantesEstrategicos? Esta ação não pode ser desfeita.`)) return;
      remove.disabled = true;
      try {
        await firestore.deleteDoc(visitor.reference);
        setFeedback(`Documento de ${visitor.nome} excluído do Firestore.`, "success");
        await load();
      } catch (error) {
        console.error(error);
        setFeedback("Não foi possível excluir o visitante.", "error");
      }
    });
  }
  return element;
}

async function load(reset = true) {
  if (loading || (!reset && !hasMore)) return;
  loading = true;
  if (reset) {
    list.replaceChildren(); apiList.replaceChildren(); lastDoc = undefined; total.textContent = "Carregando..."; apiTotal.textContent = ""; more.hidden = true;
  }
  try {
    const {db, firestoreModule: firestore} = await getFirestoreServices();
    const constraints = [firestore.orderBy("nomeOrdenacao"), firestore.limit(100)];
    if (lastDoc) constraints.splice(-1, 0, firestore.startAfter(lastDoc));
    const snapshot = await firestore.getDocs(firestore.query(firestore.collection(db, "visitantesEstrategicos"), ...constraints));
    if (snapshot.empty) {
      if (reset) list.innerHTML = '<p class="empty-state">Nenhuma linha de referência.</p>';
      hasMore = false;
    } else {
      snapshot.docs.forEach((document) => list.append(row({...document.data(), reference: document.ref}, firestore)));
      lastDoc = snapshot.docs.at(-1);
      hasMore = snapshot.size === 100;
      more.hidden = !hasMore;
      total.textContent = `${list.children.length} linha(s) de referência carregada(s)`;
    }
    if (reset) {
      const apiSnapshot = await firestore.getDocs(firestore.query(firestore.collection(db, "visitantes4Events"), firestore.orderBy("email"), firestore.limit(100)));
      if (apiSnapshot.empty) apiList.innerHTML = '<p class="empty-state">Nenhum retorno da API salvo ainda.</p>';
      else apiSnapshot.docs.forEach((document) => apiList.append(searchResultElement({...document.data(), reference: document.ref}, firestore)));
      apiTotal.textContent = `${apiSnapshot.size} registro(s)`;
    }
  } catch (error) {
    console.error(error);
    setFeedback("Não foi possível carregar os visitantes.", "error");
  } finally {
    loading = false;
  }
}

function headers(values) { return values.map(normalize); }
function value(rowData, keys) {
  const key = keys.find((item) => rowData[item] !== undefined);
  return key === undefined ? "" : String(rowData[key] ?? "").trim();
}

editor.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!admin || !file.files[0]) return;
  submit.disabled = true;
  submit.textContent = "Lendo...";
  try {
    xlsx ??= await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
    const workbook = xlsx.read(await file.files[0].arrayBuffer(), {type: "array"});
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = xlsx.utils.sheet_to_json(sheet, {header: 1, defval: "", raw: true});
    const headerIndex = matrix.findIndex((values) => {
      const found = headers(values);
      return ["nome", "e-mail", "celular (whatsapp)", "empresa", "coordenador", "whatsapp coordenador"].every((column) => found.includes(column));
    });
    if (headerIndex < 0) throw new Error("A planilha precisa ter as colunas Nome, E-mail, Celular (WhatsApp), Empresa, Coordenador e Whatsapp Coordenador.");
    const sheetHeaders = headers(matrix[headerIndex]);
    const rows = matrix.slice(headerIndex + 1).filter((values) => values.some((item) => String(item).trim()))
      .map((values) => Object.fromEntries(sheetHeaders.map((key, index) => [key, values[index]])));
    const invalidRows = [];
    const valid = rows.map((rowData, index) => {
      const visitor = {
        nome: value(rowData, ["nome"]),
        email: normalizedEmail(value(rowData, ["e-mail"])),
        whatsapp: normalizedPhone(value(rowData, ["celular (whatsapp)"])),
        empresa: value(rowData, ["empresa"]),
        coordenador: value(rowData, ["coordenador"]),
        whatsappCoordenador: normalizedPhone(value(rowData, ["whatsapp coordenador"])),
      };
      if (!visitor.nome || !visitor.email || !visitor.whatsapp || !visitor.empresa || !visitor.coordenador || !visitor.whatsappCoordenador) invalidRows.push(index + headerIndex + 2);
      return visitor;
    }).filter((visitor) => visitor.nome && visitor.email && visitor.whatsapp && visitor.empresa && visitor.coordenador && visitor.whatsappCoordenador);
    if (!valid.length) throw new Error("Nenhuma linha válida encontrada.");

    const {db, firestoreModule: firestore} = await getFirestoreServices();
    let batch = firestore.writeBatch(db);
    let operations = 0;
    for (const visitor of valid) {
      const id = encodeURIComponent(`${visitor.email}__${visitor.whatsappCoordenador}`);
      batch.set(firestore.doc(db, "visitantesEstrategicos", id), {
        ...visitor,
        nomeOrdenacao: normalize(visitor.nome),
        origem: "importacao-excel",
        atualizadoEm: firestore.serverTimestamp(),
      }, {merge: true});
      operations += 1;
      if (operations === 400) { await batch.commit(); batch = firestore.writeBatch(db); operations = 0; }
    }
    if (operations) await batch.commit();
    importFeedback.dataset.state = "success";
    importFeedback.textContent = `${valid.length} linha(s) importada(s) ou atualizada(s).${invalidRows.length ? ` ${invalidRows.length} linha(s) ignorada(s) por dados incompletos.` : ""}`;
    await load();
  } catch (error) {
    console.error(error);
    importFeedback.textContent = error.message || "Falha na importação.";
    importFeedback.dataset.state = "error";
  } finally {
    submit.disabled = false;
    submit.textContent = "Importar";
  }
});

importToggle.addEventListener("click", () => { editor.hidden = false; file.click(); });
file.addEventListener("change", () => { fileName.textContent = file.files[0]?.name || "Nenhuma planilha selecionada."; });
document.querySelector("[data-import-cancel]").addEventListener("click", () => { editor.hidden = true; file.value = ""; });

search4Events.addEventListener("click", () => {
  search4EventsForm.reset();
  search4EventsResults.replaceChildren();
  search4EventsResults.hidden = true;
  setSearch4EventsFeedback("");
  search4EventsModal.showModal();
  search4EventsValue.focus();
});

search4EventsCancel.forEach((button) => button.addEventListener("click", () => search4EventsModal.close()));

search4EventsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!admin || !search4EventsForm.reportValidity()) return;
  search4EventsSubmit.disabled = true;
  search4EventsSubmit.textContent = "Buscando...";
  search4EventsResults.replaceChildren();
  search4EventsResults.hidden = true;
  try {
    const {functions, functionsModule} = await getFunctionsServices();
    const search4EventsApi = functionsModule.httpsCallable(functions, "search4Events");
    const result = await search4EventsApi({email: search4EventsValue.value});
    const occurrences = Array.isArray(result.data.occurrences) ? result.data.occurrences : [];
    search4EventsResults.append(...occurrences.map((occurrence) => searchResultElement(occurrence)));
    search4EventsResults.hidden = false;
    setSearch4EventsFeedback(`${occurrences.length} ocorrência(s) encontrada(s) para ${result.data.email}.`, occurrences.length ? "success" : "neutral");
  } catch (error) {
    console.error(error);
    setSearch4EventsFeedback(error.message || "Não foi possível consultar a 4 Events.", "error");
  } finally {
    search4EventsSubmit.disabled = false;
    search4EventsSubmit.textContent = "Buscar";
  }
});

check.addEventListener("click", async () => {
  if (!admin || !window.confirm("Consultar a presença e notificar os coordenadores dos visitantes presentes? Cada coordenador será notificado uma vez por inscrição.")) return;
  check.disabled = true;
  check.textContent = "Consultando...";
  const startedAt = performance.now();
  let timerId;
  const updateTimer = () => {
    const seconds = Math.floor((performance.now() - startedAt) / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const remainder = String(seconds % 60).padStart(2, "0");
    checkElapsed.textContent = hours ? `${hours}:${minutes}:${remainder}` : `${minutes}:${remainder}`;
  };
  const stopTimer = () => {
    if (!timerId) return;
    window.clearInterval(timerId);
    timerId = undefined;
    updateTimer();
  };
  checkTimer.hidden = false;
  updateTimer();
  timerId = window.setInterval(updateTimer, 250);
  try {
    const {functions, functionsModule} = await getFunctionsServices();
    const result = await functionsModule.httpsCallable(functions, "check4EventsPresence")({});
    stopTimer();
    const failures = Array.isArray(result.data.notificationFailures) ? result.data.notificationFailures.length : 0;
    setFeedback(`${result.data.checked} linha(s) consultada(s); ${result.data.attending} presença(s); ${result.data.notificationsSent} notificação(ões) enviada(s); ${result.data.notificationsSkipped} já enviada(s) ou sem dados válidos.${failures ? ` ${failures} falha(s) no envio.` : ""}`, failures ? "error" : "success");
    await load();
  } catch (error) {
    stopTimer();
    console.error(error);
    setFeedback(error.message || "Não foi possível consultar a 4 Events.", "error");
  } finally {
    stopTimer();
    check.disabled = false;
    check.textContent = "Checar presença";
  }
});

presenceToggle.addEventListener("click", async () => {
  if (!admin) return;
  const activating = !presenceAutomationConfig.ativa;
  if (activating && !window.confirm(`Iniciar a checagem automática a cada ${presenceInterval.value} minutos? Visitantes presentes poderão gerar notificações aos coordenadores.`)) return;
  presenceToggle.disabled = true;
  presenceInterval.disabled = true;
  presenceAutomationFeedback.textContent = activating ? "Ativando automação..." : "Interrompendo novas checagens...";
  presenceAutomationFeedback.dataset.state = "neutral";
  try {
    const {functions, functionsModule} = await getFunctionsServices();
    await functionsModule.httpsCallable(functions, "configure4EventsPresenceAutomation")({
      ativa: activating,
      intervaloMinutos: Number(presenceInterval.value),
    });
    presenceAutomationFeedback.textContent = activating
      ? "Automação ativada. A primeira checagem ocorrerá em até 5 minutos."
      : "Automação inativa. Uma checagem já iniciada será concluída normalmente.";
    presenceAutomationFeedback.dataset.state = "success";
  } catch (error) {
    console.error(error);
    presenceAutomationFeedback.textContent = error.message || "Não foi possível alterar a automação.";
    presenceAutomationFeedback.dataset.state = "error";
    presenceInterval.disabled = presenceAutomationConfig.ativa;
  } finally {
    presenceToggle.disabled = false;
  }
});

deleteAll.addEventListener("click", async () => {
  if (!admin || !window.confirm("Deseja excluir toda a lista de visitantes estratégicos?")) return;
  if (!window.confirm("Esta ação será irreversível. Confirmar exclusão definitiva?")) return;
  deleteAll.disabled = true; deleteAll.textContent = "Excluindo...";
  try {
    const {db, firestoreModule: firestore} = await getFirestoreServices();
    let removed = 0;
    while (true) {
      const snapshot = await firestore.getDocs(firestore.query(firestore.collection(db, "visitantesEstrategicos"), firestore.orderBy(firestore.documentId()), firestore.limit(400)));
      if (snapshot.empty) break;
      const batch = firestore.writeBatch(db);
      snapshot.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit(); removed += snapshot.size;
    }
    setFeedback(`${removed} linha(s) excluída(s) permanentemente.`);
    await load();
  } catch (error) {
    console.error(error);
    setFeedback("Não foi possível excluir a lista.", "error");
  } finally {
    deleteAll.disabled = false; deleteAll.textContent = "Excluir lista";
  }
});

search.addEventListener("input", () => {
  const term = normalize(search.value);
  [...list.children].forEach((element) => { element.hidden = Boolean(term && !normalize(element.textContent).includes(term)); });
});
more.addEventListener("click", () => load(false));
document.querySelector("[data-reload]").addEventListener("click", () => load());

const {auth, authModule} = await getAuthServices();
authModule.onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const {db, firestoreModule: firestore} = await getFirestoreServices();
  const profile = await firestore.getDoc(firestore.doc(db, "users", user.uid));
  admin = profile.exists() && profile.data().active !== false && profile.data().roles?.admin === true;
  importToggle.hidden = !admin; check.hidden = !admin; search4Events.hidden = !admin; deleteAll.hidden = !admin;
  presenceAutomation.hidden = !admin;
  if (admin) observePresenceAutomation(db, firestore);
  load();
});
