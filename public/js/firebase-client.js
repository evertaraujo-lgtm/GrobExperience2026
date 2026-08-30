const firebaseConfig = {
  apiKey: "AIzaSyBEqAklUUE_c3m1SY0OJS3h3JyFYSX7IeE",
  authDomain: "grobexperience.firebaseapp.com",
  projectId: "grobexperience",
  storageBucket: "grobexperience.firebasestorage.app",
  messagingSenderId: "588702495654",
  appId: "1:588702495654:web:61583a73059c8cc5df1567",
};

let authPromise;
let firestorePromise;
let functionsPromise;

export function getAuthServices() {
  if (!authPromise) {
    authPromise = Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js"),
    ]).then(([appModule, authModule]) => {
      const app = appModule.getApps().length
        ? appModule.getApp()
        : appModule.initializeApp(firebaseConfig);
      return {auth: authModule.getAuth(app), authModule};
    });
  }
  return authPromise;
}

export function getFirestoreServices() {
  if (!firestorePromise) {
    firestorePromise = Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js"),
    ]).then(([appModule, firestoreModule]) => {
      const app = appModule.getApps().length
        ? appModule.getApp()
        : appModule.initializeApp(firebaseConfig);
      return {db: firestoreModule.getFirestore(app), firestoreModule};
    });
  }
  return firestorePromise;
}

export function getFunctionsServices() {
  if (!functionsPromise) {
    functionsPromise = Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js"),
    ]).then(([appModule, functionsModule]) => {
      const app = appModule.getApps().length
        ? appModule.getApp()
        : appModule.initializeApp(firebaseConfig);
      return {functions: functionsModule.getFunctions(app), functionsModule};
    });
  }
  return functionsPromise;
}
