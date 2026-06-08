import assert from "node:assert/strict";
import test from "node:test";
import {
  parseVmessLink,
  extractVmessLinks,
  vmessToClashProxy,
  buildClashYaml,
  convertVmessText,
  formatIntermediateJson,
  toYaml,
} from "../tools/vmess-to-clash/utils.js";

function vmessB64(obj) {
  return `vmess://${Buffer.from(JSON.stringify(obj)).toString("base64")}`;
}

const sampleWs = {
  v: "2",
  ps: "测试节点",
  add: "example.com",
  port: "443",
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  aid: "0",
  net: "ws",
  type: "none",
  host: "example.com",
  path: "/ws",
  tls: "tls",
  sni: "example.com",
};

test("parseVmessLink decodes base64 vmess JSON", () => {
  const parsed = parseVmessLink(vmessB64(sampleWs));
  assert.equal(parsed.add, "example.com");
  assert.equal(parsed.ps, "测试节点");
});

test("vmessToClashProxy maps ws+tls fields", () => {
  const proxy = vmessToClashProxy(sampleWs);
  assert.equal(proxy.name, "测试节点");
  assert.equal(proxy.type, "vmess");
  assert.equal(proxy.server, "example.com");
  assert.equal(proxy.port, 443);
  assert.equal(proxy.uuid, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  assert.equal(proxy.alterId, 0);
  assert.equal(proxy.tls, true);
  assert.equal(proxy.network, "ws");
  assert.deepEqual(proxy["ws-opts"], {
    path: "/ws",
    headers: { Host: "example.com" },
  });
});

test("buildClashYaml includes proxies, proxy-groups and MATCH rule", () => {
  const proxy = vmessToClashProxy(sampleWs);
  const yaml = buildClashYaml([proxy]);
  assert.match(yaml, /^mixed-port: 7890/m);
  assert.match(yaml, /type: vmess/);
  assert.match(yaml, /name: PROXY/);
  assert.match(yaml, /MATCH,PROXY/);
});

test("convertVmessText handles multiple lines and skips comments", () => {
  const link1 = vmessB64({ ...sampleWs, ps: "A" });
  const link2 = vmessB64({ ...sampleWs, ps: "B", add: "b.example.com" });
  const text = `# comment\n${link1}\n\n${link2}\n`;
  const { yaml, proxies, errors, items, intermediate } = convertVmessText(text);
  assert.equal(proxies.length, 2);
  assert.equal(errors.length, 0);
  assert.equal(items.length, 2);
  assert.equal(items[0].vmess?.ps, "A");
  assert.equal(items[1].proxy?.server, "b.example.com");
  assert.match(intermediate, /"vmess"/);
  assert.match(intermediate, /"proxy"/);
  assert.match(yaml, /name: A\n/);
  assert.match(yaml, /name: B\n/);
});

test("formatIntermediateJson includes error for failed items", () => {
  const link = vmessB64(sampleWs);
  const json = formatIntermediateJson([
    { index: 1, link, vmess: sampleWs, proxy: null, error: "映射失败" },
  ]);
  assert.match(json, /"error": "映射失败"/);
  assert.doesNotMatch(json, /"proxy"/);
});

test("convertVmessText deduplicates proxy names", () => {
  const link = vmessB64(sampleWs);
  const { proxies } = convertVmessText(`${link}\n${link}`);
  assert.equal(proxies.length, 2);
  assert.equal(proxies[0].name, "测试节点");
  assert.equal(proxies[1].name, "测试节点-2");
});

test("toYaml quotes strings with special characters", () => {
  const yaml = toYaml({ name: "a:b" });
  assert.match(yaml, /name: "a:b"/);
});

test("extractVmessLinks ignores blank and comment lines", () => {
  const link = vmessB64(sampleWs);
  assert.deepEqual(extractVmessLinks(`# x\n\n${link}\n`), [link]);
});
