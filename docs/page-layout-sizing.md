# 網頁版面尺寸

外層舞台以 `document.documentElement.clientWidth/clientHeight` 決定可用範圍；缺少有效尺寸時才回退至 `window.innerWidth/innerHeight`。橫式維持 16:9，直式維持 9:16，等比例縮放並置中，多餘區域保持黑色，硬體安全區仍保留。

不以 `visualViewport.width/height/offsetTop/offsetLeft` 決定舞台、全螢幕頁面或彈窗大小。鍵盤、可視區位移與手勢只改變可視區時，版面保持原尺寸；真正的網頁尺寸、視窗大小或橫直方向變更仍會重新計算。

內層遊戲文件、首次流程、選課、劇情、鬥法、團本與修煉室都沿用網頁版面。全域控制器保留既有 `--app-vv-*` CSS 變數與 ready class，變數現在代表網頁寬高，四側位移固定為零；尺寸通知改為 `app:layout-viewport`。題面本身的縮放手勢不變。
