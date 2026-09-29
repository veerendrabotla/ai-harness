/**
 * Preview proxy (PHASE 13 #12) — ticket signing + HTML/CSS subresource
 * rewriting so a remote browser can render a preview that only exists on the
 * bridge host's loopback.
 *
 * Ticket: stateless HMAC capability `v1.<b64url(projectId)>.<exp>.<sig>`
 * bound to one project, short-lived, mintable only by an authenticated
 * VIEWER via POST .../preview/proxy-ticket. Iframe/asset requests carry it as
 * a query param (iframes cannot send Authorization headers).
 *
 * Rewriting: every same-origin href/src/action/poster/srcset/url() reference
 * is rewritten to `<proxyBase><path>?<query>&ticket=...` so each subresource
 * request re-authenticates. External origins, data:/javascript: URIs and
 * hash-only refs are left untouched.
 */
import { createHmac } from "node:crypto";
import { getEnv, safeEqual } from "@ai-harness/shared";

export const PROXY_TICKET_TTL_MS = 2 * 60 * 60 * 1000;

function ticketSignature(projectId: string, exp: number): string {
  return createHmac("sha256", getEnv().JWT_ACCESS_SECRET).update(`${projectId}.${exp}`).digest("base64url");
}

export function signProxyTicket(projectId: string, now: number = Date.now()): { ticket: string; expiresAt: number } {
  const exp = now + PROXY_TICKET_TTL_MS;
  const encodedProject = Buffer.from(projectId, "utf8").toString("base64url");
  return { ticket: `v1.${encodedProject}.${exp}.${ticketSignature(projectId, exp)}`, expiresAt: exp };
}

export function verifyProxyTicket(ticket: string, projectId: string, now: number = Date.now()): boolean {
  if (!ticket) return false;
  const parts = ticket.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const decodedProject = Buffer.from(parts[1] ?? "", "base64url").toString("utf8");
  if (decodedProject !== projectId) return false;
  const exp = Number(parts[2]);
  if (!Number.isSafeInteger(exp) || now > exp) return false;
  return safeEqual(parts[3] ?? "", ticketSignature(projectId, exp));
}

export interface ProxyRewriteContext {
  /** Absolute URL of the document/resource being proxied (on the preview origin). */
  targetUrl: URL;
  /** Absolute path prefix of this API's proxy route, always trailing-slashed. */
  proxyBase: string;
  ticket: string;
}

const SKIP_PREFIX_RE = /^(#|data:|javascript:|mailto:|tel:|blob:|about:)/i;

/** Resolve ref against the target and map same-origin refs onto the proxy route. */
export function toProxyUrl(ref: string, ctx: ProxyRewriteContext): string | null {
  const raw = ref.trim();
  if (!raw || SKIP_PREFIX_RE.test(raw)) return null;
  let resolved: URL;
  try {
    resolved = new URL(raw, ctx.targetUrl);
  } catch {
    return null;
  }
  if (resolved.origin !== ctx.targetUrl.origin) return null;
  const path = resolved.pathname.replace(/^\//, "");
  const ticketParam = `ticket=${encodeURIComponent(ctx.ticket)}`;
  const query = resolved.search ? `${resolved.search}&${ticketParam}` : `?${ticketParam}`;
  return `${ctx.proxyBase}${path}${query}`;
}

const URL_ATTR_RE = /\b(href|src|action|poster|data-src|data-href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const SRCSET_ATTR_RE = /\b(?:srcset|imagesrcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const STYLE_BLOCK_RE = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;
const STYLE_ATTR_RE = /(\bstyle\s*=\s*")([^"]*)(")/gi;
const BASE_TAG_RE = /<base\b[^>]*>/gi;
const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s]+))\s*\)/gi;

function rewriteSrcset(value: string, ctx: ProxyRewriteContext): string | null {
  let changed = false;
  const rewritten = value.split(",").map((entry) => {
    const trimmed = entry.trim();
    if (!trimmed) return entry;
    const splitAt = trimmed.search(/\s/);
    const urlPart = splitAt === -1 ? trimmed : trimmed.slice(0, splitAt);
    const descriptor = splitAt === -1 ? "" : trimmed.slice(splitAt);
    const proxied = toProxyUrl(urlPart, ctx);
    // Trim entries that pass through so a mixed rewrite does not stack the
    // original leading whitespace on top of the join separator.
    if (proxied === null) return trimmed;
    changed = true;
    return `${proxied}${descriptor}`;
  });
  return changed ? rewritten.join(", ") : null;
}

export function rewritePreviewCss(css: string, ctx: ProxyRewriteContext): string {
  return css.replace(CSS_URL_RE, (match, dq, sq, bare) => {
    const value = (dq ?? sq ?? bare ?? "") as string;
    const proxied = toProxyUrl(value, ctx);
    return proxied === null ? match : `url("${proxied}")`;
  });
}

export function rewritePreviewHtml(html: string, ctx: ProxyRewriteContext): string {
  let out = html.replace(URL_ATTR_RE, (match, attr: string, dq?: string, sq?: string) => {
    const value = dq ?? sq ?? "";
    const proxied = toProxyUrl(value, ctx);
    return proxied === null ? match : `${attr}="${proxied}"`;
  });
  out = out.replace(SRCSET_ATTR_RE, (match, dq?: string, sq?: string) => {
    const value = dq ?? sq ?? "";
    const proxied = rewriteSrcset(value, ctx);
    return proxied === null ? match : `srcset="${proxied}"`;
  });
  out = out.replace(STYLE_BLOCK_RE, (_match, open: string, css: string, close: string) => open + rewritePreviewCss(css, ctx) + close);
  out = out.replace(STYLE_ATTR_RE, (_match, open: string, css: string, close: string) => open + rewritePreviewCss(css, ctx) + close);
  // A <base href> would re-point relative refs off the proxy prefix — drop it;
  // dev-server documents do not rely on <base>.
  out = out.replace(BASE_TAG_RE, "");
  return out;
}
