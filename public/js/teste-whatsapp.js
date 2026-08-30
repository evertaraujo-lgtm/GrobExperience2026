const form = document.querySelector("[data-whatsapp-test-form]");
const phone = document.querySelector("[data-whatsapp-number]");
const submit = document.querySelector("[data-submit]");
const feedback = document.querySelector("[data-feedback]");

function setFeedback(message, state = "neutral") {
  feedback.textContent = message;
  feedback.dataset.state = state;
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const digits = phone.value.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    setFeedback("Informe o número com DDI e DDD, por exemplo: +55 11 99999-9999.", "error");
    phone.focus();
    return;
  }
  submit.disabled = true;
  submit.textContent = "Enviando pela Twilio...";
  setFeedback("Chamando a API da Twilio pelo servidor local...");
  try {
    const response = await fetch("http://127.0.0.1:8787/send-test", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({phone: phone.value.trim()}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setFeedback(`Mensagem aceita pela Twilio para ${result.to}. Código: ${result.sid}`, "success");
  } catch (error) {
    setFeedback(error.message || "Não foi possível chamar o servidor local da Twilio.", "error");
  } finally {
    submit.disabled = false;
    submit.textContent = "Enviar “Oi, tudo bem?”";
  }
});
