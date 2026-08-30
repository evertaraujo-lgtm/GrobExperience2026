import {createServer} from "node:http";

const port = Number(process.env.TWILIO_TEST_PORT || 8787);
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const apiKeySid = process.env.TWILIO_API_KEY_SID;
const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM;

const credentials = authToken
  ? {username: accountSid, password: authToken}
  : {username: apiKeySid, password: apiKeySecret};

if (!accountSid || !credentials.username || !credentials.password || !whatsappFrom) {
  console.error("Defina TWILIO_ACCOUNT_SID, TWILIO_WHATSAPP_FROM e TWILIO_AUTH_TOKEN (ou TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET).");
  process.exit(1);
}

function reply(response, status, data) {
  response.writeHead(status, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"});
  response.end(JSON.stringify(data));
}

function normalizePhone(value) {
  const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";
  return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : null;
}

createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type"});
    response.end();
    return;
  }
  if (request.method !== "POST" || request.url !== "/send-test") {
    reply(response, 404, {error: "Rota não encontrada."});
    return;
  }

  let rawBody = "";
  for await (const chunk of request) rawBody += chunk;
  let phone;
  try {
    phone = normalizePhone(JSON.parse(rawBody).phone);
  } catch {
    reply(response, 400, {error: "Envie um JSON válido."});
    return;
  }
  if (!phone) {
    reply(response, 400, {error: "Informe um número com DDI e DDD."});
    return;
  }

  const body = new URLSearchParams({
    To: `whatsapp:${phone}`,
    From: whatsappFrom.startsWith("whatsapp:") ? whatsappFrom : `whatsapp:${whatsappFrom}`,
    Body: "Oi, tudo bem?",
  });
  const authorization = Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64");
  try {
    const twilioResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {method: "POST", headers: {Authorization: `Basic ${authorization}`}, body},
    );
    const result = await twilioResponse.json();
    if (!twilioResponse.ok) {
      console.error("Twilio recusou o envio:", result.code, result.message);
      reply(response, 502, {error: result.message || "A Twilio recusou o envio."});
      return;
    }
    console.log(`Mensagem de teste aceita pela Twilio: ${result.sid} → ${phone}`);
    reply(response, 200, {sid: result.sid, to: phone});
  } catch (error) {
    console.error("Falha ao chamar a Twilio:", error.message);
    reply(response, 502, {error: "Não foi possível conectar à API da Twilio."});
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Servidor local Twilio pronto em http://127.0.0.1:${port}`);
});
