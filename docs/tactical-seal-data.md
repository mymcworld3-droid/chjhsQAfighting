# 體力分支／問道試煉：封印陣眼資料契約（第一階段）

此文件記錄 `stamina-battle` 分支封印關卡 **layoutVersion 4** 的既有規則，
並定義之後「陣眼圖片、效果範圍、情報面板」必須共用的單一資料來源。
本階段只整理資料與最小化規則參數引用，**不改變目前的戰鬥與介面操作**。

## 四種陣眼

| kind | 顯示名稱 | 範圍 | 既有戰鬥效果 | 破除後 |
| --- | --- | --- | --- | --- |
| `shield` | 護靈陣眼 | 曼哈頓距離 ≤3 | 對範圍內靈獸造成的非穿透傷害乘上 0.65 | 該座陣眼的減傷來源消失 |
| `hazard` | 妖煞陣眼 | 動態預告格，沒有固定三格半徑 | 偶數回合在玩家目前地格留下預告；回合結束仍站在該格時，失去最大生命 12%（至少 1 點） | 最後一座妖煞陣眼被破除時清除現有預告 |
| `rage` | 御獸陣眼 | 曼哈頓距離 ≤3 | 範圍內靈獸造成傷害乘上 1.25 | 該座陣眼的增傷來源消失 |
| `maze` | 迷蹤陣眼 | 指向連動石障，沒有固定光環 | 關聯一個指定石障（若有配置） | 陣眼破除後移除該石障 |

- 以上「距離」使用 `abs(dx)+abs(dy)`，**不是圓形、方形或視線距離**；護靈與御獸光環不會被牆阻斷。
- 同一種增益若有多座相互重疊，現有實作使用 `some(...)` 判定，**不累加**。
- 陣眼是位於一個格子的固定可攻擊目標，初始耐久 2，符合攻擊命中時減少 1。生命歸零後 `activated=true`。
- 既有第三版封印關卡使用「走到陣眼格上啟動」規則；**不能直接套用第四版可攻擊陣眼描述**。
- 原有答題、技能耗體、回合與攻擊命中計算維持不變。

## 共用 API

檔案：`public/cultivation/tactical-rules.js`，同時用於 Node 伺服器與瀏覽器端
`QATactical`。

| API | 用途 |
| --- | --- |
| `SEAL_TYPES` | 不可變資料：類型、名稱、標籤、顏色、效果文字、範圍語義、機制參數、破除描述與提示 |
| `SEAL_MAX_DURABILITY`、`SEAL_HIT_DAMAGE` | 關卡初始化與命中扣除共用的耐久規則 |
| `sealDefinition(kind)` | 取得單一類型定義；未知類型回傳 `null` |
| `sealInfo(state, {x,y})` | 取得某座陣眼即時快照，包含耐久、是否仍可攻擊及連動障礙；無效／舊版狀態回傳 `null` |
| `sealInfos(state)` | 列出本場全部第四版陣眼快照；非第四版回傳空陣列 |
| `sealEffectCells(state, {x,y})` | 護靈／御獸回傳有效曼哈頓範圍；妖煞回傳實際預告格；迷蹤回傳空陣列 |

### 情報介面接入範例

```js
const seals=QATactical.sealInfos(battle);
const selected=QATactical.sealInfo(battle,{x:4,y:2});
const influence=QATactical.sealEffectCells(battle,{x:4,y:2});
```

不要把 `sealInfo` 的計算結果寫回 `battle.objective`。
快照中 `range` 與 `gate` 是副本資料，不直接引用戰場狀態；適合在介面短暫顯示。

### 後續階段注意事項

1. 渲染「影響範圍」時區分 `range.kind`：`manhattan`、`warning`、`linked-block`；不可將後兩者硬畫成三格菱形。
2. 妖煞的預告範圍以 `objective.hazards` 當下資料為準；若沒有預告，不畫危險格。
3. 效果範圍、角色預告、技能瞄準範圍與角色立繪應分不同 Canvas 圖層，危險紅框優先。
4. 情報面板與首次教學不能代替伺服器端的實際技能命中驗證。
5. 陣眼受損／破除應依 `hp/maxHp/active` 決定，不修改伺服器的結算時機。
6. 圖片與介面變更安排在第二階段以後；第一階段只提供資料基礎。

測試：`node --test tests/tactical-seal-metadata.test.cjs tests/tactical-layout-v4.test.cjs`。
