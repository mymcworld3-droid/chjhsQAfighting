# 共用題目繪圖引擎 V1
基準：main b1e198f9。此階段只建立跨科引擎及契約，不開啟尚未驗收的 AI 出題功能。
所有科目使用相同資料格式，API 按題目需要自由組合，不設圖表比例、不強制生成、不另建各科模板。

## 格式
- table: {type:"table", title?, headers:[string], rows:[[string|number]]}
- plot: {type:"plot", title?, x:[min,max], y:[min,max], xLabel?, yLabel?, axes?:false, ticks?:2..10, layers:[...]}
- layer: function {expr,domain?,samples?}; parametric {xExpr,yExpr,domain,samples?}; polyline/polygon/scatter/bars {points:[[x,y]],width?,base?}; segment/arrow {from:[x,y],to:[x,y]}; ellipse {center:[x,y],radii:[rx,ry]}; text {at:[x,y],text}; optional color (0–5), dashed (boolean).
- expr 使用數字、變數 x（參數式 t）、pi/e 或前綴陣列，例如 ["+",["^","x",2],1]；支援 + - * / ^、min/max、sin/cos/tan、asin/acos/atan、exp/ln/log10/sqrt/abs/neg/floor/ceil。角度為弧度。禁止任意 JS/HTML/SVG。
- 例：{"type":"plot","x":[-3,3],"y":[0,9],"layers":[{"type":"function","expr":["^","x",2]}]}
- render(spec) 產生受限 SVG 或表格 HTML，inspect(spec) 回傳 valid/reason。標籤轉義，有限數值、資料量、運算深度及取樣限制。

## 後續共用整合
現有 q/correct/wrong/exp 仍是字串；不直接變更既有格式、批改或公開出題流程。需在共用資料層引入有序內容區塊，讓所有出題入口使用同一契約；將圖表納入獨立審核、資料儲存、快取、題庫、題目/選項/提示/解析渲染及缺圖阻擋流程。現有 question-quality.cjs 對附圖文字的拒絕規則暫時不動。待完整路徑、手機平板及瀏覽器回歸測試後才啟用 API 自由生成。
目前 2D 取樣是近似，並非符號求解或自動斷點保證；圖表語意與科學正確性仍需審核。沒有 3D、地理底圖或影像生成。 
