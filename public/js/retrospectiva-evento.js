import {getAuthServices, getFirestoreServices, getFunctionsServices} from "/js/firebase-client.js";

const generateButton = document.querySelector("[data-generate]");
const status = document.querySelector("[data-status]");
const content = document.querySelector("[data-content]");
const feedback = document.querySelector("[data-feedback]");
const number = new Intl.NumberFormat("pt-BR");
let currentData = null;
let generating = false;

function setFeedback(message, state = "neutral") {
  feedback.textContent = message;
  feedback.dataset.state = state;
}

function formatDay(value) {
  const [year, month, day] = String(value || "").split("-");
  return day && month && year ? `${day}/${month}` : "Dia não informado";
}

function bar(container, label, value, maximum) {
  const item = document.createElement("div");
  item.className = "retrospective-bar";
  const heading = document.createElement("div");
  heading.className = "retrospective-bar-head";
  const name = document.createElement("span");
  name.textContent = label;
  name.title = label;
  const count = document.createElement("strong");
  count.textContent = number.format(value);
  heading.append(name, count);
  const track = document.createElement("div");
  track.className = "retrospective-bar-track";
  const fill = document.createElement("i");
  fill.style.width = `${Math.max(0, Math.min(100, value / Math.max(maximum, 1) * 100))}%`;
  track.append(fill);
  item.append(heading, track);
  container.append(item);
}

function empty(container, message) {
  const paragraph = document.createElement("p");
  paragraph.className = "retrospective-empty";
  paragraph.textContent = message;
  container.append(paragraph);
}

function renderSummary(summary, narrative, generatedAt) {
  document.querySelector("[data-story-title]").textContent = narrative.titulo || "O GROB Experience em retrospectiva";
  document.querySelector("[data-story-summary]").textContent = narrative.resumo || "";
  document.querySelector("[data-generated-at]").textContent = generatedAt?.toDate
    ? `Gerada em ${generatedAt.toDate().toLocaleString("pt-BR", {dateStyle: "short", timeStyle: "short"})}` : "";
  document.querySelector("[data-scans]").textContent = number.format(summary.leituras?.total || 0);
  document.querySelector("[data-codes]").textContent = number.format(summary.leituras?.codigosDistintos || 0);
  document.querySelector("[data-presence]").textContent = number.format(summary.quatroEventos?.presentes || 0);
  document.querySelector("[data-survey-count]").textContent = number.format(summary.pesquisa?.respostas || 0);

  const days = document.querySelector("[data-days]");
  days.replaceChildren();
  const dayCounts = Array.isArray(summary.leituras?.porDia) ? summary.leituras.porDia : [];
  const maxDay = Math.max(1, ...dayCounts.map((item) => item.total || 0));
  dayCounts.forEach((item) => bar(days, formatDay(item.dia), item.total || 0, maxDay));
  if (!dayCounts.length) empty(days, "Sem leituras no período do evento.");

  const activities = document.querySelector("[data-activities]");
  activities.replaceChildren();
  const ranking = (Array.isArray(summary.atividades?.ranking) ? summary.atividades.ranking : [])
    .filter((item) => item.total > 0).slice(0, 8);
  const maxActivity = Math.max(1, ...ranking.map((item) => item.total));
  ranking.forEach((item) => bar(activities, item.nome || "Atividade", item.total, maxActivity));
  if (!ranking.length) empty(activities, "Nenhuma atividade com leituras no período.");

  const peaks = document.querySelector("[data-peaks]");
  peaks.replaceChildren();
  const peakHours = Array.isArray(summary.leituras?.picos) ? summary.leituras.picos : [];
  peakHours.forEach((peak) => {
    const item = document.createElement("article");
    const label = document.createElement("span");
    label.textContent = `${formatDay(peak.dia)}, ${peak.hora || "—"}`;
    const count = document.createElement("strong");
    count.textContent = `${number.format(peak.total || 0)} leituras`;
    item.append(label, count);
    peaks.append(item);
  });
  if (!peakHours.length) empty(peaks, "Nenhum horário com leituras no período.");

  const survey = document.querySelector("[data-survey]");
  survey.replaceChildren();
  const questions = (Array.isArray(summary.pesquisa?.perguntas) ? summary.pesquisa.perguntas : [])
    .filter((item) => Array.isArray(item.opcoes) && item.opcoes.some((option) => option.total > 0)).slice(0, 4);
  questions.forEach((question) => {
    const item = document.createElement("article");
    const title = document.createElement("strong");
    title.textContent = question.pergunta || "Pergunta da pesquisa";
    const options = document.createElement("ul");
    question.opcoes.filter((option) => option.total > 0)
      .sort((left, right) => right.total - left.total).slice(0, 4).forEach((option) => {
        const choice = document.createElement("li");
        choice.textContent = `${option.opcao}: ${number.format(option.total)}`;
        options.append(choice);
      });
    item.append(title, options);
    survey.append(item);
  });
  if (!questions.length) empty(survey, "Ainda não há respostas de múltipla escolha para resumir.");

  const insights = document.querySelector("[data-insights]");
  insights.replaceChildren();
  (Array.isArray(narrative.insights) ? narrative.insights : []).forEach((insight) => {
    const item = document.createElement("article");
    const title = document.createElement("h3");
    title.textContent = insight.titulo || "Observação";
    const text = document.createElement("p");
    text.textContent = insight.texto || "";
    item.append(title, text);
    insights.append(item);
  });
}

function render(data) {
  currentData = data;
  const hasRetrospective = Boolean(data?.resumo && data?.narrativa);
  content.hidden = !hasRetrospective;
  if (hasRetrospective) renderSummary(data.resumo, data.narrativa, data.geradoEm);
  generateButton.textContent = hasRetrospective ? "Gerar novamente" : "Gerar com Gemini";
  generateButton.disabled = generating || data?.status === "generating";
  status.textContent = data?.status === "generating"
    ? "Calculando os números e escrevendo a retrospectiva..."
    : hasRetrospective ? "Números calculados a partir dos registros do evento." : "A retrospectiva ainda não foi gerada.";
  if (data?.status === "error") setFeedback(data.erro || "Não foi possível gerar a retrospectiva.", "error");
}

generateButton.addEventListener("click", async () => {
  if (generating) return;
  generating = true;
  generateButton.disabled = true;
  status.textContent = "Calculando os números e escrevendo a retrospectiva...";
  setFeedback("");
  try {
    const {functions, functionsModule} = await getFunctionsServices();
    const generate = functionsModule.httpsCallable(functions, "generateEventRetrospective", {timeout: 540000});
    await generate({refresh: Boolean(currentData?.resumo && currentData?.narrativa)});
    setFeedback("Retrospectiva gerada e salva.", "success");
  } catch (error) {
    console.error(error);
    setFeedback(error?.message || "Não foi possível gerar a retrospectiva.", "error");
  } finally {
    generating = false;
    render(currentData);
  }
});

const {auth, authModule} = await getAuthServices();
authModule.onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const profile = await firestoreModule.getDoc(firestoreModule.doc(db, "users", user.uid));
    if (!profile.exists() || profile.data()?.active === false || profile.data()?.roles?.admin !== true) {
      window.location.replace("/app/");
      return;
    }
    firestoreModule.onSnapshot(firestoreModule.doc(db, "retrospectivasEvento", "grob-experience-2026"),
      (snapshot) => render(snapshot.exists() ? snapshot.data() : null),
      (error) => {
        console.error(error);
        status.textContent = "Não foi possível carregar a retrospectiva.";
        setFeedback("Verifique sua conexão e suas permissões.", "error");
      });
  } catch (error) {
    console.error(error);
    status.textContent = "Não foi possível abrir a retrospectiva.";
    setFeedback("Verifique sua conexão e tente novamente.", "error");
  }
});
