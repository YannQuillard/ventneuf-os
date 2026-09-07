import type { devices } from "./schema.js";

export type DeviceRepository = (typeof devices.$inferSelect)["repositories"][number];

export function repositoriesMatch(left: DeviceRepository, right: DeviceRepository) {
  if (left.github && right.github) {
    return left.github.owner === right.github.owner && left.github.name === right.github.name;
  }
  return left.id === right.id;
}
