const PREFIX = "grob-offline-profile:";

function storageKey(userId) {
  return PREFIX + userId;
}

export function saveOfflineProfile(userId, profile) {
  if (!userId || !profile || typeof profile !== "object") return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify({
      active: profile.active !== false,
      roles: profile.roles && typeof profile.roles === "object" ? profile.roles : {},
      savedAt: Date.now(),
    }));
  } catch (error) {
    console.warn("Não foi possível guardar o perfil para uso offline.", error);
  }
}

export function getOfflineProfile(userId) {
  try {
    const cached = JSON.parse(localStorage.getItem(storageKey(userId)) || "null");
    if (!cached || typeof cached !== "object" || cached.active === false || !cached.roles || typeof cached.roles !== "object") return null;
    return cached;
  } catch (error) {
    console.warn("Não foi possível ler o perfil offline.", error);
    return null;
  }
}

export function clearOfflineProfile(userId) {
  try {
    localStorage.removeItem(storageKey(userId));
  } catch (error) {
    console.warn("Não foi possível limpar o perfil offline.", error);
  }
}
