import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry } from "serwist";
import { Serwist } from "serwist";

/**
 * Serwist replaces `self.__SW_MANIFEST` at build time with the precache manifest,
 * so the literal `self.__SW_MANIFEST` token must appear below. A narrow local
 * declaration keeps this file inside the DOM-based TS program.
 */
declare const self: {
  __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
};

/**
 * Runtime caching for shell assets only. AI execution always requires the
 * network (models/tools run server-side) — offline mode shows cached pages and
 * an honest offline indicator instead of pretending agents can run.
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: "/",
        matcher({ request }: { request: Request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
