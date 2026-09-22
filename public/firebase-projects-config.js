/**
 * 青雲問道 Firebase 網頁設定：只要把 Firebase Console > 專案設定 > 你的應用程式
 * 顯示的 firebaseConfig 欄位，分別貼到 BD / C。
 *
 * A = question-learning（既有登入、玩家、財產），不需要在這裡重新填寫。
 * BD = 洞天 / 公開圖鑑；C = 鬥法房間。
 *
 * 這裡是 Web SDK 公開設定，不是 Admin SDK 私密金鑰！
 * 只填設定不會搬移資料或啟用跨專案讀寫，避免未授權或空資料庫影響玩家。
 */
export const firebaseProjectConfigs = {
  BD: {
    apiKey: "AIzaSyBNa5xC6cFuYplPBbbgngnoqTSSjIo_en0",
    authDomain: "xiuxian-dongtian-bd.firebaseapp.com",
    projectId: "xiuxian-dongtian-bd",
    storageBucket: "xiuxian-dongtian-bd.firebasestorage.app",
    messagingSenderId: "393166571020",
    appId: "1:393166571020:web:fff4eb01a04077a1991029"
  },

  C: {
    apiKey: "AIzaSyBArctG8Ngm2ajLqhikfA-Vb6X-8Mj-uoo",
    authDomain: "xiuxian-battle.firebaseapp.com",
    projectId: "xiuxian-battle",
    storageBucket: "xiuxian-battle.firebasestorage.app",
    messagingSenderId: "886185761315",
    appId: "1:886185761315:web:cb436c55525749aa876f96"
    // measurementId: '', // Console 有提供時才需要
  },
};
