function toUint8(str) {
  const buf = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i) & 0xff;
  return buf;
}

function fromUint8(arr) {
  let out = "";
  for (let i = 0; i < arr.length; i++) out += String.fromCharCode(arr[i]);
  return out;
}

function deflate(str) {
  if (typeof CompressionStream !== "undefined") {
    return new Response(new Blob([str]).stream().pipeThrough(new CompressionStream("deflate")))
      .arrayBuffer()
      .then((buf) => new Uint8Array(buf));
  }
  if (typeof window !== "undefined" && window.pako?.deflate) {
    return Promise.resolve(window.pako.deflate(str));
  }
  return Promise.resolve(toUint8(str));
}

function inflate(bytes) {
  if (typeof DecompressionStream !== "undefined") {
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate")))
      .arrayBuffer()
      .then((buf) => new Uint8Array(buf));
  }
  if (typeof window !== "undefined" && window.pako?.inflate) {
    return Promise.resolve(window.pako.inflate(bytes));
  }
  return Promise.resolve(bytes);
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 =
    typeof btoa === "function"
      ? btoa(binary)
      : typeof globalThis !== "undefined" && globalThis.Buffer
        ? globalThis.Buffer.from(binary, "binary").toString("base64")
        : "";
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const binary =
    typeof atob === "function"
      ? atob(padded)
      : typeof globalThis !== "undefined" && globalThis.Buffer
        ? globalThis.Buffer.from(padded, "base64").toString("binary")
        : "";
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function compressToBase64Url(text) {
  const deflated = await deflate(text || "");
  return base64UrlEncode(deflated);
}

export async function decompressFromBase64Url(text) {
  if (!text) return "";
  const bytes = base64UrlDecode(text);
  const inflated = await inflate(bytes);
  return fromUint8(inflated);
}
