import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./registry.ts";

export type ThermalStatus = {
  supported: boolean;
  enabled: boolean;
  threshold: number;
  critical_threshold: number;
  current_temp: number | null;
  power_draw: number | null;
  utilization: number | null;
  state: "optimal" | "warm" | "throttling" | "critical" | "unknown";
  throttled: boolean;
  cool_cycles: number;
};

class ThermalGuard {
  private configPath: string;
  private enabled = true;
  private threshold = 78; // °C target ceiling
  private criticalThreshold = 83; // °C emergency ceiling
  private currentTemp: number | null = null;
  private powerDraw: number | null = null;
  private utilization: number | null = null;
  private state: ThermalStatus["state"] = "optimal";
  private throttled = false;
  private coolCycles = 0;
  private supported = true;
  private pausedPids = new Set<number>();
  private timer: NodeJS.Timeout | null = null;
  private dutyState: "running" | "paused" = "running";
  private dutySwitchTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.configPath = join(repoRoot(), "out", "safe_mode.json");
    this.loadConfig();
    this.start();

    const cleanup = () => this.resumeAll();
    process.on("exit", cleanup);
    process.on("SIGINT", () => { cleanup(); process.exit(0); });
    process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  }

  private loadConfig() {
    try {
      if (existsSync(this.configPath)) {
        const data = JSON.parse(readFileSync(this.configPath, "utf-8"));
        if (typeof data.enabled === "boolean") this.enabled = data.enabled;
        if (typeof data.threshold === "number" && data.threshold >= 60 && data.threshold <= 90) {
          this.threshold = data.threshold;
          this.criticalThreshold = Math.min(88, this.threshold + 5);
        }
      }
    } catch {
      /* use defaults */
    }
  }

  private saveConfig() {
    try {
      const outDir = join(repoRoot(), "out");
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      writeFileSync(this.configPath, JSON.stringify({
        enabled: this.enabled,
        threshold: this.threshold,
        critical_threshold: this.criticalThreshold,
      }, null, 2) + "\n");
    } catch {
      /* ignore write failure */
    }
  }

  configure(opts: { enabled?: boolean; threshold?: number }): ThermalStatus {
    if (typeof opts.enabled === "boolean") {
      this.enabled = opts.enabled;
      if (!this.enabled) {
        this.resumeAll();
        this.throttled = false;
      }
    }
    if (typeof opts.threshold === "number" && opts.threshold >= 60 && opts.threshold <= 90) {
      this.threshold = opts.threshold;
      this.criticalThreshold = Math.min(88, this.threshold + 5);
    }
    this.saveConfig();
    return this.status();
  }

  status(): ThermalStatus {
    return {
      supported: this.supported,
      enabled: this.enabled,
      threshold: this.threshold,
      critical_threshold: this.criticalThreshold,
      current_temp: this.currentTemp,
      power_draw: this.powerDraw,
      utilization: this.utilization,
      state: this.state,
      throttled: this.throttled,
      cool_cycles: this.coolCycles,
    };
  }

  private resumeAll() {
    if (this.dutySwitchTimeout) {
      clearTimeout(this.dutySwitchTimeout);
      this.dutySwitchTimeout = null;
    }
    if (process.platform !== "win32") {
      for (const pid of this.pausedPids) {
        try {
          process.kill(pid, "SIGCONT");
        } catch {
          /* ignore */
        }
      }
    }
    this.pausedPids.clear();
    this.dutyState = "running";
  }

  private start() {
    this.poll();
    this.timer = setInterval(() => this.poll(), 1200);
    // do not hold node process open for test runners
    if (this.timer.unref) this.timer.unref();
  }

  private poll() {
    execFile("nvidia-smi", ["--query-gpu=temperature.gpu,power.draw,utilization.gpu", "--format=csv,noheader,nounits"], (err, stdout) => {
      if (err) {
        this.supported = false;
        this.state = "unknown";
        return;
      }
      this.supported = true;
      const parts = stdout.trim().split(",").map((s) => parseFloat(s.trim()));
      const temp = Number.isFinite(parts[0]) ? parts[0] : null;
      const power = Number.isFinite(parts[1]) ? parts[1] : null;
      const util = Number.isFinite(parts[2]) ? parts[2] : null;

      this.currentTemp = temp;
      this.powerDraw = power;
      this.utilization = util;

      if (temp === null) return;

      if (!this.enabled) {
        this.state = temp >= 80 ? "critical" : temp >= 75 ? "warm" : "optimal";
        this.throttled = false;
        this.resumeAll();
        return;
      }

      // Safe Mode is active
      if (temp >= this.criticalThreshold) {
        this.state = "critical";
        this.throttled = true;
        this.applyCriticalPause();
      } else if (temp >= this.threshold) {
        this.state = "throttling";
        this.throttled = true;
        this.applyDutyThrottling();
      } else if (temp <= this.threshold - 4) {
        this.state = temp >= 75 ? "warm" : "optimal";
        if (this.throttled) {
          this.throttled = false;
          this.resumeAll();
        }
      } else {
        if (!this.throttled) {
          this.state = temp >= 75 ? "warm" : "optimal";
        }
      }
    });
  }

  private logMessage(msg: string) {
    console.warn(msg);
    try {
      const termLog = join(repoRoot(), "out", "terminal.log");
      appendFileSync(termLog, `${msg}\n`);
    } catch {
      /* ignore */
    }
  }

  private applyCriticalPause() {
    if (process.platform === "win32") return;
    execFile("nvidia-smi", ["--query-compute-apps=pid", "--format=csv,noheader,nounits"], (err, stdout) => {
      if (err || !stdout.trim()) return;
      const pids = stdout.trim().split("\n").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
      for (const pid of pids) {
        if (!this.pausedPids.has(pid)) {
          try {
            process.kill(pid, "SIGSTOP");
            this.pausedPids.add(pid);
            this.coolCycles++;
            this.logMessage(`[SafeMode] GPU temp critical (${this.currentTemp}°C >= ${this.criticalThreshold}°C)! Paused PID ${pid} to prevent shutdown.`);
          } catch {
            /* ignore */
          }
        }
      }
    });
  }

  private applyDutyThrottling() {
    if (process.platform === "win32") return;
    execFile("nvidia-smi", ["--query-compute-apps=pid", "--format=csv,noheader,nounits"], (err, stdout) => {
      if (err || !stdout.trim()) return;
      const pids = stdout.trim().split("\n").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
      if (!pids.length) return;

      // Interleave pausing and running (1.5s stop, 1.5s cont) to lower average thermal dissipation
      if (this.dutyState === "running") {
        for (const pid of pids) {
          try {
            process.kill(pid, "SIGSTOP");
            this.pausedPids.add(pid);
          } catch {
            /* ignore */
          }
        }
        this.dutyState = "paused";
        this.coolCycles++;
        this.dutySwitchTimeout = setTimeout(() => {
          if (this.dutyState === "paused") {
            this.resumeAll();
          }
        }, 1500);
      }
    });
  }
}

export const thermalGuard = new ThermalGuard();

