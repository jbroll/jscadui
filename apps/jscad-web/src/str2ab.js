/**
 * @param {string} str
 * @returns {Uint8Array}
 */
export function str2ab(str) {
  const arrBuff = new ArrayBuffer(str.length);
  const bytes = new Uint8Array(arrBuff);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i);
  }
  return bytes;
}