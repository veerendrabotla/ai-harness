"use client";

import { useEffect, useState } from "react";

export type Breakpoint = "mobile" | "tablet" | "desktop";

export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>("desktop");

  useEffect(() => {
    const mq = window.matchMedia;
    const mobile = mq("(max-width: 767px)");
    const tablet = mq("(min-width: 768px) and (max-width: 1023px)");

    const update = () => {
      if (mobile.matches) setBreakpoint("mobile");
      else if (tablet.matches) setBreakpoint("tablet");
      else setBreakpoint("desktop");
    };

    update();
    mobile.addEventListener("change", update);
    tablet.addEventListener("change", update);
    return () => {
      mobile.removeEventListener("change", update);
      tablet.removeEventListener("change", update);
    };
  }, []);

  return breakpoint;
}
