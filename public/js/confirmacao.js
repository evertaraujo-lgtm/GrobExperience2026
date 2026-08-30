import {getFirestoreServices} from "/js/firebase-client.js";

const token = new URLSearchParams(window.location.search).get("token");
const loading = document.querySelector("[data-loading]");
const content = document.querySelector("[data-content]");
const success = document.querySelector("[data-success]");
const error = document.querySelector("[data-error]");
const name = document.querySelector("[data-name]");
const form = document.querySelector("[data-date-form]");
const submit = document.querySelector("[data-submit]");
const successDate = document.querySelector("[data-success-date]");

function formatDate(value) {
  return {
    "2026-09-22": "22 de setembro",
    "2026-09-23": "23 de setembro",
    "2026-09-24": "24 de setembro",
  }[value] || "não informada";
}

function showSuccess(date) {
  successDate.textContent = formatDate(date);
  loading.hidden = true;
  content.hidden = true;
  success.hidden = false;
}

function showError(message) {
  loading.hidden = true;
  content.hidden = true;
  error.hidden = false;
  error.textContent = message;
}

if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
  showError("Este link não é válido. Solicite um novo convite.");
} else {
  try {
    const {db, firestoreModule} = await getFirestoreServices();
    const invitation = firestoreModule.doc(db, "linksPublicos", token);
    const snapshot = await firestoreModule.getDoc(invitation);

    if (!snapshot.exists()) {
      showError("Este convite não foi encontrado. Solicite um novo link.");
    } else if (snapshot.data().status === "confirmado") {
      showSuccess(snapshot.data().dataSelecionada);
    } else {
      name.textContent = snapshot.data().nome || "participante";
      loading.hidden = true;
      content.hidden = false;

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const date = new FormData(form).get("data");
        submit.disabled = true;
        submit.textContent = "Confirmando...";
        try {
          const batch = firestoreModule.writeBatch(db);
          batch.update(invitation, {
            dataSelecionada: date,
            status: "confirmado",
            confirmadoEm: firestoreModule.serverTimestamp(),
          });
          batch.update(firestoreModule.doc(db, "preInscritos", snapshot.data().preInscritoId), {
            status: "confirmado",
            atualizadoEm: firestoreModule.serverTimestamp(),
          });
          await batch.commit();
          showSuccess(date);
        } catch (updateError) {
          console.error(updateError);
          showError("Não foi possível registrar sua escolha. Tente novamente.");
        }
      });
    }
  } catch (loadError) {
    console.error(loadError);
    showError("Não foi possível carregar seu convite. Tente novamente.");
  }
}
