// ── 資料與設定放哪 ───────────────────────────────────────────────────────────
//
// npx cubbi remote：全部在 ~/.cubbi（CUBBI_HOME）底下——設定 ~/.cubbi/.env、資料與 config.json 在 ~/.cubbi/remote。
// 宿主（例如 claude-web）用 CW_DATA_DIR 指到自己的資料夾，.env 放在它啟動的資料夾。
// .env 先讀啟動資料夾的，再讀 ~/.cubbi/.env；同一個變數以先讀到的為準，已經設在環境裡的不蓋。
// 要讀環境變數的模組都先 import 這裡，.env 才會在它們讀之前載入（ESM 的 import 先於模組本體執行）。
import { join, resolve } from 'path';
import { homedir } from 'os';
import dotenv from 'dotenv';

export const CUBBI_HOME = resolve(process.env.CUBBI_HOME || join(homedir(), '.cubbi'));
dotenv.config({ path: [join(process.cwd(), '.env'), join(CUBBI_HOME, '.env')], quiet: true });

export const DATA_DIR = resolve(process.env.CW_DATA_DIR || join(CUBBI_HOME, 'remote'));
export const dataFile = (name) => join(DATA_DIR, name);
