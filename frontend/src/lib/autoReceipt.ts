export function automaticReceipt(enabled: boolean, printer: string | undefined) {
  return enabled && Boolean(printer?.trim());
}
