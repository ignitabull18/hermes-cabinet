const MAX_BASE_PATH_LENGTH = 160;

export class HermesUpstreamUrlError extends Error {
  constructor(readonly variableName: string, reason: string) {
    super(`Invalid server configuration: ${variableName} ${reason}`);
    this.name = "HermesUpstreamUrlError";
  }
}

export type HermesUpstreamUrl = {
  baseUrl: string;
  safeOrigin: string;
};

function fail(name: string, reason: string): never {
  throw new HermesUpstreamUrlError(name, reason);
}

function strictLoopbackHostname(hostname: string): boolean {
  if (hostname === "localhost") return true;
  if (hostname === "[::1]") return true;
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part))) return false;
  const octets = parts.map(Number);
  return octets[0] === 127 && octets.every((octet) => octet >= 0 && octet <= 255);
}

function validateBasePath(name: string, pathname: string): string {
  if (pathname.length > MAX_BASE_PATH_LENGTH) fail(name, "has an overlong base path.");
  if (!/^\/(?:[A-Za-z0-9._~-]+\/?)*$/.test(pathname)) {
    fail(name, "has an unsupported base path.");
  }
  const segments = pathname.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    fail(name, "has an unsafe base path.");
  }
  return pathname === "/" ? "" : pathname.replace(/\/+$/, "");
}

/**
 * Validates a server-only Hermes upstream URL for the current local deployment.
 * It rejects unsafe components instead of normalizing them away.
 */
export function validateHermesUpstreamUrl(name: string, value: string): HermesUpstreamUrl {
  const raw = value.trim();
  if (!raw) fail(name, "is required.");
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) fail(name, "is malformed.");
  if (raw.includes("?") || raw.includes("#")) fail(name, "must not contain a query string or fragment.");

  const match = /^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/i.exec(raw);
  if (!match) fail(name, "must be an HTTP(S) loopback URL.");
  const authority = match[2];
  if (authority.includes("@")) fail(name, "must not contain URL credentials.");
  const rawPathname = match[3] ?? "/";
  validateBasePath(name, rawPathname);

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fail(name, "must be a valid HTTP(S) loopback URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail(name, "must use HTTP(S).");
  }
  if (!strictLoopbackHostname(parsed.hostname.toLowerCase())) {
    fail(name, "must use an explicit loopback host.");
  }

  // The platform URL parser accepts alternate IPv4 spellings such as 127.1 or
  // hexadecimal integers. Require the raw authority to contain the same host
  // spelling as the normalized URL so those ambiguous forms fail closed.
  const rawHost = authority.startsWith("[")
    ? authority.slice(0, authority.indexOf("]") + 1)
    : authority.split(":", 1)[0];
  if (parsed.hostname.toLowerCase() !== "[::1]" && rawHost.toLowerCase() !== parsed.hostname.toLowerCase()) {
    fail(name, "uses an ambiguous host form.");
  }

  const pathname = validateBasePath(name, parsed.pathname);
  return {
    baseUrl: `${parsed.origin}${pathname}`,
    safeOrigin: parsed.origin.slice(0, 160),
  };
}
