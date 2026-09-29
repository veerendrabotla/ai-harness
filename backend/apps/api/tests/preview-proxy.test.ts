import { describe, it, expect } from "vitest";
import {
  PROXY_TICKET_TTL_MS,
  signProxyTicket,
  verifyProxyTicket,
  rewritePreviewCss,
  rewritePreviewHtml,
  toProxyUrl,
  type ProxyRewriteContext,
} from "../src/modules/projects/projects.preview-proxy.js";

// The module reads env lazily via getEnv() — seed required fields before any
// sign/verify call (getEnv caches only after first invocation).
process.env.JWT_ACCESS_SECRET ??= "preview-proxy-test-secret-0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/test";
process.env.ENCRYPTION_KEY ??= Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
process.env.BRIDGE_INTERNAL_TOKEN ??= "preview-proxy-test-bridge-internal-token";

const PROJECT = "proj-1111-2222";
const TARGET = new URL("http://localhost:3000/app/index.html?dev=1");
const ctx: ProxyRewriteContext = {
  targetUrl: TARGET,
  proxyBase: "/v1/projects/proj-1111-2222/preview/proxy/",
  ticket: "v1.test-ticket",
};

describe("preview proxy tickets", () => {
  it("round-trips within TTL", () => {
    const { ticket, expiresAt } = signProxyTicket(PROJECT);
    expect(expiresAt - Date.now()).toBeGreaterThan(PROXY_TICKET_TTL_MS - 5_000);
    expect(verifyProxyTicket(ticket, PROJECT)).toBe(true);
  });

  it("rejects an expired ticket", () => {
    const now = Date.now();
    const { ticket } = signProxyTicket(PROJECT, now - PROXY_TICKET_TTL_MS - 1);
    expect(verifyProxyTicket(ticket, PROJECT, now)).toBe(false);
  });

  it("rejects a ticket minted for another project", () => {
    const { ticket } = signProxyTicket("other-project");
    expect(verifyProxyTicket(ticket, PROJECT)).toBe(false);
  });

  it("rejects tampered signature/expiry/project", () => {
    const { ticket } = signProxyTicket(PROJECT);
    const parts = ticket.split(".");
    expect(verifyProxyTicket(`${parts[0]}.${parts[1]}.${parts[2]}.${parts[3].slice(0, -2)}aa`, PROJECT)).toBe(false);
    expect(verifyProxyTicket(`${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}.${parts[3]}`, PROJECT)).toBe(false);
    expect(verifyProxyTicket(ticket.replace("v1.", "v2."), PROJECT)).toBe(false);
    expect(verifyProxyTicket("", PROJECT)).toBe(false);
    expect(verifyProxyTicket("garbage", PROJECT)).toBe(false);
  });
});

describe("toProxyUrl", () => {
  it("maps absolute-path refs onto the proxy prefix", () => {
    expect(toProxyUrl("/style.css", ctx)).toBe(`${ctx.proxyBase}style.css?ticket=v1.test-ticket`);
  });

  it("maps relative refs by resolving against the target", () => {
    expect(toProxyUrl("img/logo.png", ctx)).toBe(`${ctx.proxyBase}app/img/logo.png?ticket=v1.test-ticket`);
  });

  it("preserves query strings and appends the ticket with &", () => {
    expect(toProxyUrl("style.css?v=8", ctx)).toBe(`${ctx.proxyBase}app/style.css?v=8&ticket=v1.test-ticket`);
  });

  it("maps same-origin absolute URLs", () => {
    expect(toProxyUrl("http://localhost:3000/favicon.ico", ctx)).toBe(`${ctx.proxyBase}favicon.ico?ticket=v1.test-ticket`);
  });

  it("leaves external origins, non-navigational refs untouched", () => {
    expect(toProxyUrl("https://cdn.example.com/x.js", ctx)).toBeNull();
    expect(toProxyUrl("data:image/png;base64,AAAA", ctx)).toBeNull();
    expect(toProxyUrl("#section", ctx)).toBeNull();
    expect(toProxyUrl("javascript:void(0)", ctx)).toBeNull();
    expect(toProxyUrl("", ctx)).toBeNull();
  });
});

describe("rewritePreviewHtml", () => {
  const html = `<!doctype html>
<html>
<head>
  <base href="http://localhost:3000/app/">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href='theme.css'>
  <style>body { background: url(/bg.png); } .ext { background: url("https://cdn.example.com/e.png"); }</style>
</head>
<body>
  <img src="/logo.png" srcset="/logo.png 1x, /logo@2x.png 2x, https://cdn.example.com/l.png 3x" />
  <a href="about.html">About</a>
  <form action="/submit"></form>
  <video poster="/poster.jpg"></video>
  <div style="background-image: url('hero.jpg')"></div>
  <script>const css = "url(never-rewritten.png)"; fetch("/api/data");</script>
</body>
</html>`;

  it("rewrites same-origin href/src/action/poster onto the proxy with ticket", () => {
    const out = rewritePreviewHtml(html, ctx);
    expect(out).toContain(`href="${ctx.proxyBase}style.css?ticket=v1.test-ticket"`);
    expect(out).toContain(`href="${ctx.proxyBase}app/theme.css?ticket=v1.test-ticket"`);
    expect(out).toContain(`src="${ctx.proxyBase}logo.png?ticket=v1.test-ticket"`);
    expect(out).toContain(`action="${ctx.proxyBase}submit?ticket=v1.test-ticket"`);
    expect(out).toContain(`poster="${ctx.proxyBase}poster.jpg?ticket=v1.test-ticket"`);
    expect(out).toContain(`<a href="${ctx.proxyBase}app/about.html?ticket=v1.test-ticket">`);
  });

  it("rewrites srcset entries (same-origin only) with descriptors intact", () => {
    const out = rewritePreviewHtml(html, ctx);
    expect(out).toContain(
      `srcset="${ctx.proxyBase}logo.png?ticket=v1.test-ticket 1x, ${ctx.proxyBase}logo@2x.png?ticket=v1.test-ticket 2x, https://cdn.example.com/l.png 3x"`,
    );
  });

  it("rewrites CSS urls in <style> and style attributes but not external URLs", () => {
    const out = rewritePreviewHtml(html, ctx);
    expect(out).toContain(`url("${ctx.proxyBase}bg.png?ticket=v1.test-ticket")`);
    expect(out).toContain(`url("https://cdn.example.com/e.png")`);
    expect(out).toContain(`url("${ctx.proxyBase}app/hero.jpg?ticket=v1.test-ticket")`);
  });

  it("never rewrites inside <script> content and drops <base> tags", () => {
    const out = rewritePreviewHtml(html, ctx);
    expect(out).toContain(`"url(never-rewritten.png)"`);
    expect(out).not.toContain("<base");
  });
});

describe("rewritePreviewCss", () => {
  it("rewrites url() refs and keeps data:/external refs", () => {
    const css = `.a{background:url(/img/a.png)} .b{background:url("data:image/png;base64,AA")} .c{background:url(https://x.dev/c.png)} .d{background:url('../img/d.png')}`;
    const out = rewritePreviewCss(css, ctx);
    expect(out).toContain(`url("${ctx.proxyBase}img/a.png?ticket=v1.test-ticket")`);
    expect(out).toContain(`url("data:image/png;base64,AA")`);
    expect(out).toContain(`url(https://x.dev/c.png)`);
    expect(out).toContain(`url("${ctx.proxyBase}img/d.png?ticket=v1.test-ticket")`);
  });
});
