/** @typedef {Record<string, unknown>} VmessJson */

const PROXY_GROUP = "PROXY";

/**
 * @param {string} payload
 * @returns {string}
 */
function decodeBase64Utf8(payload) {
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  const b64 = pad ? normalized + "=".repeat(4 - pad) : normalized;
  if (typeof Buffer !== "undefined") {
    return Buffer.from(b64, "base64").toString("utf8");
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * @param {string} link
 * @returns {VmessJson}
 */
export function parseVmessLink(link) {
  const trimmed = link.trim();
  if (!/^vmess:\/\//i.test(trimmed)) {
    throw new Error("不是有效的 vmess:// 链接");
  }

  const payload = trimmed.slice("vmess://".length).trim();
  if (!payload) {
    throw new Error("vmess 链接内容为空");
  }

  let jsonStr;
  try {
    jsonStr = decodeBase64Utf8(payload);
  } catch {
    throw new Error("无法解码 vmess 链接");
  }

  /** @type {VmessJson} */
  let config;
  try {
    config = JSON.parse(jsonStr);
  } catch {
    throw new Error("vmess 配置 JSON 无效");
  }

  if (!config || typeof config !== "object") {
    throw new Error("vmess 配置格式无效");
  }

  return config;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractVmessLinks(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && /^vmess:\/\//i.test(line));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isTruthyFlag(value) {
  if (value === true || value === 1) return true;
  const s = String(value ?? "").trim().toLowerCase();
  return s === "tls" || s === "true" || s === "1" || s === "yes";
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isFalsyFlag(value) {
  if (value === false || value === 0) return true;
  const s = String(value ?? "").trim().toLowerCase();
  return s === "false" || s === "0" || s === "no";
}

/**
 * @param {VmessJson} vmess
 * @returns {Record<string, unknown>}
 */
export function vmessToClashProxy(vmess) {
  const server = String(vmess.add ?? vmess.server ?? "").trim();
  const uuid = String(vmess.id ?? vmess.uuid ?? "").trim();
  const portRaw = vmess.port ?? vmess.server_port;
  const port = Number.parseInt(String(portRaw ?? ""), 10);

  if (!server) throw new Error("缺少服务器地址 (add)");
  if (!uuid) throw new Error("缺少 UUID (id)");
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error("端口无效");
  }

  let name = String(vmess.ps ?? vmess.remarks ?? vmess.name ?? "").trim();
  if (!name) name = `${server}:${port}`;

  const alterId = Number.parseInt(String(vmess.aid ?? vmess.alterId ?? 0), 10);
  const cipher = String(vmess.scy ?? vmess.cipher ?? "auto").trim() || "auto";
  const network = String(vmess.net ?? vmess.network ?? "tcp").trim().toLowerCase() || "tcp";
  const host = String(vmess.host ?? "").trim();
  const path = String(vmess.path ?? "").trim();
  const sni = String(vmess.sni ?? vmess.servername ?? "").trim();
  const tls = isTruthyFlag(vmess.tls);

  /** @type {Record<string, unknown>} */
  const proxy = {
    name,
    type: "vmess",
    server,
    port,
    uuid,
    alterId: Number.isFinite(alterId) ? alterId : 0,
    cipher,
    udp: true,
  };

  if (tls) {
    proxy.tls = true;
    const servername = sni || host || server;
    if (servername) proxy.servername = servername;
  }

  if (isFalsyFlag(vmess.verify_cert) || isTruthyFlag(vmess.allowInsecure) || isTruthyFlag(vmess.insecure)) {
    proxy["skip-cert-verify"] = true;
  }

  const fp = String(vmess.fp ?? "").trim();
  if (fp) proxy["client-fingerprint"] = fp;

  if (network && network !== "tcp") {
    proxy.network = network;
  }

  if (network === "ws") {
    /** @type {Record<string, unknown>} */
    const wsOpts = {};
    if (path) wsOpts.path = path;
    if (host) {
      wsOpts.headers = { Host: host };
    }
    if (Object.keys(wsOpts).length) proxy["ws-opts"] = wsOpts;
  } else if (network === "grpc") {
    const serviceName = path || host;
    if (serviceName) {
      proxy["grpc-opts"] = { "grpc-service-name": serviceName };
    }
  } else if (network === "h2") {
    /** @type {Record<string, unknown>} */
    const h2Opts = {};
    if (path) h2Opts.path = path;
    if (host) {
      h2Opts.host = host.split(",").map((h) => h.trim()).filter(Boolean);
    }
    if (Object.keys(h2Opts).length) proxy["h2-opts"] = h2Opts;
  } else if (network === "http") {
    /** @type {Record<string, unknown>} */
    const httpOpts = {};
    if (path) {
      httpOpts.path = path.split(",").map((p) => p.trim()).filter(Boolean);
    }
    if (host) {
      httpOpts.headers = { Host: [host] };
    }
    if (Object.keys(httpOpts).length) proxy["http-opts"] = httpOpts;
  }

  return proxy;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function needsQuotes(value) {
  if (value === "") return true;
  return /[:\s#'"[\]{}&,?*@`]|^[-?]|^(true|false|null|yes|no|on|off)$/i.test(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function yamlScalar(value) {
  if (value === true) return "true";
  if (value === false) return "false";
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return String(value);
  const str = String(value);
  if (needsQuotes(str)) return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return str;
}

/**
 * @param {unknown} node
 * @param {number} indent
 * @returns {string[]}
 */
function yamlLines(node, indent) {
  const pad = "  ".repeat(indent);

  if (node === null || node === undefined) return [`${pad}null`];
  if (typeof node !== "object") return [`${pad}${yamlScalar(node)}`];

  if (Array.isArray(node)) {
    /** @type {string[]} */
    const lines = [];
    for (const item of node) {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const entries = Object.entries(item);
        if (!entries.length) {
          lines.push(`${pad}- {}`);
          continue;
        }
        const [firstKey, firstVal] = entries[0];
        if (firstVal !== null && typeof firstVal === "object") {
          lines.push(`${pad}- ${firstKey}:`);
          lines.push(...yamlLines(firstVal, indent + 2));
        } else {
          lines.push(`${pad}- ${firstKey}: ${yamlScalar(firstVal)}`);
        }
        for (let i = 1; i < entries.length; i++) {
          const [key, value] = entries[i];
          lines.push(...yamlKeyValue(key, value, indent + 1));
        }
      } else {
        lines.push(`${pad}- ${yamlScalar(item)}`);
      }
    }
    return lines;
  }

  /** @type {string[]} */
  const lines = [];
  for (const [key, value] of Object.entries(node)) {
    if (value === undefined) continue;
    lines.push(...yamlKeyValue(key, value, indent));
  }
  return lines;
}

/**
 * @param {string} key
 * @param {unknown} value
 * @param {number} indent
 * @returns {string[]}
 */
function yamlKeyValue(key, value, indent) {
  const pad = "  ".repeat(indent);
  if (value !== null && typeof value === "object") {
    return [`${pad}${key}:`, ...yamlLines(value, indent + 1)];
  }
  return [`${pad}${key}: ${yamlScalar(value)}`];
}

/**
 * @param {unknown} node
 * @returns {string}
 */
export function toYaml(node) {
  return `${yamlLines(node, 0).join("\n")}\n`;
}

/**
 * @param {Record<string, unknown>[]} proxies
 * @returns {string}
 */
export function buildClashYaml(proxies) {
  const names = proxies.map((p) => String(p.name));

  const config = {
    "mixed-port": 7890,
    "allow-lan": false,
    mode: "rule",
    "log-level": "info",
    proxies,
    "proxy-groups": [
      {
        name: PROXY_GROUP,
        type: "select",
        proxies: names,
      },
    ],
    rules: [`MATCH,${PROXY_GROUP}`],
  };

  return toYaml(config).trimEnd() + "\n";
}

/**
 * @param {string} link
 * @returns {string}
 */
function shortenLink(link) {
  return link.length > 80 ? `${link.slice(0, 77)}...` : link;
}

/**
 * @typedef {{
 *   index: number,
 *   link: string,
 *   vmess: VmessJson | null,
 *   proxy: Record<string, unknown> | null,
 *   error: string | null,
 * }} ConvertItem
 */

/**
 * @param {ConvertItem[]} items
 * @returns {string}
 */
export function formatIntermediateJson(items) {
  const payload = items.map(({ index, link, vmess, proxy, error }) => {
    /** @type {Record<string, unknown>} */
    const row = { index, link: shortenLink(link) };
    if (error) row.error = error;
    if (vmess) row.vmess = vmess;
    if (proxy) row.proxy = proxy;
    return row;
  });
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * @param {string} text
 * @returns {{
 *   yaml: string,
 *   proxies: Record<string, unknown>[],
 *   items: ConvertItem[],
 *   intermediate: string,
 *   errors: { line: string, message: string }[],
 * }}
 */
export function convertVmessText(text) {
  const links = extractVmessLinks(text);
  if (!links.length) {
    throw new Error("未找到 vmess:// 链接，每行一条");
  }

  /** @type {Record<string, unknown>[]} */
  const proxies = [];
  /** @type {ConvertItem[]} */
  const items = [];
  /** @type {{ line: string, message: string }[]} */
  const errors = [];
  const usedNames = new Set();

  links.forEach((link, i) => {
    /** @type {ConvertItem} */
    const item = {
      index: i + 1,
      link,
      vmess: null,
      proxy: null,
      error: null,
    };

    try {
      item.vmess = parseVmessLink(link);
      let proxy = vmessToClashProxy(item.vmess);
      const baseName = String(proxy.name);
      let suffix = 1;
      while (usedNames.has(String(proxy.name))) {
        suffix += 1;
        proxy = { ...proxy, name: `${baseName}-${suffix}` };
      }
      usedNames.add(String(proxy.name));
      item.proxy = proxy;
      proxies.push(proxy);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      item.error = message;
      errors.push({
        line: shortenLink(link),
        message,
      });
    }

    items.push(item);
  });

  if (!proxies.length) {
    const detail = errors.map((e) => e.message).join("；");
    throw new Error(detail || "全部链接转换失败");
  }

  return {
    yaml: buildClashYaml(proxies),
    proxies,
    items,
    intermediate: formatIntermediateJson(items),
    errors,
  };
}

export { PROXY_GROUP };
