import {getAuthServices, getFirestoreServices, getFunctionsServices} from "/js/firebase-client.js";

const generateButton = document.querySelector("[data-generate]");
const status = document.querySelector("[data-status]");
const content = document.querySelector("[data-content]");
const feedback = document.querySelector("[data-feedback]");
const versionSelect = document.querySelector("[data-version]");
const versionWrap = document.querySelector("[data-version-wrap]");
const number = new Intl.NumberFormat("pt-BR");
const percentFormat = new Intl.NumberFormat("pt-BR", {maximumFractionDigits: 1});
let currentData = null;
let versions = [];
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

function percentage(part, total) {
  return total > 0 ? `${percentFormat.format(part / total * 100)}%` : "—";
}

function listCard(container, title, rows, note = "") {
  const article = document.createElement("article");
  const heading = document.createElement("h3");
  heading.textContent = title;
  article.append(heading);
  if (rows.length) {
    const list = document.createElement("ul");
    rows.forEach(([label, value]) => {
      const row = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = label;
      const count = document.createElement("strong");
      count.textContent = value;
      row.append(name, count);
      list.append(row);
    });
    article.append(list);
  } else empty(article, "Sem registros.");
  if (note) {
    const caption = document.createElement("small");
    caption.textContent = note;
    article.append(caption);
  }
  container.append(article);
}

function audienceRow(container, day, audience, counts, totalRow = false) {
  const row = document.createElement("tr");
  if (totalRow) row.className = "is-total";
  [day, audience, number.format(counts.inscritos || 0), number.format(counts.presentes || 0),
    number.format(counts.semInformacao || 0),
    percentage(counts.presentes || 0, counts.inscritos || 0)].forEach((value) => {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.append(cell);
  });
  container.append(row);
}

function renderThemes(container, themes, emptyMessage) {
  container.replaceChildren();
  if (!Array.isArray(themes) || !themes.length) {
    empty(container, emptyMessage);
    return;
  }
  themes.forEach((theme) => {
    const item = document.createElement("article");
    const title = document.createElement("h4");
    title.textContent = theme.tema || "Tema";
    const description = document.createElement("p");
    description.textContent = theme.resumo || "";
    const count = document.createElement("small");
    count.textContent = `${number.format(theme.ocorrenciasNaAmostra || 0)} mensagem(ns) citada(s) na amostra`;
    item.append(title, description, count);
    (Array.isArray(theme.exemplos) ? theme.exemplos : []).slice(0, 2).forEach((example) => {
      const quote = document.createElement("blockquote");
      quote.textContent = example;
      item.append(quote);
    });
    container.append(item);
  });
}

function renderSummary(summary, narrative, generatedAt) {
  document.querySelector("[data-story-title]").textContent = narrative.titulo || "O GROB Experience em números";
  document.querySelector("[data-story-summary]").textContent = narrative.resumo || "Os números já estão disponíveis. A análise do Gemini ainda não foi gerada.";
  document.querySelector("[data-generated-at]").textContent = generatedAt?.toDate
    ? `${narrative.titulo ? "Gerada" : "Números calculados"} em ${generatedAt.toDate().toLocaleString("pt-BR", {dateStyle: "short", timeStyle: "short"})}` : "";
  document.querySelector("[data-scans]").textContent = number.format(summary.leituras?.total || 0);
  document.querySelector("[data-codes]").textContent = number.format(summary.leituras?.codigosDistintos || 0);
  document.querySelector("[data-registrations]").textContent = number.format(summary.quatroEventos?.importados || 0);
  document.querySelector("[data-presence]").textContent = number.format(summary.quatroEventos?.presentes || 0);
  document.querySelector("[data-visitor-presence]").textContent = number.format(summary.quatroEventos?.presentesVisitantes || 0);
  document.querySelector("[data-lead-count]").textContent = number.format(summary.leads?.total || 0);
  document.querySelector("[data-whatsapp-sent]").textContent = number.format(summary.whatsapp?.enviadas || 0);
  document.querySelector("[data-whatsapp-received]").textContent = number.format(summary.whatsapp?.recebidas || 0);
  document.querySelector("[data-survey-count]").textContent = number.format(summary.pesquisa?.respostas || 0);

  const audience = document.querySelector("[data-audience]");
  audience.replaceChildren();
  const audienceDays = Array.isArray(summary.quatroEventos?.porDia) ? summary.quatroEventos.porDia : [];
  audienceDays.forEach((day) => {
    audienceRow(audience, formatDay(day.dia), "Todos", day.total || {});
    audienceRow(audience, formatDay(day.dia), "Visitantes", day.visitantes || {});
  });
  if (audienceDays.length) {
    audienceRow(audience, "Três dias", "Todos", {
      inscritos: summary.quatroEventos?.importados, presentes: summary.quatroEventos?.presentes,
      semInformacao: summary.quatroEventos?.semInformacao,
    }, true);
    audienceRow(audience, "Três dias", "Visitantes", {
      inscritos: summary.quatroEventos?.visitantes, presentes: summary.quatroEventos?.presentesVisitantes,
      semInformacao: summary.quatroEventos?.semInformacaoVisitantes,
    }, true);
  }
  document.querySelector("[data-audience-note]").textContent = audienceDays.length
    ? `Cada inscrição corresponde a uma categoria de um dia. A taxa usa todas as inscrições como base; “sem informação” não comprova ausência. Presença conforme a última importação da 4Events.${summary.quatroEventos?.foraDoPeriodo?.inscritos ? ` ${number.format(summary.quatroEventos.foraDoPeriodo.inscritos)} registro(s) sem data dos três dias foram separados.` : ""}`
    : "O detalhamento por categoria estará disponível após atualizar esta análise.";

  const categories = document.querySelector("[data-categories]");
  categories.replaceChildren();
  audienceDays.forEach((day) => listCard(categories, formatDay(day.dia),
    (Array.isArray(day.categorias) ? day.categorias : []).map((item) => [item.nome,
      `${number.format(item.presentes || 0)} / ${number.format(item.inscritos || 0)} presentes`]),
    "Presenças / inscrições"));
  if (!audienceDays.length) empty(categories, "Atualize a análise para ver as categorias dos três dias.");

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

  const revisits = document.querySelector("[data-revisits]");
  revisits.replaceChildren();
  const revisited = (Array.isArray(summary.atividades?.ranking) ? summary.atividades.ranking : [])
    .filter((item) => item.revisitas > 0).sort((left, right) => right.revisitas - left.revisitas).slice(0, 8);
  const maxRevisits = Math.max(1, ...revisited.map((item) => item.revisitas));
  revisited.forEach((item) => bar(revisits, item.nome || "Atividade", item.revisitas, maxRevisits));
  if (!revisited.length) empty(revisits, "Nenhuma revisita identificada nesta versão.");

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

  const sellers = document.querySelector("[data-sellers]");
  sellers.replaceChildren();
  const sellerCounts = (Array.isArray(summary.leads?.vendedores) ? summary.leads.vendedores : []).slice(0, 8);
  const maxSeller = Math.max(1, ...sellerCounts.map((item) => item.total || 0));
  sellerCounts.forEach((item) => bar(sellers, item.nome || "Vendedor", item.total || 0, maxSeller));
  if (!sellerCounts.length) empty(sellers, "Nenhum lead identificado nesta versão.");

  const leadFields = document.querySelector("[data-lead-fields]");
  leadFields.replaceChildren();
  (Array.isArray(summary.leads?.campos) ? summary.leads.campos : []).slice(0, 12).forEach((field) => {
    listCard(leadFields, field.pergunta || "Pergunta da coleta",
      (Array.isArray(field.opcoes) ? field.opcoes : []).slice(0, 8)
        .map((choice) => [choice.opcao, number.format(choice.total || 0)]),
      `${number.format(field.respondentes || 0)} registro(s) com resposta`);
  });
  if (!leadFields.childElementCount) empty(leadFields, "Não há respostas estruturadas de leads nesta versão.");

  const whatsapp = document.querySelector("[data-whatsapp]");
  whatsapp.replaceChildren();
  if (summary.whatsapp) {
    listCard(whatsapp, "Envios por finalidade", [
      ["Campanhas", number.format(summary.whatsapp.campanhas || 0)],
      ["Notificações de chegada", number.format(summary.whatsapp.notificacoesChegada || 0)],
      ["Lembretes de presença", number.format(summary.whatsapp.lembretesPresenca || 0)],
      ["Outros envios", number.format(summary.whatsapp.outrosEnvios || 0)],
    ], "Cada mensagem enviada é contada uma vez, sem envios de teste.");
    listCard(whatsapp, "Fluxo registrado", [
      ["Enviadas", number.format(summary.whatsapp.enviadas || 0)],
      ["Recebidas", number.format(summary.whatsapp.recebidas || 0)],
    ], "Os dois volumes são independentes e cobrem todo o histórico registrado.");
  } else empty(whatsapp, "Atualize a análise para ver os volumes de WhatsApp.");

  const sample = Array.isArray(summary.whatsapp?.amostraAnalise) ? summary.whatsapp.amostraAnalise : [];
  const represented = sample.reduce((sum, item) => sum + (item.ocorrencias || 0), 0);
  document.querySelector("[data-message-sample-note]").textContent = summary.whatsapp
    ? `${number.format(summary.whatsapp.comTexto || 0)} mensagens com texto foram registradas. A análise temática usa até ${number.format(sample.length)} textos distintos, representando ${number.format(represented)} mensagem(ns). Um texto pode sustentar mais de um tema; motivos só aparecem quando declarados explicitamente.`
    : "Atualize a análise para avaliar os textos recebidos.";
  renderThemes(document.querySelector("[data-doubts]"), narrative.duvidas,
    "Nenhuma dúvida recorrente identificada ou análise do Gemini indisponível.");
  renderThemes(document.querySelector("[data-problems]"), narrative.problemas,
    "Nenhum problema recorrente identificado ou análise do Gemini indisponível.");
  renderThemes(document.querySelector("[data-dropouts]"), narrative.desistencias,
    "Nenhum motivo explícito identificado ou análise do Gemini indisponível.");

  const receivedTexts = document.querySelector("[data-received-texts]");
  receivedTexts.replaceChildren();
  (Array.isArray(summary.whatsapp?.textosRecentes) ? summary.whatsapp.textosRecentes : []).forEach((message) => {
    const item = document.createElement("article");
    const content = document.createElement("p");
    content.textContent = message.texto || "";
    const time = document.createElement("small");
    time.textContent = message.recebidoEm?.toDate?.()
      ?.toLocaleString("pt-BR", {dateStyle: "short", timeStyle: "short"}) || "Data não informada";
    item.append(content, time);
    receivedTexts.append(item);
  });
  if (!receivedTexts.childElementCount) empty(receivedTexts, "Nenhuma mensagem com texto está disponível nesta versão.");

  const insights = document.querySelector("[data-insights]");
  insights.replaceChildren();
  (Array.isArray(narrative.insights) ? narrative.insights : []).forEach((insight) => {
    const item = document.createElement("article");
    if (insight.grupo) {
      const group = document.createElement("span");
      group.className = "retrospective-insight-group";
      group.textContent = {atividades: "Atividades", publico: "Público", leads: "Leads", whatsapp: "WhatsApp", pesquisa: "Pesquisa"}[insight.grupo] || insight.grupo;
      item.append(group);
    }
    const title = document.createElement("h3");
    title.textContent = insight.titulo || "Observação";
    const text = document.createElement("p");
    text.textContent = insight.texto || "";
    item.append(title, text);
    insights.append(item);
  });
  if (!insights.childElementCount) empty(insights, "Os comentários do Gemini aparecerão aqui quando a geração estiver disponível.");
}

function render(data) {
  currentData = data;
  const selectedVersion = versionSelect.value === "latest" ? null : versions.find((item) => item.id === versionSelect.value);
  const displayed = selectedVersion?.data || data;
  const hasSummary = Boolean(displayed?.resumo);
  const hasRetrospective = Boolean(data?.resumo && data?.narrativa);
  content.hidden = !hasSummary;
  if (hasSummary) renderSummary(displayed.resumo, displayed.narrativa || {}, displayed.geradoEm || displayed.resumoGeradoEm);
  generateButton.textContent = hasRetrospective ? "Atualizar análise" : "Gerar com Gemini";
  generateButton.disabled = generating || data?.status === "generating";
  status.textContent = selectedVersion ? "Exibindo uma versão anterior da retrospectiva."
    : data?.status === "generating"
    ? "Calculando os números e escrevendo a retrospectiva..."
    : data?.status === "error" && hasRetrospective ? "A atualização falhou. A última análise concluída foi preservada."
      : hasRetrospective ? "Números calculados a partir dos registros do evento."
      : hasSummary ? "Números calculados. Os comentários do Gemini ainda não estão disponíveis."
        : "A retrospectiva ainda não foi gerada.";
  if (data?.status === "error") setFeedback(data.erro || "Não foi possível gerar a retrospectiva.", "error");
}

function renderVersions() {
  const selected = versionSelect.value;
  versionSelect.replaceChildren(new Option("Mais recente", "latest"));
  versions.filter((item) => item.data.geradoEm?.toMillis?.() !== currentData?.geradoEm?.toMillis?.())
    .forEach((item) => {
      const date = item.data.geradoEm?.toDate?.();
      versionSelect.add(new Option(date ? date.toLocaleString("pt-BR", {dateStyle: "short", timeStyle: "short"}) : item.id, item.id));
    });
  versionSelect.value = [...versionSelect.options].some((option) => option.value === selected) ? selected : "latest";
  versionWrap.hidden = versionSelect.options.length < 2;
  render(currentData);
}

versionSelect.addEventListener("change", () => render(currentData));

generateButton.addEventListener("click", async () => {
  if (generating) return;
  generating = true;
  generateButton.disabled = true;
  status.textContent = "Calculando os números e escrevendo a retrospectiva...";
  setFeedback("");
  try {
    const {functions, functionsModule} = await getFunctionsServices();
    const generate = functionsModule.httpsCallable(functions, "generateEventRetrospective", {timeout: 540000});
    await generate({refresh: Boolean(currentData?.narrativa)});
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
      (snapshot) => { render(snapshot.exists() ? snapshot.data() : null); renderVersions(); },
      (error) => {
        console.error(error);
        status.textContent = "Não foi possível carregar a retrospectiva.";
        setFeedback("Verifique sua conexão e suas permissões.", "error");
      });
    const history = firestoreModule.query(
      firestoreModule.collection(db, "retrospectivasEvento", "grob-experience-2026", "versoes"),
      firestoreModule.orderBy("geradoEm", "desc"), firestoreModule.limit(20));
    firestoreModule.onSnapshot(history,
      (snapshot) => { versions = snapshot.docs.map((document) => ({id: document.id, data: document.data()})); renderVersions(); },
      (error) => console.error("Não foi possível carregar as versões da retrospectiva.", error));
  } catch (error) {
    console.error(error);
    status.textContent = "Não foi possível abrir a retrospectiva.";
    setFeedback("Verifique sua conexão e tente novamente.", "error");
  }
});
