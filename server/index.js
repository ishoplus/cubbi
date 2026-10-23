// Cubbi 對外的接口：宿主（例如 claude-web）從這裡拿核心、資料來源與前端頁面
export { createSpace } from './space.js';
export { transcriptSource, findTranscript } from './sources/transcript.js';
export { toolKind, toolDetail, short, userText } from './sources/common.js';
export { fitWidth, guessName } from './sources/naming.js';
export { createCodex, isCodexCommand, isCodexImageCommand, promptOf, actionOf } from './codex.js';
export { createGrowth, lookOf as growthLook } from './growth.js';
export { createClaudeQuota } from './claude-quota.js';
export { hookSource, installHooks, uninstallHooks } from './hooks.js';
export { spaceWeb } from './web.js';
export { startCubbi } from './standalone.js';
