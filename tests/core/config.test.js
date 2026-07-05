import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getConfig,
  setConfig,
  getForkUrls,
  setForkUrls,
  clearForkUrls,
  getAuthorDefaults,
  setAuthorDefaults,
  clearAuthorDefaults,
  CONFIG_DIR,
} from "../../src/core/config.js";
import { ConfigError } from "../../src/core/errors.js";

// --- Helpers ---

/** Write a config.json file to the given directory. */
async function writeConfigFile(dir, data) {
  await writeFile(join(dir, "config.json"), JSON.stringify(data, null, 2));
}

/** Read and parse the config.json file from the given directory. */
async function readConfigFile(dir) {
  const content = await readFile(join(dir, "config.json"), "utf-8");
  return JSON.parse(content);
}

// --- CONFIG_DIR ---

describe("CONFIG_DIR", () => {
  it("is a non-empty string", () => {
    expect(typeof CONFIG_DIR).toBe("string");
    expect(CONFIG_DIR.length).toBeGreaterThan(0);
  });

  it("ends with .ebr", () => {
    expect(CONFIG_DIR).toMatch(/[/\\]\.ebr$/);
  });
});

// --- getConfig ---

describe("getConfig", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ebr-config-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty object when config dir does not exist", async () => {
    const result = await getConfig({ configDir: join(tmpDir, "nonexistent") });
    expect(result).toEqual({});
  });

  it("returns empty object when config file does not exist", async () => {
    const result = await getConfig({ configDir: tmpDir });
    expect(result).toEqual({});
  });

  it("returns parsed config when file exists", async () => {
    await writeConfigFile(tmpDir, {
      author: "TestCreator",
      forkRegistryUrl: "https://github.com/test/ebr-mod-registry",
    });
    const result = await getConfig({ configDir: tmpDir });
    expect(result).toEqual({
      author: "TestCreator",
      forkRegistryUrl: "https://github.com/test/ebr-mod-registry",
    });
  });

  it("throws ConfigError when file contains invalid JSON", async () => {
    await writeFile(join(tmpDir, "config.json"), "{not valid json}}}");
    await expect(getConfig({ configDir: tmpDir })).rejects.toThrow(
      ConfigError,
    );
  });

  it("ConfigError from invalid JSON has operation 'read'", async () => {
    await writeFile(join(tmpDir, "config.json"), "{{bad");
    try {
      await getConfig({ configDir: tmpDir });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect(err.operation).toBe("read");
    }
  });
});

// --- setConfig ---

describe("setConfig", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ebr-config-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates config dir and file when they do not exist", async () => {
    const newDir = join(tmpDir, "deep", "nested", ".ebr");
    await setConfig("author", "TestCreator", { configDir: newDir });
    const result = await readConfigFile(newDir);
    expect(result).toEqual({ author: "TestCreator" });
  });

  it("creates config file when dir exists but file does not", async () => {
    await setConfig("author", "TestCreator", { configDir: tmpDir });
    const result = await readConfigFile(tmpDir);
    expect(result).toEqual({ author: "TestCreator" });
  });

  it("preserves other keys when updating an existing key", async () => {
    await writeConfigFile(tmpDir, { author: "OldAuthor", version: "1.0.0" });
    await setConfig("author", "NewAuthor", { configDir: tmpDir });
    const result = await readConfigFile(tmpDir);
    expect(result).toEqual({ author: "NewAuthor", version: "1.0.0" });
  });

  it("adds a new key to existing config", async () => {
    await writeConfigFile(tmpDir, { author: "TestCreator" });
    await setConfig("authorDiscord", "creator#1234", { configDir: tmpDir });
    const result = await readConfigFile(tmpDir);
    expect(result).toEqual({
      author: "TestCreator",
      authorDiscord: "creator#1234",
    });
  });

  it("removes key when value is undefined", async () => {
    await writeConfigFile(tmpDir, { author: "TestCreator", version: "1.0.0" });
    await setConfig("author", undefined, { configDir: tmpDir });
    const result = await readConfigFile(tmpDir);
    expect(result).toEqual({ version: "1.0.0" });
    expect(result).not.toHaveProperty("author");
  });

  it("removes key when value is null", async () => {
    await writeConfigFile(tmpDir, { author: "TestCreator", version: "1.0.0" });
    await setConfig("author", null, { configDir: tmpDir });
    const result = await readConfigFile(tmpDir);
    expect(result).toEqual({ version: "1.0.0" });
    expect(result).not.toHaveProperty("author");
  });

  it("throws ConfigError when key is not a string", async () => {
    await expect(
      setConfig(123, "value", { configDir: tmpDir }),
    ).rejects.toThrow(ConfigError);
  });

  it("throws ConfigError when key is empty string", async () => {
    await expect(
      setConfig("", "value", { configDir: tmpDir }),
    ).rejects.toThrow(ConfigError);
  });

  it("writes human-readable JSON (indented)", async () => {
    await setConfig("author", "TestCreator", { configDir: tmpDir });
    const raw = await readFile(join(tmpDir, "config.json"), "utf-8");
    expect(raw).toContain("\n"); // multi-line, not compact
    expect(raw).toMatch(/^\{\n/); // starts with {\n (indented)
  });
});

// --- getForkUrls ---

describe("getForkUrls", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ebr-config-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns nulls when no config exists", async () => {
    const result = await getForkUrls({ configDir: join(tmpDir, "nonexistent") });
    expect(result).toEqual({ baseContent: null, registry: null });
  });

  it("returns nulls when config has no fork URLs", async () => {
    await writeConfigFile(tmpDir, { githubToken: "ghp_test" });
    const result = await getForkUrls({ configDir: tmpDir });
    expect(result).toEqual({ baseContent: null, registry: null });
  });

  it("returns stored fork URLs", async () => {
    await writeConfigFile(tmpDir, {
      forkBaseContentUrl: "https://github.com/user/ebr-mod-base-content",
      forkRegistryUrl: "https://github.com/user/ebr-mod-registry",
    });
    const result = await getForkUrls({ configDir: tmpDir });
    expect(result).toEqual({
      baseContent: "https://github.com/user/ebr-mod-base-content",
      registry: "https://github.com/user/ebr-mod-registry",
    });
  });
});

// --- setForkUrls ---

describe("setForkUrls", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ebr-config-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("stores both fork URLs", async () => {
    await setForkUrls({
      baseContent: "https://github.com/user/ebr-mod-base-content",
      registry: "https://github.com/user/ebr-mod-registry",
    }, { configDir: tmpDir });
    const result = await readConfigFile(tmpDir);
    expect(result.forkBaseContentUrl).toBe("https://github.com/user/ebr-mod-base-content");
    expect(result.forkRegistryUrl).toBe("https://github.com/user/ebr-mod-registry");
  });

  it("preserves other config values", async () => {
    await writeConfigFile(tmpDir, { githubToken: "ghp_test" });
    await setForkUrls({
      baseContent: "https://github.com/user/ebr-mod-base-content",
      registry: "https://github.com/user/ebr-mod-registry",
    }, { configDir: tmpDir });
    const result = await readConfigFile(tmpDir);
    expect(result.githubToken).toBe("ghp_test");
    expect(result.forkBaseContentUrl).toBe("https://github.com/user/ebr-mod-base-content");
  });

  it("can set just one URL without affecting the other", async () => {
    await writeConfigFile(tmpDir, {
      forkBaseContentUrl: "https://github.com/user/ebr-mod-base-content",
      forkRegistryUrl: "https://github.com/user/ebr-mod-registry",
    });
    await setForkUrls({ baseContent: "https://github.com/newuser/ebr-mod-base-content" }, { configDir: tmpDir });
    const result = await readConfigFile(tmpDir);
    expect(result.forkBaseContentUrl).toBe("https://github.com/newuser/ebr-mod-base-content");
    expect(result.forkRegistryUrl).toBe("https://github.com/user/ebr-mod-registry");
  });

  it("deletes a URL when set to null", async () => {
    await writeConfigFile(tmpDir, {
      forkBaseContentUrl: "https://github.com/user/ebr-mod-base-content",
      forkRegistryUrl: "https://github.com/user/ebr-mod-registry",
    });
    await setForkUrls({ registry: null }, { configDir: tmpDir });
    const result = await readConfigFile(tmpDir);
    expect(result.forkBaseContentUrl).toBe("https://github.com/user/ebr-mod-base-content");
    expect(result).not.toHaveProperty("forkRegistryUrl");
  });
});

// --- clearForkUrls ---

describe("clearForkUrls", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ebr-config-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("removes both fork URLs from config", async () => {
    await writeConfigFile(tmpDir, {
      githubToken: "ghp_test",
      forkBaseContentUrl: "https://github.com/user/ebr-mod-base-content",
      forkRegistryUrl: "https://github.com/user/ebr-mod-registry",
    });
    await clearForkUrls({ configDir: tmpDir });
    const result = await readConfigFile(tmpDir);
    expect(result).toEqual({ githubToken: "ghp_test" });
    expect(result).not.toHaveProperty("forkBaseContentUrl");
    expect(result).not.toHaveProperty("forkRegistryUrl");
  });

  it("does not throw when no fork URLs exist", async () => {
    await writeConfigFile(tmpDir, { githubToken: "ghp_test" });
    await expect(clearForkUrls({ configDir: tmpDir })).resolves.not.toThrow();
  });
});

// --- getAuthorDefaults ---

describe("getAuthorDefaults", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ebr-config-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns nulls when no config exists", async () => {
    const result = await getAuthorDefaults({ configDir: join(tmpDir, "nonexistent") });
    expect(result).toEqual({ author: null, authorDiscord: null });
  });

  it("returns nulls when config has no author defaults", async () => {
    await writeConfigFile(tmpDir, { githubToken: "ghp_test" });
    const result = await getAuthorDefaults({ configDir: tmpDir });
    expect(result).toEqual({ author: null, authorDiscord: null });
  });

  it("returns stored author defaults", async () => {
    await writeConfigFile(tmpDir, {
      authorName: "TestCreator",
      authorDiscord: "testcreator",
    });
    const result = await getAuthorDefaults({ configDir: tmpDir });
    expect(result).toEqual({
      author: "TestCreator",
      authorDiscord: "testcreator",
    });
  });

  it("returns author without discord", async () => {
    await writeConfigFile(tmpDir, { authorName: "TestCreator" });
    const result = await getAuthorDefaults({ configDir: tmpDir });
    expect(result).toEqual({ author: "TestCreator", authorDiscord: null });
  });
});

// --- setAuthorDefaults ---

describe("setAuthorDefaults", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ebr-config-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("stores both author name and discord", async () => {
    await setAuthorDefaults({
      author: "TestCreator",
      authorDiscord: "testcreator",
    }, { configDir: tmpDir });
    const result = await readConfigFile(tmpDir);
    expect(result.authorName).toBe("TestCreator");
    expect(result.authorDiscord).toBe("testcreator");
  });

  it("preserves other config values", async () => {
    await writeConfigFile(tmpDir, { githubToken: "ghp_test" });
    await setAuthorDefaults({ author: "TestCreator" }, { configDir: tmpDir });
    const result = await readConfigFile(tmpDir);
    expect(result.githubToken).toBe("ghp_test");
    expect(result.authorName).toBe("TestCreator");
  });

  it("can set just author without affecting discord", async () => {
    await writeConfigFile(tmpDir, { authorName: "Old", authorDiscord: "old_discord" });
    await setAuthorDefaults({ author: "New" }, { configDir: tmpDir });
    const result = await readConfigFile(tmpDir);
    expect(result.authorName).toBe("New");
    expect(result.authorDiscord).toBe("old_discord");
  });

  it("skips discord when not provided", async () => {
    await writeConfigFile(tmpDir, { authorName: "Test", authorDiscord: "old" });
    await setAuthorDefaults({ author: "New" }, { configDir: tmpDir });
    const result = await readConfigFile(tmpDir);
    expect(result.authorName).toBe("New");
    expect(result.authorDiscord).toBe("old");
  });

  it("deletes discord when set to null", async () => {
    await writeConfigFile(tmpDir, { authorName: "Test", authorDiscord: "old" });
    await setAuthorDefaults({ authorDiscord: null }, { configDir: tmpDir });
    const result = await readConfigFile(tmpDir);
    expect(result.authorName).toBe("Test");
    expect(result).not.toHaveProperty("authorDiscord");
  });

  it("deletes author when set to null", async () => {
    await writeConfigFile(tmpDir, { authorName: "Test", authorDiscord: "handle" });
    await setAuthorDefaults({ author: null }, { configDir: tmpDir });
    const result = await readConfigFile(tmpDir);
    expect(result).not.toHaveProperty("authorName");
    expect(result.authorDiscord).toBe("handle");
  });
});

// --- clearAuthorDefaults ---

describe("clearAuthorDefaults", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ebr-config-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("removes author defaults from config", async () => {
    await writeConfigFile(tmpDir, {
      githubToken: "ghp_test",
      authorName: "TestCreator",
      authorDiscord: "testcreator",
    });
    await clearAuthorDefaults({ configDir: tmpDir });
    const result = await readConfigFile(tmpDir);
    expect(result).toEqual({ githubToken: "ghp_test" });
    expect(result).not.toHaveProperty("authorName");
    expect(result).not.toHaveProperty("authorDiscord");
  });

  it("does not throw when no author defaults exist", async () => {
    await writeConfigFile(tmpDir, { githubToken: "ghp_test" });
    await expect(clearAuthorDefaults({ configDir: tmpDir })).resolves.not.toThrow();
  });
});
