---
name: cubbi-ideas
description: 提案部（Cubbi）：現在產一批新功能／新項目提案、查看歷來提案、記下用戶對提案的判斷（要／不要／改）。用戶說「給我一些點子」「提案部跑一次」「上次的提案」「那個提案要／不要／改」時使用。Ideas department: generate proposals, list them, record yes / no / tweak.
---

# 提案部

提案存在 Cubbi 的提案資料夾，辦公室的提案白板、收件箱看的是同一份。指令都用 `npx cubbi ideas`。

## 指令

- `npx cubbi ideas run`：產一批（2 份新功能＋1 份新項目）。會跑 5–15 分鐘、用到 Claude 額度，**先跟用戶確認**；工具逾時要給夠（至少 20 分鐘）。
- `npx cubbi ideas run --dry`：試跑，只印出不存。
- `npx cubbi ideas verdict <id> <要|不要|改> "備註"`：記下判斷。下一批會讀到，用來去重、照「改」的備註重提。
- `npx cubbi ideas list [--pending]`：列出歷來提案（--pending 只列還沒判斷的）。
- `npx cubbi ideas start <id>`／`done <id>`：記下開工／做完。
- `npx cubbi ideas lenses`：今天輪到哪個視角。

## 步驟

1. 用戶要點子：先確認要花額度，再跑 `run`，回報這批的標題與 id。
2. 用戶對某份提案表態：一定要跑 `verdict` 記下來，備註照抄他的原話。這是品味累積的唯一來源。
3. 用戶要做某份提案：建議他到辦公室的提案白板按「開工」（會派一個人在分支裡做，做完在收件箱交件）；他要在這裡做就照提案的 plan 開工，並跑 `start <id>`。

## 每天自動提案

在辦公室的提案白板打開「每天提案」（寫進排程，預設 09:00）。也可以在設定檔 `routines` 加一項 `{ "id": "ideas", "at": "09:00", "days": "daily", "action": { "type": "ideas" } }`。
