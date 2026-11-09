export async function saveReportFile(name: string, body: string | Uint8Array, mime: string): Promise<string> {
  const api = (window as unknown as { pywebview?: { api?: { save_file?: (name: string, body: string) => Promise<string>; save_binary_file?: (name: string, base64: string) => Promise<string> } } }).pywebview?.api;
  if (api) {
    if (typeof body === "string" && api.save_file) return (await api.save_file(name, body)) || "";
    if (body instanceof Uint8Array && api.save_binary_file) {
      let binary = "";
      for (let offset = 0; offset < body.length; offset += 8192) binary += String.fromCharCode(...body.subarray(offset, offset + 8192));
      return (await api.save_binary_file(name, btoa(binary))) || "";
    }
    throw new Error("Mettez ce poste à jour pour enregistrer cet export.");
  }
  const blob = new Blob([typeof body === "string" ? body : new Uint8Array(body).buffer], { type: mime });
  const picker = (window as unknown as { showSaveFilePicker?: (options: object) => Promise<{ createWritable: () => Promise<{ write: (blob: Blob) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName: name });
      const writer = await handle.createWritable();
      await writer.write(blob);
      await writer.close();
      return name;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "";
      throw error;
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally { URL.revokeObjectURL(url); }
  return name;
}
