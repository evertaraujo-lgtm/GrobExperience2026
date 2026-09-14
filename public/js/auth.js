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
