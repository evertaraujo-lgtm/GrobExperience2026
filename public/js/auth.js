import {getAuthServices, getFirestoreServices} from "/js/firebase-client.js";

const page = document.body.dataset.authPage;
const form = document.querySelector("[data-login-form]");
const email = document.querySelector("[data-email]");
const password = document.querySelector("[data-password]");
const submit = document.querySelector("[data-submit]");
const feedback = document.querySelector("[data-feedback]");
const logout = document.querySelector("[data-logout]");
const assistantPage = document.body.dataset.assistantPage === "true";

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
    if (user) {
      const {db, firestoreModule} = await getFirestoreServices();
      const assistant = await firestoreModule.getDoc(firestoreModule.doc(db, "coletaAtividadesAssistentes", user.uid));
      isAssistant = assistant.exists() && assistant.data().ativo === true;
    }
    if (page === "gate") {
      window.location.replace(user ? (isAssistant ? "/coleta-atividades/" : "/app/") : "/login/");
      return;
    }
    if (page === "login" && user) window.location.replace(isAssistant ? "/coleta-atividades/" : "/app/");
    if (page === "protected" && !user) window.location.replace("/login/");
    if (page === "protected" && user && isAssistant && !assistantPage) window.location.replace("/coleta-atividades/");
    if (page === "protected" && user && !isAssistant && assistantPage) window.location.replace("/app/");
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

  logout?.addEventListener("click", () => authModule.signOut(auth));
} catch (error) {
  console.error("Falha ao iniciar o Firebase", error);
  setFeedback("Não foi possível conectar ao Firebase. Tente novamente em instantes.", "error");
}
