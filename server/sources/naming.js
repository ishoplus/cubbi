// ── 人物的短名字（名牌）：不呼叫模型，從第一句話用規則抓 ───────────────────────
//
// 單獨跑的 Cubbi 不替使用者花 token 取名，只用規則：角色設定（「你是 X 的…」）取 X、
// 斜線指令取指令名、其他取第一句話的前段，去掉「幫我／請／please」這類開頭。
// 宿主可以換成自己的取名（claude-web 用 haiku）。

// 名牌寬度：中日韓文字算 1，英數算 0.55（名牌上英文比中文窄）
const W = (ch) => /[⺀-鿿豈-﫿＀-￯]/.test(ch) ? 1 : 0.55;
export const MAX_WIDTH = 11;

// 太寬就截斷；不從英文單字中間切
export function fitWidth(s, max = MAX_WIDTH) {
  let w = 0, out = '';
  for (const ch of s) { if (w + W(ch) > max) break; w += W(ch); out += ch; }
  if (out.length < s.length && /[A-Za-z0-9]$/.test(out) && /[A-Za-z0-9]/.test(s[out.length])) {
    const cut = out.search(/[A-Za-z0-9]+$/);
    if (cut > 0) out = out.slice(0, cut);
  }
  return out.replace(/[\s\-–—:：,，、]+$/, '').trim();
}

const LEAD = /^(?:(?:請|请|麻煩|麻烦|幫我|帮我|幫忙|帮忙|可以|能不能|能否|我想要?|我要|我們來|我们来|來|来|先|再|please|pls|can you|could you|would you|help me(?: to)?|i want(?: you)? to|i need(?: you)? to|i'd like(?: you)? to|let's|lets|now)\s*[,，]?\s*)+/i;

export function guessName(text) {
  let s = String(text || '').split('\n').map(l => l.trim()).find(l => l && !/^```/.test(l)) || '';
  if (!s) return '';
  s = s.replace(/^[#>*\-\s]+/, '').replace(/[*_`]/g, '')
    .replace(/https?:\/\/([^/\s]+)\S*/g, '$1')                    // 網址只留主機
    .replace(/(?:~|\.{0,2})?\/(?:[\w.@-]+\/)+([\w.@-]+)/g, '$1');   // 路徑只留檔名
  // 角色設定：你是「AI 發布雷達」的判斷員 → AI 發布雷達；You are a code reviewer for X → code reviewer
  let m = s.match(/^(?:你是|你现在是|你現在是)\s*[「『"“]([^」』"”]+)[」』"”]/) || s.match(/^(?:你是|你现在是|你現在是)\s*(.+?)(?:的|，|。|,|$)/)
    || s.match(/^you are (?:an? |the )?(.+?)(?: for| who| that|[.,;:]|$)/i);
  if (m) return fitWidth(m[1].trim());
  // 斜線指令：/review 123 → review 123
  m = s.match(/^\/([\w:-]+)(.*)$/);
  if (m) return fitWidth((m[1] + m[2]).trim());
  s = s.replace(LEAD, '');
  // 第一個句讀（或括號）前夠長就只取那段
  const head = s.split(/[。！？!?；;（(【\[]|[,，:：](?=\s|[^\d])|\.(?=\s|$)/)[0].trim();
  if (head.length >= 2) s = head;
  return fitWidth(s);
}
