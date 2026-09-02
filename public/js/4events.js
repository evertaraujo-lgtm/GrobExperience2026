import {getAuthServices, getFirestoreServices, getFunctionsServices} from "/js/firebase-client.js";

const list = document.querySelector("[data-list]");
const total = document.querySelector("[data-total]");
const feedback = document.querySelector("[data-feedback]");
const search = document.querySelector("[data-search]");
const more = document.querySelector("[data-load-more]");
const importToggle = document.querySelector("[data-import-toggle]");
const check = document.querySelector("[data-check-presence]");
const deleteAll = document.querySelector("[data-delete-all]");
const editor = document.querySelector("[data-import-editor]");
const file = document.querySelector("[data-import-file]");
const fileName = document.querySelector("[data-file-name]");
const importFeedback = document.querySelector("[data-import-feedback]");
const submit = document.querySelector("[data-import-submit]");
const search4Events = document.querySelector("[data-search-4events]");
const search4EventsModal = document.querySelector("[data-search-4events-modal]");
const search4EventsForm = document.querySelector("[data-search-4events-form]");
const search4EventsType = document.querySelector("[data-search-4events-type]");
const search4EventsValue = document.querySelector("[data-search-4events-value]");
const search4EventsLabel = document.querySelector("[data-search-4events-label]");
const search4EventsSubmit = document.querySelector("[data-search-4events-submit]");
const search4EventsFeedback = document.querySelector("[data-search-4events-feedback]");
const search4EventsResults = document.querySelector("[data-search-4events-results]");
const search4EventsCancel = document.querySelectorAll("[data-search-4events-cancel]");

let admin = false;
let lastDoc;
let hasMore = false;
let loading = false;
let xlsx;

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

function updateSearch4EventsField() {
  const byQrCode = search4EventsType.value === "qrCode";
  search4EventsLabel.textContent = byQrCode ? "QRCode" : "E-mail";
  search4EventsValue.type = byQrCode ? "text" : "email";
  search4EventsValue.placeholder = byQrCode ? "Informe o QR Code" : "nome@empresa.com";
  search4EventsValue.value = "";
}

function searchResultElement(occurrence) {
  const item = document.createElement("article");
  item.className = "participant-row";
  item.innerHTML = '<div class="participant-meta"><strong></strong><span>E-mail</span></div><div class="participant-meta"><strong></strong><span>ID</span></div><div class="participant-meta"><strong></strong><span>QRCode</span></div><div class="participant-meta"><strong></strong><span>Presença</span></div>';
  const values = item.querySelectorAll("strong");
  values[0].textContent = occurrence.nome || occurrence.email || "Nome não informado";
  item.querySelectorAll("span")[0].textContent = occurrence.email || "E-mail não informado";
  values[1].textContent = occurrence.id || "Não informado";
  values[2].textContent = occurrence.qrCode || "Não informado";
  values[3].textContent = occurrence.presente === true ? "Presente" : occurrence.presente === false ? "Não presente" : "Não informado";
  return item;
}

function row(visitor, firestore) {
  const element = document.createElement("article");
  element.className = "participant-row";
  element.innerHTML = '<div class="participant-meta"><strong></strong><span></span></div><div class="participant-meta"><strong></strong><span>ID</span></div><div class="participant-meta"><strong></strong><span>QRCode</span></div><div class="participant-meta"><strong></strong><span>Coordenador</span></div><div class="participant-meta"><strong></strong><span>4 Events</span></div><div class="participant-actions"><button class="danger-delete" type="button" hidden>Excluir</button></div>';
  element.querySelectorAll("strong")[0].textContent = visitor.nome || "Nome não informado";
  element.querySelectorAll("span")[0].textContent = visitor.email || "E-mail não informado";
  element.querySelectorAll("strong")[1].textContent = visitor.id4Events || "Não informado";
  element.querySelectorAll("strong")[2].textContent = visitor.qrCode || "Não informado";
  element.querySelectorAll("strong")[3].textContent = visitor.coordenador || "Coordenador não informado";
  element.querySelectorAll("strong")[4].textContent = visitor.attendeeAttendingEvent === true ? "Presente" : visitor.attendeeAttendingEvent === false ? "Não presente" : "Ainda não consultado";
  const remove = element.querySelector(".danger-delete");
  if (admin) {
    remove.hidden = false;
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Excluir a linha de ${visitor.nome}? Esta ação não pode ser desfeita.`)) return;
      remove.disabled = true;
      try {
        await firestore.deleteDoc(visitor.reference);
        setFeedback(`${visitor.nome} foi excluído(a).`);
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
    list.replaceChildren(); lastDoc = undefined; total.textContent = "Carregando..."; more.hidden = true;
  }
  try {
    const {db, firestoreModule: firestore} = await getFirestoreServices();
    const constraints = [firestore.orderBy("nomeOrdenacao"), firestore.limit(100)];
    if (lastDoc) constraints.splice(-1, 0, firestore.startAfter(lastDoc));
    const snapshot = await firestore.getDocs(firestore.query(firestore.collection(db, "visitantesEstrategicos"), ...constraints));
    if (snapshot.empty) {
      if (reset) list.innerHTML = '<p class="empty-state">Nenhum visitante estratégico.</p>';
      hasMore = false;
      return;
    }
    snapshot.docs.forEach((document) => list.append(row({reference: document.ref, ...document.data()}, firestore)));
    lastDoc = snapshot.docs.at(-1);
    hasMore = snapshot.size === 100;
    more.hidden = !hasMore;
    total.textContent = `${list.children.length} linha(s) carregada(s)`;
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
      return ["id", "qrcode", "nome", "e-mail", "celular (whatsapp)", "empresa", "coordenador", "whatsapp coordenador"].every((column) => found.includes(column));
    });
    if (headerIndex < 0) throw new Error("A planilha precisa ter as colunas ID, QRCode, Nome, E-mail, Celular (WhatsApp), Empresa, Coordenador e Whatsapp Coordenador.");
    const sheetHeaders = headers(matrix[headerIndex]);
    const rows = matrix.slice(headerIndex + 1).filter((values) => values.some((item) => String(item).trim()))
      .map((values) => Object.fromEntries(sheetHeaders.map((key, index) => [key, values[index]])));
    const invalidRows = [];
    const valid = rows.map((rowData, index) => {
      const visitor = {
        id4Events: value(rowData, ["id"]),
        qrCode: value(rowData, ["qrcode"]),
        nome: value(rowData, ["nome"]),
        email: normalizedEmail(value(rowData, ["e-mail"])),
        whatsapp: normalizedPhone(value(rowData, ["celular (whatsapp)"])),
        empresa: value(rowData, ["empresa"]),
        coordenador: value(rowData, ["coordenador"]),
        whatsappCoordenador: normalizedPhone(value(rowData, ["whatsapp coordenador"])),
      };
      if (!visitor.id4Events || !visitor.qrCode || !visitor.nome || !visitor.email || !visitor.whatsapp || !visitor.empresa || !visitor.coordenador || !visitor.whatsappCoordenador) invalidRows.push(index + headerIndex + 2);
      return visitor;
    }).filter((visitor) => visitor.id4Events && visitor.qrCode && visitor.nome && visitor.email && visitor.whatsapp && visitor.empresa && visitor.coordenador && visitor.whatsappCoordenador);
    if (!valid.length) throw new Error("Nenhuma linha válida encontrada.");

    const {db, firestoreModule: firestore} = await getFirestoreServices();
    let batch = firestore.writeBatch(db);
    let operations = 0;
    for (const visitor of valid) {
      const id = encodeURIComponent(`${visitor.id4Events}__${visitor.qrCode}__${visitor.whatsappCoordenador}`);
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
  updateSearch4EventsField();
  search4EventsValue.focus();
});

search4EventsCancel.forEach((button) => button.addEventListener("click", () => search4EventsModal.close()));
search4EventsType.addEventListener("change", updateSearch4EventsField);

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
    const result = await search4EventsApi({type: search4EventsType.value, query: search4EventsValue.value});
    const occurrences = Array.isArray(result.data.occurrences) ? result.data.occurrences : [];
    search4EventsResults.append(...occurrences.map(searchResultElement));
    search4EventsResults.hidden = false;
    setSearch4EventsFeedback(`${occurrences.length} ocorrência(s) encontrada(s) para ${result.data.query}.`, occurrences.length ? "success" : "neutral");
  } catch (error) {
    console.error(error);
    setSearch4EventsFeedback(error.message || "Não foi possível consultar a 4 Events.", "error");
  } finally {
    search4EventsSubmit.disabled = false;
    search4EventsSubmit.textContent = "Buscar";
  }
});

check.addEventListener("click", async () => {
  if (!admin || !window.confirm("Consultar a presença e notificar os coordenadores dos visitantes presentes? Cada linha será notificada no máximo uma vez.")) return;
  check.disabled = true;
  check.textContent = "Consultando...";
  try {
    const {functions, functionsModule} = await getFunctionsServices();
    const result = await functionsModule.httpsCallable(functions, "check4EventsPresence")({});
    const failures = Array.isArray(result.data.notificationFailures) ? result.data.notificationFailures.length : 0;
    setFeedback(`${result.data.checked} linha(s) consultada(s); ${result.data.attending} presença(s); ${result.data.notificationsSent} notificação(ões) enviada(s); ${result.data.notificationsSkipped} já enviada(s) ou sem dados válidos.${failures ? ` ${failures} falha(s) no envio.` : ""}`, failures ? "error" : "success");
    await load();
  } catch (error) {
    console.error(error);
    setFeedback(error.message || "Não foi possível consultar a 4 Events.", "error");
  } finally {
    check.disabled = false;
    check.textContent = "Checar presença";
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
  load();
});
