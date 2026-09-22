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
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
    // measurementId: '', // Console 有提供時才需要
  },

  C: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
    // measurementId: '', // Console 有提供時才需要
  },
};
