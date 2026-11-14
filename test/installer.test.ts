import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, resolve, win32 } from "node:path";
import {
  buildExtraModelPathsYaml,
  comfyDirCandidates,
  createModelAliasLink,
  InstallerManager,
  proxyBinaryCandidates,
  pythonCandidates,
} from "../server/installer.ts";

function makeTempWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "wox-installer-test-"));
  const root = join(dir, "repo");
  const comfyDir = join(dir, "ComfyUI");
  const modelsDir = join(dir, "models");
  mkdirSync(root, { recursive: true });
  mkdirSync(comfyDir, { recursive: true });
  mkdirSync(modelsDir, { recursive: true });

  // Copy packs & custom_nodes/freefield so InstallerManager works isolated from real repo
  const realRoot = resolve(process.cwd());
  if (existsSync(join(realRoot, "packs"))) {
    cpSync(join(realRoot, "packs"), join(root, "packs"), { recursive: true });
  }
  if (existsSync(join(realRoot, "custom_nodes"))) {
    cpSync(join(realRoot, "custom_nodes"), join(root, "custom_nodes"), { recursive: true });
  }
  return { dir, root, comfyDir, modelsDir };
}

test("comfyDirCandidates covers Linux and Windows install layouts", () => {
  const lin = comfyDirCandidates("/opt/freefield", "linux", "/home/alice", {});
  assert.ok(lin.includes("/home/alice/opt/ComfyUI"));
  assert.ok(lin.includes("/home/alice/ComfyUI"));
  assert.ok(lin.includes(resolve("/opt/freefield", "..", "ComfyUI")));

  const win = comfyDirCandidates("C:\\freefield", "win32", "C:\\Users\\Alice", {
    COMFYUI_DIR: "E:\\AI\\ComfyUI",
    LOCALAPPDATA: "C:\\Users\\Alice\\AppData\\Local",
  });
  assert.equal(win[0], win32.resolve("E:\\AI\\ComfyUI"));
  assert.ok(win.some((c) => c.includes("ComfyUI_windows_portable")));
  assert.ok(win.includes("C:\\ComfyUI"));
  assert.ok(win.includes("D:\\ComfyUI"));
  assert.ok(win.some((c) => c.includes("@comfyorgcomfyui-electron")));
});

test("pythonCandidates & proxyBinaryCandidates detect venv and Windows Portable", () => {
  const linPy = pythonCandidates("/srv/ComfyUI", "/srv/freefield", "linux", {});
  assert.ok(linPy.includes(posix.join("/srv/ComfyUI", "venv", "bin", "python")));
  assert.ok(linPy.includes(posix.join("/srv/ComfyUI", ".venv", "bin", "python")));

  const winPy = pythonCandidates("C:\\ComfyUI_windows_portable\\ComfyUI", "C:\\freefield", "win32", {});
  assert.ok(winPy.includes(win32.join("C:\\ComfyUI_windows_portable\\ComfyUI", "venv", "Scripts", "python.exe")));
  assert.ok(winPy.includes(win32.resolve("C:\\ComfyUI_windows_portable\\ComfyUI", "..", "python_embeded", "python.exe")));
  assert.ok(winPy.includes(win32.resolve("C:\\ComfyUI_windows_portable\\ComfyUI", "..", "python_embedded", "python.exe")));

  const winProxyVenv = proxyBinaryCandidates(
    "C:\\ComfyUI",
    "C:\\ComfyUI\\venv\\Scripts\\python.exe",
    "win32"
  );
  assert.ok(winProxyVenv.includes(win32.join("C:\\ComfyUI\\venv\\Scripts", "comfy-api-proxy.exe")));

  const winProxyPortable = proxyBinaryCandidates(
    "C:\\ComfyUI_windows_portable\\ComfyUI",
    "C:\\ComfyUI_windows_portable\\python_embeded\\python.exe",
    "win32"
  );
  assert.ok(winProxyPortable.includes(win32.join("C:\\ComfyUI_windows_portable\\python_embeded\\Scripts", "comfy-api-proxy.exe")));

  const linProxy = proxyBinaryCandidates("/srv/ComfyUI", "/srv/ComfyUI/venv/bin/python", "linux");
  assert.ok(linProxy.includes(posix.join("/srv/ComfyUI/venv/bin", "comfy-api-proxy")));
});

test("buildExtraModelPathsYaml normalizes Windows backslashes and includes insightface", () => {
  const yaml = buildExtraModelPathsYaml("C:\\Users\\Wox\\ComfyUI\\models");
  assert.ok(yaml.includes("base_path: C:/Users/Wox/ComfyUI/models"));
  assert.ok(!yaml.includes("\\"));
  assert.ok(yaml.includes("  checkpoints: checkpoints"));
  assert.ok(yaml.includes("  insightface: insightface"));
  assert.ok(yaml.includes("  facerestore_models: facerestore_models"));
});

test("createModelAliasLink removes dangling symlink and links real file cleanly", () => {
  const dir = mkdtempSync(join(tmpdir(), "wox-alias-test-"));
  try {
    const models = join(dir, "models");
    const altPath = join(models, "checkpoints", "flux.safetensors");
    const targetPath = join(models, "diffusion_models", "flux.safetensors");
    mkdirSync(join(models, "checkpoints"), { recursive: true });
    mkdirSync(join(models, "diffusion_models"), { recursive: true });

    // Create a broken symlink at targetPath
    symlinkSync(join(dir, "missing-target.safetensors"), targetPath);
    assert.ok(lstatSync(targetPath).isSymbolicLink());
    assert.equal(existsSync(targetPath), false);

    // Write the real source model at altPath
    writeFileSync(altPath, "weights-data");

    const ok = createModelAliasLink(altPath, targetPath);
    assert.equal(ok, true);
    assert.equal(existsSync(targetPath), true);
    assert.equal(readFileSync(targetPath, "utf-8"), "weights-data");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("InstallerManager settings persistence, env/token updates, node & model status", async () => {
  const { dir, root, comfyDir, modelsDir } = makeTempWorkspace();
  const prevHf = process.env.HF_TOKEN;
  const prevHfHome = process.env.HF_HOME;
  const prevDrafts = process.env.FREEFIELD_DRAFTS;
  const prevWoxDrafts = process.env.WOX_DRAFTS;

  try {
    process.env.HF_HOME = join(dir, "hf_home");
    delete process.env.HF_TOKEN;

    const mgr = new InstallerManager(root);
    mgr.updateSettings({
      comfy_dir: comfyDir,
      models_dir: modelsDir,
      hf_token: "hf_test_token_12345",
      drafts: true,
    });

    // Reload from out/settings.json in a fresh InstallerManager
    const mgr2 = new InstallerManager(root);
    assert.equal(mgr2.detectComfyDir(), comfyDir);
    assert.equal(mgr2.detectModelsDir(), modelsDir);

    const envText = readFileSync(join(root, ".env"), "utf-8");
    assert.match(envText, /^HF_TOKEN=hf_test_token_12345$/m);
    assert.match(envText, /^FREEFIELD_DRAFTS=1$/m);
    assert.equal(readFileSync(join(dir, "hf_home", "token"), "utf-8"), "hf_test_token_12345");

    // Simulate an installed ComfyUI + python venv + proxy + qwenmultiangle node + model
    writeFileSync(join(comfyDir, "main.py"), "# dummy main\n");
    const pyBinDir = process.platform === "win32" ? join(comfyDir, "venv", "Scripts") : join(comfyDir, "venv", "bin");
    mkdirSync(pyBinDir, { recursive: true });
    writeFileSync(join(pyBinDir, process.platform === "win32" ? "python.exe" : "python"), "");
    writeFileSync(join(pyBinDir, process.platform === "win32" ? "comfy-api-proxy.exe" : "comfy-api-proxy"), "");
    writeFileSync(join(comfyDir, "extra_model_paths.yaml"), buildExtraModelPathsYaml(modelsDir));

    const qwenNodeDir = join(comfyDir, "custom_nodes", "ComfyUI-qwenmultiangle");
    mkdirSync(qwenNodeDir, { recursive: true });
    writeFileSync(join(qwenNodeDir, "__init__.py"), "# dummy node\n");

    const status = mgr2.getStatus();
    assert.equal(status.comfy_exists, true);
    assert.equal(status.hf_token_configured, true);
    assert.equal(status.drafts_allowed, true);

    const backendDeps = status.nodes.find((n) => n.id === "backend-deps");
    assert.equal(backendDeps?.installed, true);

    const qwenNode = status.nodes.find((n) => n.id === "comfyui-qwenmultiangle");
    assert.equal(qwenNode?.installed, true);

    const refNode = status.nodes.find((n) => n.id === "reference-multi-latent");
    assert.equal(refNode?.installed, false);

    // Install bundled_file node via real InstallerManager job
    const startRes = mgr2.startJob({ action: "install_nodes", nodes: ["reference-multi-latent"] });
    assert.equal(startRes.error, null);

    for (let i = 0; i < 40; i++) {
      const st = mgr2.getStatus();
      if (st.task?.status !== "running") break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const after = mgr2.getStatus();
    assert.equal(after.task?.status, "completed");
    assert.equal(existsSync(join(comfyDir, "custom_nodes", "reference_multi_latent.py")), true);
    assert.equal(after.nodes.find((n) => n.id === "reference-multi-latent")?.installed, true);
  } finally {
    if (prevHf !== undefined) process.env.HF_TOKEN = prevHf;
    else delete process.env.HF_TOKEN;
    if (prevHfHome !== undefined) process.env.HF_HOME = prevHfHome;
    else delete process.env.HF_HOME;
    if (prevDrafts !== undefined) process.env.FREEFIELD_DRAFTS = prevDrafts;
    else delete process.env.FREEFIELD_DRAFTS;
    if (prevWoxDrafts !== undefined) process.env.WOX_DRAFTS = prevWoxDrafts;
    else delete process.env.WOX_DRAFTS;
    rmSync(dir, { recursive: true, force: true });
  }
});
