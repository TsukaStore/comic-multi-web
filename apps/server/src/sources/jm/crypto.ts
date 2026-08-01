import { createDecipheriv, createHash } from "node:crypto";

/**
 * PicaComic constants
 * kJmSecret / _jmAuthKey / builtInImgUrls / domains (settings)
 */
export const JM_SECRET = "185Hcomic3PAPP7R";
export const JM_AUTH_KEY = "18comicAPPContent";
/** default appdata.settings[89] style version string used in tokenparam */
export const JM_APP_VERSION = "1.7.9";

/** md5("$time$_jmAuthKey") → token header */
export function jmToken(time: string | number) {
  return createHash("md5").update(`${time}${JM_AUTH_KEY}`).digest("hex");
}

/**
 * JmNetwork.convertData(input, secret)
 * key = utf8( md5(secret).hex ) — 32-char hex as AES-256-ECB key
 */
export function convertJmDataWithSecret(input: string, secret: string): unknown {
  const keyHex = createHash("md5").update(secret).digest("hex");
  const key = Buffer.from(keyHex, "utf8");
  const buf = Buffer.from(input, "base64");

  const decipher = createDecipheriv("aes-256-ecb", key, null);
  decipher.setAutoPadding(true);
  let out = Buffer.concat([decipher.update(buf), decipher.final()]).toString("utf8");

  let i = out.length - 1;
  while (i >= 0 && out[i] !== "}" && out[i] !== "]") i--;
  if (i >= 0) out = out.slice(0, i + 1);

  return JSON.parse(out);
}

/** API body decrypt: secret = `$time$kJmSecret` */
export function convertJmData(input: string, time: string | number): unknown {
  return convertJmDataWithSecret(input, `${time}${JM_SECRET}`);
}

/**
 * PicaComic JmNetwork.domainUrls — remote domain list files
 * Decrypted with domainSecret (not time+kJmSecret)
 */
export const JM_DOMAIN_URLS = [
  "https://rup4a04-c02.tos-cn-hongkong.bytepluses.com/newsvr-2025.txt",
  "https://rup4a04-c01.tos-ap-southeast-1.bytepluses.com/newsvr-2025.txt",
] as const;

/** PicaComic domainSecret char codes → "diosfjckwpqpdfjkvnqQjsik" */
export const JM_DOMAIN_SECRET = String.fromCharCode(
  100, 105, 111, 115, 102, 106, 99, 107, 119, 112, 113, 112, 100, 102, 106, 107,
  118, 110, 113, 81, 106, 115, 105, 107,
);

export const BUILTIN_API_DOMAINS = [
  "www.jmapinodeudzn.net",
  "www.jmapinode.xyz",
  "www.jmapinode.vip",
  "www.jmapiproxyxxx.vip",
];

/** PicaComic builtInImgUrls */
export const BUILTIN_IMG_URLS = [
  "https://cdn-msp3.jmapiproxy1.cc",
  "https://cdn-msp.jmapiproxy3.cc",
  "https://cdn-msp2.jmapiproxy2.cc",
  "https://cdn-msp3.jmapiproxy3.cc",
];
