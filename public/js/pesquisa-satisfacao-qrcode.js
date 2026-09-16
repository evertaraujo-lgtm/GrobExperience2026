const SURVEY_URL = "https://grobexperience.web.app/pesquisa-satisfacao/?id=349d22b2adf564261e3d8a713d90e9b55b24521568030cc6";

const image = document.querySelector("[data-qr-image]");
const loading = document.querySelector("[data-qr-loading]");
const surveyLink = document.querySelector("[data-survey-link]");
const copyButton = document.querySelector("[data-copy-link]");
const feedback = document.querySelector("[data-feedback]");

surveyLink.href = SURVEY_URL;

function setFeedback(message, state = "neutral") {
  feedback.textContent = message;
  feedback.dataset.state = state;
}

async function renderQrCode() {
  try {
    const qrLibrary = await import("https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm");
    const toDataURL = qrLibrary.toDataURL || qrLibrary.default?.toDataURL;
    if (!toDataURL) throw new Error("Gerador de QR Code indisponível");
    image.src = await toDataURL(SURVEY_URL, {
      width: 900,
      margin: 2,
      errorCorrectionLevel: "M",
      color: {dark: "#051c3e", light: "#ffffff"},
    });
    image.hidden = false;
    loading.hidden = true;
  } catch (error) {
    console.error(error);
    loading.textContent = "Não foi possível gerar o QR Code agora.";
    setFeedback("Use o botão “Abrir pesquisa” para acessar o formulário.", "error");
  }
}

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(SURVEY_URL);
    setFeedback("Link copiado.", "success");
  } catch (error) {
    const temporary = document.createElement("textarea");
    temporary.value = SURVEY_URL;
    temporary.setAttribute("readonly", "");
    temporary.style.position = "fixed";
    temporary.style.opacity = "0";
    document.body.append(temporary);
    temporary.select();
    const copied = document.execCommand("copy");
    temporary.remove();
    setFeedback(copied ? "Link copiado." : "Não foi possível copiar. Use o botão “Abrir pesquisa”.", copied ? "success" : "error");
  }
});

document.querySelector("[data-print]").addEventListener("click", () => window.print());

await renderQrCode();
