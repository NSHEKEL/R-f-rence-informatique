import { localApi } from "../api/client";
import type { UpdateStatus } from "../types";

export async function updateLocal(install = false): Promise<UpdateStatus> {
  const native = (window as unknown as { pywebview?: { api?: { update_local?: (install: boolean) => Promise<UpdateStatus> } } }).pywebview?.api?.update_local;
  if (native) return native(install);
  const response = install ? await localApi.post("/updates/install") : await localApi.get("/updates");
  return response.data;
}
