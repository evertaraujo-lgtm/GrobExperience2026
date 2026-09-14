import {Firestore} from "firebase-admin/firestore";

export type FourEventsParticipant = {
  id: string;
  data: Record<string, unknown>;
};

export function normalize4EventsQrCode(value: unknown) {
  return String(value ?? "").trim();
}

// Esta busca fica separada das funções de tela para poder ser reutilizada por
// qualquer fluxo que receba um QR Code da 4 Events.
export async function find4EventsParticipantByQrCode(
  firestore: Firestore,
  value: unknown,
): Promise<FourEventsParticipant | null> {
  const qrCode = normalize4EventsQrCode(value);
  if (!qrCode) return null;

  const snapshot = await firestore.collection("participantes4Events")
    .where("qrCode", "==", qrCode)
    .limit(1)
    .get();
  if (snapshot.empty) return null;

  const document = snapshot.docs[0];
  return {id: document.id, data: document.data() as Record<string, unknown>};
}
