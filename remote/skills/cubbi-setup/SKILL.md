---
name: cubbi-setup
description: 幫用戶安裝並設定 Cubbi remote（用手機操作這台電腦上的 Claude Code）、設定手機怎麼連、開機自動啟動、看狀態與紀錄、排解連不上。用戶說「幫我安裝 Cubbi」「設定手機遠端」「Cubbi 連不上」「Cubbi 重啟」時使用。Set up Cubbi remote, phone access, start on boot, troubleshoot.
---

# 安裝與設定 Cubbi remote

Cubbi remote 讓用戶在手機或別台電腦上操作這台的 Claude Code：對話、核准、看分支改動、收件箱推播，加上一間 3D 辦公室。只在這台電腦上跑，外面連進來要經過通道。

## 安裝

你是代理人，指令沒有終端機可以互動：照下面做就不會卡住。

1. 確認 Node 20 以上（`node -v`），Claude Code 已登入（`claude auth status` 的 loggedIn 是 true；沒有就請用戶自己執行 `claude auth login`，要在瀏覽器登入，你不要代登）。
2. 問用戶兩件事（不要自己猜，一次問完）：
   - Claude 可以在哪個資料夾做事（通常是放所有專案的那一層，例如 ~/projects；不存在會自動建立）
   - 手機怎麼連：只在這台／同一個 Wi-Fi（只在信任的網路）／Tailscale（推薦：出門也能用，只有用戶自己的裝置連得到）／ngrok（要 authtoken）／自己的網址
3. 全域安裝這一版（`npx` 的暫存區會被清掉，背景服務不能指到那裡）：
   ```
   npm i -g cubbi@{{version}}
   ```
   出現 EACCES（沒權限）：不要用 sudo，請用戶決定（例如改用 nvm／Homebrew 裝的 Node）。
4. 用參數跑設定，一定要加 `--service`：交給開機服務在背景跑，指令幾秒就結束。**不要用 `--no-service`、不要用 npx 跑 setup**，那樣伺服器會在你的指令裡跑，指令逾時被砍就一起停。
   ```
   cubbi setup --yes --work-root <資料夾> --connect <local|lan|tailscale|ngrok|url> [--ngrok-token <token>] [--url <https://…>] --service
   ```
5. 跑完會幫用戶在這台打開瀏覽器（已登入）。輸出裡的 QR 用戶在你這邊通常看不到，**請直接用文字告訴用戶**：
   - 手機打開哪個網址（輸出裡「掃不了」那一行的網址）
   - 在登入畫面輸入哪組 6 位數配對碼（10 分鐘內、用一次就失效）
   - 過期了：在電腦的網頁右上角按 📱 會有新的一組；或你執行 `cubbi remote login-link`，再把新的網址和配對碼告訴用戶
   選「只在這台」就沒有手機網址，告訴用戶瀏覽器已經打開就好。
隱私（用戶問到就這樣答，不要自己發明開關）：辦公室會在本機讀 `~/.claude/projects` 的對話紀錄來畫人、算成果，不上傳任何東西；這是辦公室運作必需的，沒有關掉的設定（`plugins.economy: false` 只關「算成果換積木」，不會停止讀紀錄）。對外的連線只有用戶選的通道、自己設的推播與天氣。

6. 最後用 `cubbi service status` 確認在跑，把結果告訴用戶；並提醒移除方式：`cubbi service uninstall`，資料在 `~/.cubbi`。

Tailscale：電腦和手機都要裝、登入同一個帳號，並在 Tailscale 管理頁打開 MagicDNS 與 HTTPS。沒裝好就先選「同一個 Wi-Fi」，之後再跑一次 `cubbi setup`。

## 日常

- `cubbi service status`：有沒有在跑、版本、對外網址
- `cubbi service restart`：安全重啟（先語法檢查、備用埠試跑，再換；對話不會斷）
- `cubbi service logs -n 100`：看紀錄（排錯先看這個）
- `cubbi remote login-link`：給新裝置的一次性登入連結＋QR＋6 位數配對碼
- 設定在 `~/.cubbi/.env`（連線、萬用密碼）和 `~/.cubbi/remote/config.json`（外掛、提案部、排程…）

## 連不上的時候

1. `cubbi service status` 沒在跑 → `cubbi service logs` 看最後的錯誤
2. 手機連不到但電腦可以 → 看 `~/.cubbi/.env` 的 HOST／TUNNEL：同 Wi-Fi 要 `HOST=0.0.0.0`；Tailscale 要 `TUNNEL=tailscale` 而且 `tailscale status` 正常
3. 登入連結或配對碼失效 → 一次性、10 分鐘，重新要一組：`cubbi remote login-link`
4. 不支援 trycloudflare 臨時隧道（不支援串流），要用命名隧道或 Tailscale
