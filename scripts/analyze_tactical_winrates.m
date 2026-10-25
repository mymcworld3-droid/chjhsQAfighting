function [summary, matchup] = analyze_tactical_winrates(resultFile, outputDir)
%ANALYZE_TACTICAL_WINRATES 用 MATLAB 重算戰棋勝率並繪製分支與對戰圖。
% 模擬端直接呼叫 JavaScript 正式規則，避免用另一套公式改寫戰鬥。
% MATLAB 從已保存的勝／敗／和局次數重算百分比，並輸出 CSV 與 PNG。
% 用法（專案根目錄）：
%   addpath('scripts'); [T,M] = analyze_tactical_winrates;
% 重新模擬（需要 Node.js）：
%   system('node scripts/simulate-tactical-winrates.cjs');

projectRoot = fileparts(fileparts(mfilename('fullpath')));
if nargin < 1 || isempty(resultFile)
    resultFile = fullfile(projectRoot,'docs','balance','tactical-v1','results.json');
end
if nargin < 2 || isempty(outputDir)
    outputDir = fullfile(tempdir,'tactical-balance-matlab');
end
if ~isfolder(outputDir), mkdir(outputDir); end
data = jsondecode(fileread(resultFile));
index = find(abs([data.pvp.accuracy] - data.config.mainAccuracy) < 1e-12,1);
run = data.pvp(index); rows = run.summary.rows;
ids = string({rows.id})';
core = string({rows.coreName})'; branch = string({rows.branchName})';
games = [rows.games]'; wins = [rows.wins]'; draws = [rows.draws]';
losses = games - wins - draws;
winPercent = 100*wins./games;
drawPercent = 100*draws./games;
scorePercent = 100*(wins+0.5*draws)./games;
assert(max(abs(winPercent-[rows.winPercent]')) < 1e-10,'勝率與原始次數不一致。');
assert(abs(mean(scorePercent)-50) < 1e-10,'完整循環賽的平均積分應為 50%。');
summary = table(ids,core,branch,games,wins,draws,losses,winPercent,drawPercent,scorePercent);
writetable(summary,fullfile(outputDir,'summary-matlab.csv'),'Encoding','UTF-8');
disp(sortrows(summary,'winPercent','descend'));

n = numel(rows); matchup = nan(n);
for k = 1:numel(run.pairs)
    p = run.pairs(k); a = find(ids==string(p.a),1); b = find(ids==string(p.b),1);
    matchup(a,b) = 100*(p.winsA+0.5*p.draws)/p.games;
    matchup(b,a) = 100-matchup(a,b);
end
labels = core + "／" + branch;
fig = figure('Color','white','Position',[100 100 1100 650]);
barh(categorical(labels,labels),[winPercent,drawPercent,100-winPercent-drawPercent],'stacked');
xlim([0 100]); xlabel('比例 (%)'); ylabel('金丹與戰棋分支');
legend('勝場','和局','敗場','Location','southoutside','Orientation','horizontal');
title(sprintf('戰棋模擬：答對率 %.0f%%，攻擊 %d、生命 %d',100*run.accuracy,data.stats.atk,data.stats.maxHp));
grid on; exportgraphics(fig,fullfile(outputDir,'branch-outcomes.png'),'Resolution',180);
fig2 = figure('Color','white','Position',[100 100 1150 950]);
h = heatmap(labels,labels,matchup,'ColorLimits',[0 100]);
h.Title = '對戰積分：勝=1，和=0.5（非純勝場率）';
h.XLabel = '對手'; h.YLabel = '我方';
exportgraphics(fig2,fullfile(outputDir,'matchup-score.png'),'Resolution',180);
fprintf('已輸出至：%s\n',outputDir);
end
