// @vitest-environment happy-dom

import { createApp, defineComponent, h, nextTick, reactive, type App } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { ConnectionConfig } from "@/types/database";

const { store, settings, backend } = vi.hoisted(() => ({
  store: {
    connectionGroupOptions: [],
    newConnectionGroupId: null,
    selectedConnectionGroupId: null,
    addConnection: vi.fn(),
    updateConnection: vi.fn(),
    connect: vi.fn(),
    ensureConnected: vi.fn(),
    addEphemeralConnection: vi.fn(),
    removeConnection: vi.fn(),
    startEditing: vi.fn(),
    stopEditing: vi.fn(),
    clearConnectionError: vi.fn(),
    updateConnectionDatabaseInfo: vi.fn(),
    applyGlobalTimeouts: vi.fn((config) => config),
    getConfig: vi.fn(),
  },
  settings: {
    editorSettings: { sidebarShowConnectionNotes: false, globalConnectTimeoutSecs: 10, globalQueryTimeoutSecs: 0, redisValuePreviewLimitKiB: 64 },
    rememberedDatabaseForConnection: vi.fn(() => ""),
    persistEditorSettings: vi.fn(),
    updateEditorSettings: vi.fn(),
    updateEditorSettingsAndPersist: vi.fn(),
  },
  backend: {
    connectDb: vi.fn(),
    disconnectDb: vi.fn(),
    testConnectionWithInfo: vi.fn().mockResolvedValue({ ok: true, message: "Connected successfully" }),
    listDatabases: vi.fn(),
    listPlugins: vi.fn().mockResolvedValue([]),
    listJdbcDrivers: vi.fn().mockResolvedValue([]),
    listJdbcMavenBundles: vi.fn().mockResolvedValue([]),
    listJdbcLocalBundles: vi.fn().mockResolvedValue([]),
    listSshConfigHosts: vi.fn().mockResolvedValue([]),
    listInstalledAgentsLocal: vi.fn().mockResolvedValue([]),
    listenAgentInstallProgress: vi.fn(),
  },
}));

vi.mock("@/stores/connectionStore", () => ({ useConnectionStore: () => store, CONNECTION_ATTEMPT_CANCELLED_MESSAGE: "cancelled" }));
vi.mock("@/stores/settingsStore", async (original) => ({ ...(await original<typeof import("@/stores/settingsStore")>()), useSettingsStore: () => settings }));
vi.mock("@/stores/tunnelProfileStore", () => ({ useTunnelProfileStore: () => ({ profiles: [], profileById: () => undefined, init: vi.fn() }) }));
vi.mock("@/lib/backend/api", async (original) => ({ ...(await original<typeof import("@/lib/backend/api")>()), ...backend }));
vi.mock("@/lib/backend/tauriRuntime", () => ({ isTauriRuntime: () => false }));
vi.mock("@/composables/useToast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/components/ui/tooltip", async () => {
  const { defineComponent, h } = await import("vue");
  const pass = defineComponent({
    setup:
      (_props, { slots }) =>
      () =>
        h("div", slots.default?.()),
  });
  return { Tooltip: pass, TooltipContent: pass, TooltipProvider: pass, TooltipTrigger: pass, HelpTooltip: pass };
});

vi.mock("@/components/ui/dialog", async () => {
  const { defineComponent, h } = await import("vue");
  const passthrough = defineComponent({
    setup:
      (_props, { slots }) =>
      () =>
        h("div", slots.default?.()),
  });
  const Dialog = defineComponent({
    props: { open: Boolean },
    emits: ["update:open"],
    setup:
      (props, { slots }) =>
      () =>
        props.open ? h("section", slots.default?.()) : null,
  });
  return { Dialog, DialogContent: passthrough, DialogHeader: passthrough, DialogTitle: passthrough, DialogFooter: passthrough };
});

import ConnectionDialog from "../ConnectionDialog.vue";

describe("ConnectionDialog Redis editing (#13826)", () => {
  let app: App | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    app?.unmount();
    container?.remove();
    app = null;
    container = null;
  });

  async function mountDialog(config: ConnectionConfig) {
    store.getConfig.mockReturnValue(config);
    container = document.createElement("div");
    document.body.appendChild(container);
    app = createApp({
      setup() {
        return () => h(ConnectionDialog, { open: true, editConfig: config });
      },
    });
    app.use(i18n);
    app.mount(container);
    await nextTick();
    await nextTick();
  }

  it("switches tabs between basic, advanced, and transport and saves redis connection with undefined username", async () => {
    const config: ConnectionConfig = {
      id: "redis-edit-1",
      name: "Redis Production",
      db_type: "redis",
      driver_profile: "redis",
      driver_label: "Redis",
      host: "127.0.0.1",
      port: 6379,
      database: "0",
      // Notice username is omitted/undefined (Redis 5 default without ACL)
    };

    await mountDialog(config);

    const triggers = () => [...document.querySelectorAll('[data-slot="tabs-trigger"]')];

    // Find and switch to "Advanced" tab
    const advancedTrigger = triggers().find((t) => t.textContent?.includes("高级") || t.textContent?.toLowerCase().includes("advanced"));
    expect(advancedTrigger).toBeTruthy();
    advancedTrigger!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    await nextTick();
    await nextTick();

    expect(document.querySelector('[data-slot="tabs-trigger"][data-state="active"]')?.textContent).toContain("Advanced");

    // Find and switch to "SSH Tunnel" tab
    const transportTrigger = triggers().find((t) => t.textContent?.includes("隧道") || t.textContent?.toLowerCase().includes("tunnel"));
    expect(transportTrigger).toBeTruthy();
    transportTrigger!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    await nextTick();
    await nextTick();

    expect(document.querySelector('[data-slot="tabs-trigger"][data-state="active"]')?.textContent).toContain("Tunnel");

    // Switch back to "Basic" (Connection) tab
    const connectionTrigger = triggers().find((t) => t.textContent?.includes("基础") || t.textContent?.toLowerCase().includes("connection"));
    expect(connectionTrigger).toBeTruthy();
    connectionTrigger!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    await nextTick();
    await nextTick();

    expect(document.querySelector('[data-slot="tabs-trigger"][data-state="active"]')?.textContent).toContain("Connection");

    // Click "Save" button
    const saveButton = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Save") || b.textContent?.includes("保存"));
    expect(saveButton).toBeTruthy();
    saveButton!.click();

    await vi.waitFor(() => expect(store.updateConnection).toHaveBeenCalledOnce());
    expect(store.updateConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "redis-edit-1",
        name: "Redis Production",
        db_type: "redis",
        host: "127.0.0.1",
        port: 6379,
      }),
    );
  });

  it("tests connection without crashing when username is undefined", async () => {
    const config: ConnectionConfig = {
      id: "redis-test-1",
      name: "Redis Standalone",
      db_type: "redis",
      driver_profile: "redis",
      driver_label: "Redis",
      host: "127.0.0.1",
      port: 6379,
      database: "0",
    };

    await mountDialog(config);

    const testButton = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Test" || b.textContent?.trim() === "测试");
    expect(testButton).toBeTruthy();
    testButton!.click();

    await vi.waitFor(() => expect(backend.testConnectionWithInfo).toHaveBeenCalledOnce());
  });
});
