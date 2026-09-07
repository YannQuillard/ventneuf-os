import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const defaultReleasesUrl = "https://api.github.com/repos/YannQuillard/ventneuf-os/releases?per_page=20";
const archiveName = "ventneuf-runner-darwin.tar.gz";
const checksumName = `${archiveName}.sha256`;
const maxArtifactBytes = 10 * 1024 * 1024;

interface ReleaseAsset { name: string; browser_download_url: string }
interface ReleaseResponse { tag_name?: unknown; assets?: unknown; published_at?: unknown }

function isRunnerRelease(value: unknown): value is ReleaseResponse & { tag_name: string } {
  return Boolean(value && typeof value === "object" && typeof (value as ReleaseResponse).tag_name === "string"
    && ((value as ReleaseResponse).tag_name as string).startsWith("runner-"));
}

export interface RunnerUpdateStatus {
  currentVersion: string;
  latestVersion: string;
  available: boolean;
}

function releaseVersion(value: unknown) {
  if (typeof value !== "string" || !/^runner-[0-9a-f]{40}$/.test(value)) throw new Error("The runner release tag is invalid.");
  return value.slice("runner-".length);
}

async function download(url: string, limit = maxArtifactBytes) {
  const response = await fetch(url, { headers: { accept: "application/vnd.github+json", "user-agent": "ventneuf-runner" } });
  if (!response.ok) throw new Error(`Runner release download failed (${response.status}).`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) throw new Error("The runner release is too large.");
  const value = Buffer.from(await response.arrayBuffer());
  if (value.length > limit) throw new Error("The runner release is too large.");
  return value;
}

async function latestRelease(releasesUrl: string) {
  const response = JSON.parse((await download(releasesUrl, 1_000_000)).toString("utf8")) as unknown;
  const payload = (Array.isArray(response)
    ? response.filter(isRunnerRelease).reduce<ReleaseResponse | undefined>((latest, candidate) => {
      if (!latest) return candidate;
      const latestPublishedAt = typeof latest.published_at === "string" ? Date.parse(latest.published_at) : Number.NaN;
      const candidatePublishedAt = typeof candidate.published_at === "string" ? Date.parse(candidate.published_at) : Number.NaN;
      return Number.isFinite(candidatePublishedAt) && (!Number.isFinite(latestPublishedAt) || candidatePublishedAt > latestPublishedAt)
        ? candidate
        : latest;
    }, undefined)
    : response) as ReleaseResponse | undefined;
  if (!payload) throw new Error("No runner release is available.");
  const version = releaseVersion(payload.tag_name);
  if (!Array.isArray(payload.assets)) throw new Error("The runner release has no assets.");
  const assets = payload.assets.filter((entry): entry is ReleaseAsset => Boolean(entry && typeof entry === "object"
    && typeof (entry as ReleaseAsset).name === "string" && typeof (entry as ReleaseAsset).browser_download_url === "string"));
  const archive = assets.find(({ name }) => name === archiveName);
  const checksum = assets.find(({ name }) => name === checksumName);
  if (!archive || !checksum) throw new Error("The runner release is incomplete.");
  if (releasesUrl === defaultReleasesUrl) {
    for (const url of [archive.browser_download_url, checksum.browser_download_url]) {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.hostname !== "github.com"
        || !parsed.pathname.startsWith(`/YannQuillard/ventneuf-os/releases/download/runner-${version}/`)) {
        throw new Error("The runner release asset URL is invalid.");
      }
    }
  }
  return { version, archiveUrl: archive.browser_download_url, checksumUrl: checksum.browser_download_url };
}

export async function readRunnerVersion(directory: string) {
  try {
    const payload = JSON.parse(await readFile(join(directory, "release.json"), "utf8")) as { version?: unknown };
    return typeof payload.version === "string" && /^[0-9a-f]{40}$/.test(payload.version) ? payload.version : "unknown";
  } catch { return "unknown"; }
}

export class RunnerUpdater {
  private cached?: { release: Awaited<ReturnType<typeof latestRelease>>; expiresAt: number };
  private installing = false;

  constructor(private readonly installationDirectory: string, private readonly options: {
    releasesUrl?: string;
    restart?: () => void;
  } = {}) {}

  private async release() {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.release;
    const release = await latestRelease(this.options.releasesUrl ?? defaultReleasesUrl);
    this.cached = { release, expiresAt: Date.now() + 15 * 60_000 };
    return release;
  }

  async status(): Promise<RunnerUpdateStatus> {
    const [currentVersion, release] = await Promise.all([readRunnerVersion(this.installationDirectory), this.release()]);
    return { currentVersion, latestVersion: release.version, available: currentVersion !== release.version };
  }

  async install() {
    if (this.installing) throw new Error("A runner update is already in progress.");
    this.installing = true;
    try { return await this.installRelease(); }
    finally { this.installing = false; }
  }

  private async installRelease() {
    const release = await this.release();
    if ((await readRunnerVersion(this.installationDirectory)) === release.version) return release.version;
    const [archive, checksumFile] = await Promise.all([download(release.archiveUrl), download(release.checksumUrl, 1_024)]);
    const expectedChecksum = checksumFile.toString("utf8").trim().split(/\s+/)[0];
    const actualChecksum = createHash("sha256").update(archive).digest("hex");
    if (!expectedChecksum || !/^[0-9a-f]{64}$/.test(expectedChecksum) || actualChecksum !== expectedChecksum) {
      throw new Error("The runner release checksum is invalid.");
    }
    const staging = await mkdtemp(join(dirname(this.installationDirectory), ".runner-update-"));
    const archivePath = `${staging}.tar.gz`;
    try {
      await writeFile(archivePath, archive, { mode: 0o600, flag: "wx" });
      const listing = (await execute("/usr/bin/tar", ["-tzf", archivePath])).stdout.trim().split("\n").filter(Boolean);
      if (!listing.length || listing.some((entry) => entry !== "./" && !/^(?:\.\/)?[a-zA-Z0-9._-]+$/.test(entry))) {
        throw new Error("The runner release contains an unsafe path.");
      }
      await execute("/usr/bin/tar", ["-xzf", archivePath, "-C", staging]);
      const stagedVersion = await readRunnerVersion(staging);
      if (stagedVersion !== release.version || !listing.some((entry) => basename(entry) === "index.js")) {
        throw new Error("The runner release contents are invalid.");
      }
      for (const log of ["runner.log", "runner.error.log"]) {
        await copyFile(join(this.installationDirectory, log), join(staging, log)).catch(() => undefined);
      }
      const backup = `${this.installationDirectory}.previous`;
      await rm(backup, { recursive: true, force: true });
      await rename(this.installationDirectory, backup);
      try { await rename(staging, this.installationDirectory); }
      catch (error) { await rename(backup, this.installationDirectory); throw error; }
      if (this.options.restart) this.options.restart();
      else setTimeout(() => process.exit(0), 250).unref();
      return release.version;
    } finally {
      await rm(archivePath, { force: true });
      await rm(staging, { recursive: true, force: true });
    }
  }

  async confirmHealthy() {
    await rm(`${this.installationDirectory}.previous`, { recursive: true, force: true }).catch(() => undefined);
  }
}
