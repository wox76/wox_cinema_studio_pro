// WoxOS Inter-Window Communication Bus
// Connects the WoxOS desktop shell and all open app windows via BroadcastChannel + postMessage.

const CHANNEL_NAME = "wox-os-bus";

export function isOsEmbedded() {
  try {
    return new URLSearchParams(location.search).get("os_win") === "1" || window.self !== window.top;
  } catch {
    return true;
  }
}

export function getOsWindowId() {
  try {
    return new URLSearchParams(location.search).get("win_id") || "";
  } catch {
    return "";
  }
}

export function createOsBus() {
  let bc = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel(CHANNEL_NAME);
    }
  } catch {
    bc = null;
  }

  const listeners = new Set();
  const seenIds = new Set();
  let seq = 0;

  function dispatch(msg) {
    if (!msg || typeof msg !== "object" || !msg.type) return;
    if (msg._id) {
      if (seenIds.has(msg._id)) return;
      seenIds.add(msg._id);
      if (seenIds.size > 400) {
        const first = seenIds.values().next().value;
        seenIds.delete(first);
      }
    }
    for (const fn of listeners) {
      try {
        fn(msg);
      } catch (err) {
        console.warn("[WoxOSBus] listener error:", err);
      }
    }
  }

  if (bc) {
    bc.onmessage = (e) => dispatch(e.data);
  }

  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin) return;
    if (e.data && typeof e.data === "object" && String(e.data.type || "").startsWith("wox:")) {
      dispatch(e.data);
    }
  });

  return {
    send(msg) {
      seq += 1;
      const payload = {
        ...msg,
        _id: msg._id || `${getOsWindowId() || "desktop"}-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 7)}`,
        _ts: Date.now(),
        _from: getOsWindowId() || "desktop",
      };
      if (bc) {
        try { bc.postMessage(payload); } catch { /* ignore */ }
      }
      if (isOsEmbedded()) {
        try { window.parent.postMessage(payload, location.origin); } catch { /* ignore */ }
      }
    },
    sendToFrame(iframe, msg) {
      if (!iframe?.contentWindow) return;
      try {
        iframe.contentWindow.postMessage({ ...msg, _ts: Date.now(), _from: "desktop" }, location.origin);
      } catch { /* ignore */ }
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const osBus = createOsBus();
