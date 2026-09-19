import { api } from "./api";
import { store } from "./store";
import type { ProjectionStatus } from "./types";

// WebSocket session client (design guide §7.16.3): transient runtime
// information only — repository updates, presence, indexing progress.

let socket: WebSocket | null = null;
let retry = 1000;
let current = { view: "", edit: "" };

function send(msg: unknown) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

export function connectSession() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${proto}://${location.host}/api/ws`);
  socket.onopen = () => {
    retry = 1000;
    store.set({ connected: true });
    if (store.state.user) send({ type: "hello", name: store.state.user });
    if (current.view) send({ type: "view", guid: current.view });
    if (current.edit) send({ type: "edit", guid: current.edit, on: true });
  };
  socket.onclose = () => {
    store.set({ connected: false });
    window.setTimeout(connectSession, retry);
    retry = Math.min(retry * 2, 15000);
  };
  socket.onmessage = (ev) => {
    let msg: { type: string; [k: string]: unknown };
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    switch (msg.type) {
      case "hello":
        store.set({ session: String(msg.session ?? "") });
        if (!store.state.user) store.set({ user: String(msg.name ?? "") });
        applyStatus(msg.status as ProjectionStatus);
        break;
      case "commit":
        store.refresh();
        api.status().then((st) => store.set({ status: st })).catch(() => undefined);
        if (msg.op === "external") store.toast("Repository updated externally", "info");
        break;
      case "status":
        applyStatus(msg.status as ProjectionStatus);
        break;
      case "presence": {
        const guid = String(msg.guid);
        const presence = { ...store.state.presence, [guid]: { viewers: (msg.viewers as string[]) ?? [], editors: (msg.editors as string[]) ?? [] } };
        store.set({ presence });
        break;
      }
    }
  };
}

function applyStatus(p: ProjectionStatus | undefined) {
  if (!p) return;
  const st = store.state.status;
  const wasMaintenance = st?.projection.maintenance ?? false;
  store.set({ status: st ? { ...st, projection: p, inSync: p.processedHash === st.head } : { branch: "", head: p.processedHash, projection: p, inSync: true } });
  if (wasMaintenance && !p.maintenance) {
    store.toast("Maintenance finished", "success");
    store.refresh();
  }
}

export function announceView(guid: string) {
  current.view = guid;
  send({ type: "view", guid });
}

export function announceEdit(guid: string, on: boolean) {
  current.edit = on ? guid : "";
  send({ type: "edit", guid, on });
}

export function announceName(name: string) {
  send({ type: "hello", name });
}
