import {initializeApp} from "firebase-admin/app";
import {onRequest} from "firebase-functions/https";

import {previewWhatsAppBatch, sendWhatsAppBatch} from "./envio-em-lote.js";
import {marketingMessageStats, sendSelecaoDataMarketing} from "./envio-selecao-data.js";
import {importPreInscritos} from "./pre-inscritos.js";
import {repopulatePreInscritoMessages} from "./mensagens.js";
import {backfillPreInscritoSortOrder} from "./ordenacao.js";
import {check4EventsPresence, search4Events} from "./check-4events.js";
import {sendWhatsAppTemplate} from "./send-whatsapp-template.js";
import {whatsappWebhook} from "./whatsapp-webhook.js";

initializeApp();

export const health = onRequest((_request, response) => {
  response.status(200).json({status: "ok"});
});

export {
  backfillPreInscritoSortOrder,
  check4EventsPresence,
  importPreInscritos,
  marketingMessageStats,
  previewWhatsAppBatch,
  repopulatePreInscritoMessages,
  sendWhatsAppBatch,
  sendSelecaoDataMarketing,
  search4Events,
  sendWhatsAppTemplate,
  whatsappWebhook,
};
