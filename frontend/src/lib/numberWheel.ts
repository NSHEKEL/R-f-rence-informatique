export function installNumberWheelGuard(doc: Document = document) {
  const onWheel = (event: WheelEvent) => {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.type === "number" && doc.activeElement === input) {
      input.blur();
    }
  };
  doc.addEventListener("wheel", onWheel, { passive: true, capture: true });
  return () => doc.removeEventListener("wheel", onWheel, true);
}
