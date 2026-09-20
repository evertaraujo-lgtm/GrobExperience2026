import {getAuthServices, getFirestoreServices, getFunctionsServices} from "/js/firebase-client.js";
import {clearOfflineProfile, getOfflineProfile, saveOfflineProfile} from "/js/offline-profile.js";

const page = document.body.dataset.authPage;
const form = document.querySelector("[data-login-form]");
const email = document.querySelector("[data-email]");
const password = document.querySelector("[data-password]");
const submit = document.querySelector("[data-submit]");
const feedback = document.querySelector("[data-feedback]");
const logout = document.querySelector("[data-logout]");
const assistantPage = document.body.dataset.assistantPage === "true";
const leadCollectorPage = document.body.dataset.leadCollectorPage === "true";
const adminPage = document.body.dataset.adminPage === "true";

const ADMIN_NAVIGATION = [
  {
    title: "Pessoas e inscrições",
    items: [
      {label: "Pré-inscritos", description: "Convites e confirmações", href: "/app/", icon: '<path d="M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6m-3-3h6"/>'},
      {label: "Inscritos", description: "Lista consolidada do evento", href: "/inscritos/", icon: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'},
      {label: "Participantes 4 Events", description: "Base importada da plataforma", href: "/participantes-4events/", icon: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a6 6 0 0 1 12 0v2m2-13h4m-2-2v4m-2 6h4"/>'},
    ],
  },
  {
    title: "Operação do evento",
    items: [
      {label: "Gestão do evento", description: "Atividades e assistentes", href: "/gestao-evento/", icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2 2-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V20h-2.8v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-2-2 .06-.06A1.7 1.7 0 0 0 7.52 15a1.7 1.7 0 0 0-1.55-1H5.9v-2.8h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2-2 .06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1-1.55V4.9h2.8v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 2 2-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.55 1h.09V14h-.09a1.7 1.7 0 0 0-1.57 1Z"/>'},
      {label: "Sorteio de brindes", description: "Modo teste, sorteio final e telão", href: "/sorteio-4events/", icon: '<path d="M20 12v9H4v-9M2 7h20v5H2zM12 7v14M12 7H7.5a2.5 2.5 0 1 1 0-5C10.5 2 12 7 12 7Zm0 0h4.5a2.5 2.5 0 1 0 0-5C13.5 2 12 7 12 7Z"/>'},
      {label: "Participação", description: "Presença nas atividades", href: "/gestao-evento/participacao/", icon: '<path d="M4 19V9m5 10V5m5 14v-7m5 7V3"/><path d="M2 21h20"/>'},
      {label: "Coleta de leads", description: "Equipe e leads coletados", href: "/coleta-leads/", icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 5V3h8v2m-5 6h2m-7 4h12"/>'},
      {label: "Perguntas dos leads", description: "Roteiro da coleta comercial", href: "/coleta-leads/perguntas/", icon: '<path d="M9 5h11M9 12h11M9 19h11"/><circle cx="4" cy="5" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="19" r="1"/>'},
      {label: "Pesquisa de satisfação", description: "Formulário, QR Code e respostas", href: "/gestao-evento/pesquisa-satisfacao/", icon: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="m12 7 1.2 2.4 2.8.4-2 2 .5 2.8-2.5-1.3-2.5 1.3.5-2.8-2-2 2.8-.4Z"/>'},
    ],
  },
  {
    title: "Comunicação e chegada",
    items: [
      {label: "Notificações de chegada", description: "Presença e avisos da recepção", href: "/4events/", icon: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>'},
      {label: "Lembrete do aplicativo", description: "Lotes diários de até 250 mensagens", href: "/lembrete-presenca/", accent: "orange", icon: '<rect x="5" y="2" width="11" height="20" rx="2"/><path d="M8 6h5m-4 12h3M18 8l4 4-4 4m4-4H12"/>'},
      {label: "Participação chegando", description: "Campanha protegida em lotes de 250", href: "/participacao-chegando/", accent: "orange", icon: '<path d="M21 11.5a8.1 8.1 0 0 1-9 8 8.3 8.3 0 0 1-3.47-.9L3 20l1.43-4.18A8 8 0 1 1 21 11.5Z"/><path d="m9 12 2 2 4-5"/>'},
      {label: "Eventos WhatsApp", description: "Mensagens e eventos recebidos", href: "/webhooks/", icon: '<path d="M21 11.5a8.1 8.1 0 0 1-9 8 8.3 8.3 0 0 1-3.47-.9L3 20l1.43-4.18A8 8 0 1 1 21 11.5Z"/><path d="M8 9c1 4 3 6 7 7"/>'},
    ],
  },
];

function normalizedPath(value) {
  const path = new URL(value, window.location.origin).pathname.replace(/\/+$/, "");
  return path || "/";
}

function renderAdminNavigation() {
  if (page !== "protected" || document.querySelector("[data-admin-navigation]")) return;
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  const currentPath = normalizedPath(window.location.pathname);
  const trigger = document.createElement("button");
  trigger.className = "back-link admin-menu-trigger";
  trigger.type = "button";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg><span>Menu administrador</span>';

  const dialog = document.createElement("dialog");
  dialog.className = "admin-navigation";
  dialog.dataset.adminNavigation = "";
  dialog.setAttribute("aria-labelledby", "admin-navigation-title");
  const panel = document.createElement("section");
  panel.className = "admin-navigation-panel";
  panel.innerHTML = '<header class="admin-navigation-header"><div><p class="eyebrow">Acesso rápido</p><h2 id="admin-navigation-title">Menu administrador</h2></div><button class="admin-navigation-close" type="button" aria-label="Fechar menu">×</button></header>';
  const content = document.createElement("nav");
  content.className = "admin-navigation-content";
  content.setAttribute("aria-label", "Telas administrativas");
  ADMIN_NAVIGATION.forEach((group) => {
    const section = document.createElement("section");
    section.className = "admin-navigation-group";
    const heading = document.createElement("h3");
    heading.textContent = group.title;
    const links = document.createElement("div");
    links.className = "admin-navigation-links";
    group.items.forEach((item) => {
      const link = document.createElement("a");
      link.className = "admin-navigation-link";
      link.href = item.href;
      if (normalizedPath(item.href) === currentPath) link.setAttribute("aria-current", "page");
      const iconAccent = item.accent ? ` admin-navigation-icon-${item.accent}` : "";
      link.innerHTML = `<span class="admin-navigation-icon${iconAccent}"><svg viewBox="0 0 24 24" aria-hidden="true">${item.icon}</svg></span><span class="admin-navigation-copy"><strong>${item.label}</strong><small>${item.description}</small></span><span class="admin-navigation-arrow" aria-hidden="true">›</span>`;
      links.append(link);
    });
    section.append(heading, links);
    content.append(section);
  });
  panel.append(content);
  dialog.append(panel);
  document.body.append(dialog);

  const topbarActions = document.createElement("div");
  topbarActions.className = "admin-topbar-actions";
  const logoutButton = topbar.querySelector("[data-logout]");
  if (logoutButton) {
    topbar.insertBefore(topbarActions, logoutButton);
    topbarActions.append(trigger, logoutButton);
  } else {
    topbarActions.append(trigger);
    topbar.append(topbarActions);
  }
  const close = dialog.querySelector(".admin-navigation-close");
  trigger.addEventListener("click", () => dialog.showModal());
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

const ADMIN_ACTION_ICON_RULES = [
  {test: /^Voltar\b/i, icon: '<path d="M19 12H5m6-6-6 6 6 6"/>'},
  {test: /Notificações de chegada/i, icon: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>'},
  {test: /Dashboard de participação/i, icon: '<path d="M4 19V9m5 10V5m5 14v-7m5 7V3"/><path d="M2 21h20"/>'},
  {test: /Pesquisa de satisfação/i, icon: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="m12 7 1.2 2.4 2.8.4-2 2 .5 2.8-2.5-1.3-2.5 1.3.5-2.8-2-2 2.8-.4Z"/>'},
  {test: /Sorteio de brindes/i, icon: '<path d="M20 12v9H4v-9M2 7h20v5H2zM12 7v14M12 7H7.5a2.5 2.5 0 1 1 0-5C10.5 2 12 7 12 7Zm0 0h4.5a2.5 2.5 0 1 0 0-5C13.5 2 12 7 12 7Z"/>'},
  {test: /Editar perguntas/i, icon: '<path d="M9 5h11M9 12h7M9 19h4"/><path d="m17 16 3-3 2 2-3 3-3 1Z"/><circle cx="4" cy="5" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="19" r="1"/>'},
  {test: /Gerar QR Code/i, icon: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zm3 3h4v4h-4zm1-3h3"/>'},
  {test: /Checar presença/i, icon: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a6 6 0 0 1 10.5-4M16 18l2 2 4-5"/>'},
  {test: /^Buscar\b/i, icon: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>'},
  {test: /^Importar\b/i, icon: '<path d="M12 21V9m-5 5 5-5 5 5"/><path d="M5 4h14"/>'},
  {test: /^Envio de teste$/i, icon: '<rect x="5" y="2" width="11" height="20" rx="2"/><path d="M8 6h5m-4 12h3M18 8l4 4-4 4m4-4H12"/>'},
  {test: /^Colunas$/i, icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m6-16v16"/>'},
  {test: /^Exportar\b/i, icon: '<path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 21h14"/>'},
  {test: /^Atualizar\b/i, icon: '<path d="M20 11a8 8 0 1 0 2 5.5M20 4v7h-7"/>'},
  {test: /^Nova atividade$/i, icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18m-9 3v6m-3-3h6"/>'},
  {test: /^Novo assistente$/i, icon: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0m4-12v6m-3-3h6"/>'},
  {test: /^Novo inscrito$/i, icon: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0m4-12v6m-3-3h6"/>'},
  {test: /^Novo atendimento$/i, icon: '<path d="M12 5v14M5 12h14"/>'},
  {test: /^(Excluir|Zona de perigo)/i, icon: '<path d="M3 6h18M8 6V4h8v2m3 0-1 15H6L5 6m5 4v7m4-7v7"/>'},
];

function enhanceAdminToolbarActions() {
  const actions = document.querySelectorAll(".dashboard-toolbar .toolbar-actions > .back-link, .webhooks-toolbar > .back-link");
  actions.forEach((action) => {
    if (action.querySelector("svg") || action.dataset.adminIconified === "true") return;
    const label = action.textContent.replace(/\s+/g, " ").trim();
    const rule = ADMIN_ACTION_ICON_RULES.find((item) => item.test.test(label));
    if (!label || !rule) return;
    action.dataset.adminIconified = "true";
    action.classList.add("admin-toolbar-icon");
    action.parentElement?.classList.add("admin-icon-toolbar");
    const renderIcon = (currentLabel) => {
      action.setAttribute("aria-label", currentLabel);
      action.setAttribute("title", currentLabel);
      action.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${rule.icon}</svg><span class="admin-toolbar-label">${currentLabel}</span>`;
    };
    renderIcon(label);
    const observer = new MutationObserver(() => {
      if (action.querySelector("svg")) return;
      renderIcon(action.textContent.replace(/\s+/g, " ").trim() || label);
    });
    observer.observe(action, {childList: true, characterData: true, subtree: true});
  });
}

function setFeedback(message, state = "neutral") {
  if (!feedback) return;
  feedback.textContent = message;
  feedback.dataset.state = state;
}

function errorMessage(error) {
  switch (error?.code) {
    case "auth/invalid-email": return "O e-mail informado não é válido.";
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password": return "E-mail ou senha inválidos. Revise os dados e tente novamente.";
    case "auth/too-many-requests": return "Muitas tentativas seguidas. Aguarde um instante antes de tentar novamente.";
    case "auth/network-request-failed": return "Falha de rede ao tentar autenticar. Verifique sua conexão.";
    default: return "Não foi possível concluir o login agora. Tente novamente em instantes.";
  }
}

try {
  const {auth, authModule} = await getAuthServices();

  authModule.onAuthStateChanged(auth, async (user) => {
    let isAssistant = false;
    let isLeadSeller = false;
    let isAdmin = false;
    if (user) {
      let profileData = null;
      try {
        const {db, firestoreModule} = await getFirestoreServices();
        const profile = await firestoreModule.getDoc(firestoreModule.doc(db, "users", user.uid));
        if (profile.exists()) {
          profileData = profile.data();
          saveOfflineProfile(user.uid, profileData);
        }
      } catch (error) {
        profileData = getOfflineProfile(user.uid);
        if (!profileData) console.warn("Não foi possível consultar o perfil do usuário.", error);
      }
      isAdmin = profileData?.active !== false && profileData?.roles?.admin === true;
      isAssistant = !isAdmin && profileData?.active !== false && profileData?.roles?.assistenteColeta === true;
      isLeadSeller = !isAdmin && profileData?.active !== false && profileData?.roles?.vendedor === true;
      if (isAdmin) {
        renderAdminNavigation();
        enhanceAdminToolbarActions();
        try {
          const {functions, functionsModule} = await getFunctionsServices();
          await functionsModule.httpsCallable(functions, "consolidateCollectionStaff")();
        } catch (error) {
          console.error("Não foi possível consolidar os perfis de coleta.", error);
        }
      }
    }
    if (page === "gate") {
      window.location.replace(user ? (isAssistant ? "/coleta-atividades/" : isLeadSeller && !isAdmin ? "/coleta-leads/" : "/participantes-4events/") : "/login/");
      return;
    }
    if (page === "login" && user) window.location.replace(isAssistant ? "/coleta-atividades/" : isLeadSeller && !isAdmin ? "/coleta-leads/" : "/participantes-4events/");
    if (page === "protected" && !user) window.location.replace("/login/");
    if (page === "protected" && user && adminPage && !isAdmin) window.location.replace("/participantes-4events/");
    if (page === "protected" && user && isAssistant && !assistantPage) window.location.replace("/coleta-atividades/");
    if (page === "protected" && user && !isAssistant && assistantPage) window.location.replace("/app/");
    if (page === "protected" && user && isLeadSeller && !isAdmin && !leadCollectorPage) window.location.replace("/coleta-leads/");
    if (page === "protected" && user && leadCollectorPage && !isAdmin && !isLeadSeller) window.location.replace("/app/");
    const name = document.querySelector("[data-user-name]");
    if (page === "protected" && user && name) {
      name.textContent = user.displayName || user.email || "participante";
    }
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    submit.textContent = "Entrando...";
    setFeedback("Validando suas credenciais...");
    try {
      await authModule.signInWithEmailAndPassword(auth, email.value.trim(), password.value);
      setFeedback("Login realizado. Abrindo sua área...", "success");
    } catch (error) {
      setFeedback(errorMessage(error), "error");
      submit.disabled = false;
      submit.textContent = "Entrar";
      password.focus();
    }
  });

  logout?.addEventListener("click", () => {
    if (auth.currentUser) clearOfflineProfile(auth.currentUser.uid);
    authModule.signOut(auth);
  });
} catch (error) {
  console.error("Falha ao iniciar o Firebase", error);
  setFeedback("Não foi possível conectar ao Firebase. Tente novamente em instantes.", "error");
}
