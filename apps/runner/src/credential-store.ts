import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const service = "ventneuf.os runner credential";

export interface StoredDevice {
  deviceId: string;
  name: string;
  platform: "darwin" | "linux" | "win32";
  credential: string;
}

export interface CredentialStore {
  load(): Promise<StoredDevice | undefined>;
  save(device: StoredDevice): Promise<void>;
}

export class MacOSKeychainCredentialStore implements CredentialStore {
  constructor(private readonly account: string) {}

  async load(): Promise<StoredDevice | undefined> {
    try {
      const { stdout } = await execute("/usr/bin/security", [
        "find-generic-password",
        "-a",
        this.account,
        "-s",
        service,
        "-w",
      ]);
      return JSON.parse(stdout.trim()) as StoredDevice;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === 44) return undefined;
      throw error;
    }
  }

  async save(device: StoredDevice): Promise<void> {
    await execute("/usr/bin/security", [
      "add-generic-password",
      "-U",
      "-a",
      this.account,
      "-s",
      service,
      "-w",
      JSON.stringify(device),
    ]);
  }
}
