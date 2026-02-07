import { describe, it, expect, vi, afterEach } from "vitest";
import { setupApiInterceptor } from "../../discovery/api-interceptor.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("setupApiInterceptor", () => {
  it("exposes a ready promise that resolves after listener attach", async () => {
    const tab = {
      addEventListener: vi.fn(async () => undefined),
      removeEventListener: vi.fn(async () => undefined),
    };
    const hero = {
      activeTab: Promise.resolve(tab),
    };

    const handle = setupApiInterceptor(hero as any);
    await handle.ready;

    expect(tab.addEventListener).toHaveBeenCalledTimes(1);
    expect(tab.addEventListener).toHaveBeenCalledWith("resource", expect.any(Function));
    handle.stop();
    expect(tab.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("ready resolves even if listener attach fails", async () => {
    const tab = {
      addEventListener: vi.fn(async () => {
        throw new Error("boom");
      }),
      removeEventListener: vi.fn(async () => undefined),
    };
    const hero = {
      activeTab: Promise.resolve(tab),
    };

    const handle = setupApiInterceptor(hero as any);
    await expect(handle.ready).resolves.toBeUndefined();
  });
});
