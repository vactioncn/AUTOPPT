import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import ipaddr from "ipaddr.js";

export function publicUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("请输入完整的网址，以 https:// 或 http:// 开头。");
  }
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    url.href.length > 4096
  )
    throw new Error(
      "请使用不含账号密码的公开网页地址（HTTP / HTTPS 标准端口）。",
    );
  url.hash = "";
  return url;
}

export function isPublicAddress(address) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv6" && parsed.isIPv4MappedAddress())
      parsed = parsed.toIPv4Address();
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

export async function resolvePublic(url, resolve = lookup) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await resolve(hostname, { all: true, verbatim: true });
  // Some local VPN clients synthesize 198.18/15 DNS answers. Resolve the public
  // name via a fixed HTTPS DNS service instead of allowing reserved IP sockets.
  if (
    !isIP(hostname) &&
    addresses.length &&
    addresses.every((a) => /^198\.(18|19)\./.test(a.address))
  ) {
    const response = await fetch(
      "https://cloudflare-dns.com/dns-query?" +
        new URLSearchParams({ name: hostname, type: "A" }),
      {
        headers: { Accept: "application/dns-json" },
        redirect: "error",
        signal: AbortSignal.timeout(6000),
      },
    );
    const answer = await response.json();
    addresses = (answer.Answer || [])
      .filter((a) => a.type === 1)
      .map((a) => ({ address: a.data, family: 4 }));
  }
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error("仅支持公开网站，不能读取本机或局域网地址。");
  return addresses[0];
}

// Pin the validated DNS answer to the socket, including every redirect. No proxy,
// local credentials, ambient cookies, or provider API keys enter this fetch path.
export async function publicFetch(input, options = {}) {
  const {
    maxBytes = 6 * 1024 * 1024,
    signal,
    headers = {},
    followRedirects = true,
  } = options;
  const bounded = AbortSignal.any([
    AbortSignal.timeout(15000),
    ...(signal ? [signal] : []),
  ]);
  let url = publicUrl(input);
  for (let hop = 0; hop <= 5; hop++) {
    bounded.throwIfAborted();
    const address = await Promise.race([
      resolvePublic(url),
      new Promise((_, reject) => {
        if (bounded.aborted) reject(bounded.reason);
        else
          bounded.addEventListener("abort", () => reject(bounded.reason), {
            once: true,
          });
      }),
    ]);
    const result = await new Promise((resolve, reject) => {
      const request = (url.protocol === "https:" ? https : http).get(
        url,
        {
          agent: false,
          signal: bounded,
          lookup: (_host, opts, cb) =>
            opts.all
              ? cb(null, [address])
              : cb(null, address.address, address.family),
          headers: {
            "User-Agent": "Mozilla/5.0 AutoPPT/1.0",
            Accept: "*/*",
            ...headers,
            "Accept-Encoding": "identity",
          },
        },
        (response) => {
          const encoding = response.headers["content-encoding"];
          const decoder =
            encoding === "gzip"
              ? createGunzip()
              : encoding === "br"
                ? createBrotliDecompress()
                : encoding === "deflate"
                  ? createInflate()
                  : null;
          const stream = decoder ? response.pipe(decoder) : response;
          let size = 0,
            wireSize = 0;
          const chunks = [];
          response.on("data", (chunk) => {
            wireSize += chunk.length;
            if (wireSize > maxBytes)
              request.destroy(new Error("网页或图片过大，已停止获取。"));
          });
          response.on("error", reject);
          stream.on("error", reject);
          stream.on("data", (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
              stream.destroy();
              request.destroy(new Error("网页或图片过大，已停止获取。"));
            } else chunks.push(chunk);
          });
          stream.on("end", () =>
            resolve({
              url: url.href,
              status: response.statusCode,
              headers: response.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      request.on("error", reject);
    });
    if (
      followRedirects &&
      [301, 302, 303, 307, 308].includes(result.status) &&
      result.headers.location
    ) {
      url = publicUrl(new URL(result.headers.location, url).href);
      continue;
    }
    return result;
  }
  throw new Error("网页跳转次数过多，请提供作品的直接链接。");
}
