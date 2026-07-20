import test from "node:test";
import assert from "node:assert/strict";
import { HermesUpstreamUrlError, validateHermesUpstreamUrl } from "./upstream-url";

test("Hermes upstream validator accepts only explicit IPv4, IPv6, and localhost loopback identities", () => {
  assert.equal(validateHermesUpstreamUrl("API", "http://localhost:8642").baseUrl, "http://localhost:8642");
  assert.equal(validateHermesUpstreamUrl("API", "https://127.42.0.9:8642/api").baseUrl, "https://127.42.0.9:8642/api");
  assert.equal(validateHermesUpstreamUrl("API", "http://[::1]:8642").baseUrl, "http://[::1]:8642");
  assert.equal(validateHermesUpstreamUrl("API", "http://[0:0:0:0:0:0:0:1]:8642").baseUrl, "http://[::1]:8642");
});

test("Hermes upstream validator rejects non-loopback and deceptive host identities", () => {
  for (const url of [
    "https://example.com",
    "http://hermes.test:8642",
    "http://10.0.0.2:8642",
    "http://192.168.1.2:8642",
    "http://100.64.0.2:8642",
    "http://hermes.tailnet.ts.net:8642",
    "http://0.0.0.0:8642",
    "http://169.254.1.1:8642",
    "http://224.0.0.1:8642",
    "http://localhost.evil.example:8642",
    "http://evil-localhost:8642",
    "http://127.1:8642",
    "http://0177.0.0.1:8642",
    "http://0x7f000001:8642",
    "http://[::ffff:127.0.0.1]:8642",
  ]) {
    assert.throws(() => validateHermesUpstreamUrl("CABINET_HERMES_API_URL", url), HermesUpstreamUrlError, url);
  }
});

test("Hermes upstream validator rejects credentials, secrets, fragments, schemes, and malformed paths", () => {
  for (const url of [
    "http://user:password@127.0.0.1:8642",
    "http://127.0.0.1:8642?token=secret",
    "http://127.0.0.1:8642/#secret",
    "file:///tmp/hermes.sock",
    "ws://127.0.0.1:8642",
    "http://127.0.0.1:8642/%2e%2e/private",
    "http://127.0.0.1:8642/api path",
  ]) {
    assert.throws(() => validateHermesUpstreamUrl("CABINET_HERMES_API_URL", url), HermesUpstreamUrlError, url);
  }
});

test("Hermes upstream errors are bounded and never echo the rejected URL", () => {
  const secret = "redirect-secret-value";
  assert.throws(
    () => validateHermesUpstreamUrl("CABINET_HERMES_API_URL", `https://user:${secret}@example.com/path?token=${secret}`),
    (error: unknown) => error instanceof HermesUpstreamUrlError && error.message.length < 180 && !error.message.includes(secret) && !error.message.includes("example.com"),
  );
});
