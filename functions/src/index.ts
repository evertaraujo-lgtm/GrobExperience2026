import {initializeApp} from "firebase-admin/app";
import {onRequest} from "firebase-functions/https";

import {previewWhatsAppBatch, sendWhatsAppBatch} from "./envio-em-lote.js";
import {approveWhatsAppCampaignTest, importWhatsAppCampaignParticipants, previewWhatsAppCampaignBatch, sendWhatsAppCampaignBatch, sendWhatsAppCampaignTest, updateWhatsAppCampaignNameComplement} from "./campanhas-whatsapp.js";
import {marketingMessageStats, sendSelecaoDataMarketing} from "./envio-selecao-data.js";
import {importPreInscritos} from "./pre-inscritos.js";
import {importPresenceReminderParticipants, previewPresenceReminderDay, sendPresenceReminderDay, sendPresenceReminderTest} from "./lembrete-presenca.js";
import {repopulatePreInscritoMessages} from "./mensagens.js";
import {backfillPreInscritoSortOrder} from "./ordenacao.js";
import {check4EventsPresence, configure4EventsPresenceAutomation, scheduled4EventsPresenceCheck, search4Events} from "./check-4events.js";
import {consolidateCollectionStaff, createCollectionAssistant, listCollectionStaff, removeCollectionAssistant} from "./gestao-atividades.js";
import {createLeadSeller, download4EventsParticipantIndex, get4EventsParticipantByQrCode, removeLeadSeller, saveLead} from "./coleta-leads.js";
import {sendWhatsAppTemplate} from "./send-whatsapp-template.js";
import {import4EventsParticipantComplements, list4EventsParticipants, sync4EventsParticipants} from "./sync-4events-participants.js";
import {clear4EventsRaffleFinalHistory, clear4EventsRaffleTestHistory, create4EventsRaffleTestSession, draw4EventsRaffle, get4EventsRafflePrizes, get4EventsRaffleState, save4EventsRafflePrize, set4EventsRaffleTestPresence} from "./sorteio-4events.js";
import {whatsappWebhook} from "./whatsapp-webhook.js";

initializeApp();

export const health = onRequest((_request, response) => {
  response.status(200).json({status: "ok"});
});

export {
  approveWhatsAppCampaignTest,
  backfillPreInscritoSortOrder,
  check4EventsPresence,
  clear4EventsRaffleFinalHistory,
  clear4EventsRaffleTestHistory,
  configure4EventsPresenceAutomation,
  consolidateCollectionStaff,
  create4EventsRaffleTestSession,
  createCollectionAssistant,
  createLeadSeller,
  download4EventsParticipantIndex,
  draw4EventsRaffle,
  importPreInscritos,
  importWhatsAppCampaignParticipants,
  importPresenceReminderParticipants,
  import4EventsParticipantComplements,
  get4EventsParticipantByQrCode,
  get4EventsRafflePrizes,
  get4EventsRaffleState,
  listCollectionStaff,
  list4EventsParticipants,
  marketingMessageStats,
  previewWhatsAppBatch,
  previewWhatsAppCampaignBatch,
  previewPresenceReminderDay,
  repopulatePreInscritoMessages,
  removeCollectionAssistant,
  removeLeadSeller,
  saveLead,
  save4EventsRafflePrize,
  sendWhatsAppBatch,
  sendWhatsAppCampaignBatch,
  sendWhatsAppCampaignTest,
  sendPresenceReminderDay,
  sendPresenceReminderTest,
  sendSelecaoDataMarketing,
  set4EventsRaffleTestPresence,
  search4Events,
  scheduled4EventsPresenceCheck,
  sendWhatsAppTemplate,
  sync4EventsParticipants,
  updateWhatsAppCampaignNameComplement,
  whatsappWebhook,
};
