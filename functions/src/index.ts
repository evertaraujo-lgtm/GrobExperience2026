import {initializeApp} from "firebase-admin/app";
import {onRequest} from "firebase-functions/https";

import {previewWhatsAppBatch, sendWhatsAppBatch} from "./envio-em-lote.js";
import {importPreInscritos} from "./pre-inscritos.js";
import {repopulatePreInscritoMessages} from "./mensagens.js";
import {backfillPreInscritoSortOrder} from "./ordenacao.js";
import {sendWhatsAppTemplate} from "./send-whatsapp-template.js";
import {whatsappWebhook} from "./whatsapp-webhook.js";

initializeApp();

export const health = onRequest((_request, response) => {
  response.status(200).json({status: "ok"});
});

export {
  backfillPreInscritoSortOrder,
  importPreInscritos,
  previewWhatsAppBatch,
  repopulatePreInscritoMessages,
  sendWhatsAppBatch,
  sendWhatsAppTemplate,
  whatsappWebhook,
};
