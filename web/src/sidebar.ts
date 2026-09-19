import { LitElement, html, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api } from "./api";
import { navigate } from "./router";
import { store, type State } from "./store";
import type { FolderInfo, Schema } from "./types";
import { displayName, kindPlural } from "./util";

// Repository navigation (design guide §7.3): search, subtree toggle, the
// physical folder hierarchy, and artifacts grouped by schema type.

interface Node { info: FolderInfo; children: Node[] | null; open: boolean; pending?: boolean }

@customElement("groundsill-sidebar")
export class Sidebar extends LitElement {
  private unsub?: () => void;
  private s!: State;
  @state() private root: Node = { info: { name: "Repository", path: "", artifacts: 0, hasConfig: false }, children: null, open: true };
  @state() private types: Schema[] = [];
  @state() private counts: Record<string, number> = {};
  @state() private q = "";
  private lastTick = -1;
  private lastFolder: string | null = null;
  private lastRouteQ: string | null = null;
  private timer = 0;
  private rootLoading: Promise<void> = Promise.resolve();

  override createRenderRoot() { return this; }
  override connectedCallback() {
    super.connectedCallback();
    this.unsub = store.subscribe((s) => {
      const first = !this.s;
      this.s = s;
      if (first || s.refreshTick !== this.lastTick) {
        this.lastTick = s.refreshTick;
        this.reloadAll();
      }
      if (s.route.folder !== this.lastFolder) {
        this.lastFolder = s.route.folder;
        this.expandTo(s.route.folder);
        this.loadTypes(s.route.folder);
      }
      if (s.route.q !== this.lastRouteQ) { this.lastRouteQ = s.route.q; this.q = s.route.q; } // never wipe text being typed
      this.requestUpdate();
    });
  }
  override disconnectedCallback() { this.unsub?.(); super.disconnectedCallback(); }

  private async reloadAll() {
    // Serialize with expandTo: a folder change arriving while the tree is
    // being reloaded must expand the new tree, not the one being replaced.
    const run = async () => {
      this.root = { ...this.root, children: null };
      await this.load(this.root);
    };
    this.rootLoading = this.rootLoading.then(run, run);
    await this.rootLoading;
    await this.expandTo(this.s.route.folder);
    this.loadTypes(this.s.route.folder);
  }

  private async load(n: Node) {
    try {
      const t = await api.tree(n.info.path, false, 1);
      n.children = t.folders.map((f) => ({ info: f, children: null, open: false }));
    } catch {
      n.children = [];
    }
    this.requestUpdate();
  }

  private async expandTo(folder: string) {
    await this.rootLoading;
    if (!this.root.children) await this.load(this.root);
    let cur = this.root;
    const parts = folder.split("/").filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let next = cur.children?.find((c) => c.info.path === path);
      if (!next) {
        // folder not known yet (freshly created, or planned with "New folder"): add a placeholder node
        next = { info: { name: parts[i], path, artifacts: 0, hasConfig: false }, children: null, open: false, pending: true };
        cur.children = [...(cur.children ?? []), next];
      }
      next.open = true;
      if (!next.children) await this.load(next);
      cur = next;
    }
    this.requestUpdate();
  }

  private async loadTypes(folder: string) {
    try {
      const [t, counts] = await Promise.all([api.types(folder), api.search({ path: folder, subtree: true, kind: "entry,document", limit: 1 }).then(() => this.typeCounts(folder))]);
      this.types = t.types;
      this.counts = counts;
    } catch {
      /* keep old */
    }
  }

  private async typeCounts(folder: string): Promise<Record<string, number>> {
    const st = await api.status().catch(() => null);
    if (!folder && st?.stats) return st.stats.types;
    const r = await api.search({ path: folder, subtree: true, kind: "entry,document", limit: 5000 });
    const c: Record<string, number> = {};
    for (const a of r.artifacts) c[a.type] = (c[a.type] ?? 0) + 1;
    return c;
  }

  // Folders exist only through their content (Git tracks no empty
  // directories), so a new folder is a destination: it is shown as a
  // placeholder and becomes real with the first artifact saved there.
  private newFolder = async () => {
    const parent = this.s.route.folder;
    const name = await store.prompt("New folder", {
      text: `Subfolder of ${parent || "the repository root"}. It is created with the first artifact you save in it.`,
      placeholder: "name or sub/path", confirmLabel: "Open",
    });
    const rel = (name ?? "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!rel) return;
    navigate({ folder: parent ? `${parent}/${rel}` : rel, guid: null, type: "", q: "" });
  };

  private toggle(n: Node) {
    n.open = !n.open;
    if (n.open && !n.children) this.load(n);
    this.requestUpdate();
  }

  private node(n: Node, depth: number): TemplateResult {
    const r = this.s.route;
    const selected = r.folder === n.info.path && !r.type;
    const hasKids = n.children === null || n.children.length > 0;
    return html`<li>
      <div class="row ${selected ? "selected" : ""} ${n.pending ? "pending" : ""}" title=${n.pending ? "Not in the repository yet: created with the first artifact saved here" : ""} data-folder=${n.info.path} @click=${() => { navigate({ folder: n.info.path, guid: null, type: "", q: "" }); store.closeNavIfOverlay(); }}>
        <span class="caret ${hasKids ? "" : "empty"}" @click=${(e: Event) => { e.stopPropagation(); this.toggle(n); }}>${n.open ? "▾" : "▸"}</span>
        <span class="name">${depth === 0 ? html`<b>${n.info.name}</b>` : n.info.name}</span>
        ${n.info.hasConfig ? html`<span class="badge" title="has a .groundsill metadata directory">.groundsill</span>` : nothing}
        ${n.info.artifacts ? html`<span class="count">${n.info.artifacts}</span>` : nothing}
      </div>
      ${n.open && n.children?.length ? html`<ul>${n.children.map((c) => this.node(c, depth + 1))}</ul>` : nothing}
    </li>`;
  }

  override render() {
    if (!this.s) return nothing;
    const r = this.s.route;
    const groups: Record<string, Schema[]> = {};
    for (const t of this.types) if (t.kind === "entry" || t.kind === "document") (groups[t.kind] ??= []).push(t);
    return html`
      <div class="nav-search">
        <input type="search" placeholder="Search (title, HID, text)…  /" .value=${this.q} data-test="search"
          @input=${(e: Event) => { this.q = (e.target as HTMLInputElement).value; window.clearTimeout(this.timer); this.timer = window.setTimeout(() => navigate({ q: this.q, guid: null }, true), 250); }}
          @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter") { window.clearTimeout(this.timer); navigate({ q: this.q, guid: null }); } }} />
        <label class="nav-toggle"><span>Include subfolders (subtree)</span>
          <input type="checkbox" .checked=${r.subtree} data-test="subtree" @change=${(e: Event) => navigate({ subtree: (e.target as HTMLInputElement).checked })} /></label>
      </div>
      <div class="nav-scroll">
        <div class="nav-section"><div class="nav-title"><span>Folders</span>
          <button class="btn sm" data-test="new-folder" title="New subfolder of the current folder" @click=${this.newFolder}>＋</button></div>
          <ul class="tree">${this.node(this.root, 0)}</ul></div>
        <div class="nav-section"><div class="nav-title"><span>By type${r.folder ? html` <span class="muted">in ${r.folder}</span>` : nothing}</span></div>
          ${!this.types.length ? html`<div class="muted small" style="padding:4px 8px">No schemas visible here yet.</div>` : nothing}
          <ul class="tree">${(["entry", "document"] as const).filter((k) => groups[k]?.length).map((k) => html`<li>
            <div class="row"><span class="caret">▾</span><span class="name muted">${kindPlural[k]}</span></div>
            <ul>${groups[k].map((t) => html`<li><div class="row ${r.type === t.type ? "selected" : ""}" data-type=${t.type}
              @click=${() => { navigate({ type: t.type, kind: k, guid: null, subtree: true }); store.closeNavIfOverlay(); }}>
              <span class="caret empty">·</span><span class="name">${displayName(t, t.type)}</span>
              ${this.counts[t.type] ? html`<span class="count">${this.counts[t.type]}</span>` : nothing}</div></li>`)}</ul></li>`)}</ul></div>
      </div>`;
  }
}
