import { useEffect, type ReactNode } from "react";

export default function FrontendMounted({ children }: { children: ReactNode }) {
  useEffect(() => {
    (window as Window & { __easygestStartup?: { mounted: () => void } }).__easygestStartup?.mounted();
  }, []);
  return children;
}
