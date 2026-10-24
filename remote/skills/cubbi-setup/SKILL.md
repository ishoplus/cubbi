---
name: cubbi-setup
description: 幫用戶安裝並設定 Cubbi remote（用手機操作這台電腦上的 Claude Code）、設定手機怎麼連、開機自動啟動、看狀態與紀錄、排解連不上。用戶說「幫我安裝 Cubbi」「設定手機遠端」「Cubbi 連不上」「Cubbi 重啟」時使用。Set up Cubbi remote, phone access, start on boot, troubleshoot.
---

# 安裝與設定 Cubbi remote

Cubbi remote 讓用戶在手機或別台電腦上操作這台的 Claude Code：對話、核准、看分支改動、收件箱推播，加上一間 3D 辦公室。只在這台電腦上跑，外面連進來要經過通道。

## 安裝

1. 確認 Node 20 以上（`node -v`），Claude Code 已登入（`claude auth status` 的 loggedIn 是 true；沒有就請用戶自己執行 `claude auth login`，要在瀏覽器登入）。
2. 問用戶兩件事（不要自己猜）：
   - Claude 可以在哪個資料夾做事（通常是放所有專案的那一層，例如 ~/projects）
   - 手機怎麼連：只在這台／同一個 Wi-Fi／Tailscale（推薦：出門也能用，只有用戶自己的裝置連得到）／ngrok（要 authtoken）／自己的網址
3. 要開機自動啟動就先全域安裝：`npm i -g cubbi`（npx 的暫存區會被清掉，開機啟動不能指到那裡）。
4. 用參數跑設定（不會停下來問問題）：
   ```
   cubbi setup --yes --work-root <資料夾> --connect <local|lan|tailscale|ngrok|url> [--ngrok-token <token>] [--url <https://…>] [--service|--no-service]
   ```
   沒全域安裝就把 `cubbi` 換成 `npx cubbi`，並用 `--no-service`。
5. 跑完會印出這台的登入網址（已經幫用戶打開瀏覽器）和手機用的 QR。QR 在終端機裡，請用戶直接看終端機掃；也可以在網頁右上角按 📱 產生。

Tailscale：電腦和手機都要裝、登入同一個帳號，並在 Tailscale 管理頁打開 MagicDNS 與 HTTPS。沒裝好就先選「同一個 Wi-Fi」，之後再跑一次 `cubbi setup`。

## 日常

- `cubbi service status`：有沒有在跑、版本、對外網址
- `cubbi service restart`：安全重啟（先語法檢查、備用埠試跑，再換；對話不會斷）
- `cubbi service logs -n 100`：看紀錄（排錯先看這個）
- `cubbi remote login-link`：給新裝置的一次性登入連結＋QR
- 設定在 `~/.cubbi/.env`（連線、萬用密碼）和 `~/.cubbi/remote/config.json`（外掛、提案部、排程…）

## 連不上的時候

1. `cubbi service status` 沒在跑 → `cubbi service logs` 看最後的錯誤
2. 手機連不到但電腦可以 → 看 `~/.cubbi/.env` 的 HOST／TUNNEL：同 Wi-Fi 要 `HOST=0.0.0.0`；Tailscale 要 `TUNNEL=tailscale` 而且 `tailscale status` 正常
3. 登入連結失效 → 一次性、10 分鐘，重新要一張：`cubbi remote login-link`
4. 不支援 trycloudflare 臨時隧道（不支援串流），要用命名隧道或 Tailscale
