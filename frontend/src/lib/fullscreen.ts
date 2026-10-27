/**
 * Full screen for the counter.
 *
 * Inside the Windows window the page cannot resize its host, so the native
 * bridge is used when it is there; in a browser the standard API is enough.
 */
function nativeApi(): { toggle_fullscreen?: () => Promise<boolean> } | undefined {
  return (
    window as unknown as {
      pywebview?: { api?: { toggle_fullscreen?: () => Promise<boolean> } };
    }
  ).pywebview?.api;
}

let nativeFullscreen = false;

export function isFullscreen(): boolean {
  return document.fullscreenElement !== null || nativeFullscreen;
}

export async function toggleFullscreen(): Promise<void> {
  const native = nativeApi()?.toggle_fullscreen;
  if (native) {
    await native();
    nativeFullscreen = !nativeFullscreen;
    return;
  }
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => undefined);
    return;
  }
  await document.documentElement.requestFullscreen().catch(() => undefined);
}

export async function enterFullscreen(): Promise<void> {
  if (isFullscreen()) return;
  await toggleFullscreen();
}

export async function leaveFullscreen(): Promise<void> {
  if (!isFullscreen()) return;
  await toggleFullscreen();
}
