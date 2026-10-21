// 角色（選用）：宿主可以用 overrideDir 放一份同名的 cast.js，替辦公室提供有名字的角色。
// 預設沒有任何角色，辦公室照常用一般的小人。
//   buildCast(key) → 跟 buildFigure 一樣的人物（另外可以有 fig.faceFor(expr) 換成自己的表情），沒有就回傳 null
//     key：'boss'（送訊息時走過去的「你」）、'courier'（送貨）、'barista'（咖啡吧）、'consultant'（程式外包顧問），
//          或對話資料裡的 data.cast（指定這段對話由哪個角色坐）
//   buildMascot() → 公司升級時跳出來的吉祥物（Group，userData.hands 兩隻手會跟著揮），沒有就回傳 null
//   buildCatFigure(def, i) → 辦公室貓的樣子（跟 furniture.js 的 buildCat 一樣回傳 { root, body, head, legs[4], tail }），沒有就用預設的積木貓
export function buildCast() { return null; }
export function buildMascot() { return null; }
export function buildCatFigure() { return null; }
