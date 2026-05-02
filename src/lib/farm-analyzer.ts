/**
 * Pure functions that turn a `FarmState` into actionable events
 * (e.g. "Sunflower plot 3 ready", "Chicken hungry").
 *
 * Keeping these pure makes them trivial to unit-test and to call from both
 * the scheduler and API routes.
 */

import type { Animal, CropPlot, FarmState, NotificationRule } from "./types";

// Indonesian labels for nicer Telegram messages.
const ANIMAL_ID: Record<string, string> = {
  Chicken: "Ayam",
  Cow: "Sapi",
  Sheep: "Domba",
};

const RESOURCE_ID: Record<string, string> = {
  Tree: "Pohon",
  Stone: "Batu",
  Iron: "Besi",
  Gold: "Emas",
  Crimstone: "Crimstone",
  Sunstone: "Sunstone",
  Oil: "Minyak",
  FruitPatch: "petak buah",
};

export type FarmEventKind =
  | "harvest_ready"
  | "animal_ready"
  | "resource_ready"
  | "daily_reward"
  | "balance_threshold";

export interface FarmEvent {
  /** Stable key used for de-duplication of repeated notifications. */
  key: string;
  kind: FarmEventKind;
  message: string;
  /** When the underlying transition happened (ms). */
  at: number;
  /** Optional rule id that triggered this event (for custom rules). */
  ruleId?: number;
}

export function detectEvents(farm: FarmState, now: number = Date.now()): FarmEvent[] {
  const events: FarmEvent[] = [];

  // -- Crops ready to harvest --
  const readyByCrop = new Map<string, CropPlot[]>();
  for (const plot of farm.crops) {
    if (!plot.crop || !plot.readyAt) continue;
    if (plot.readyAt <= now) {
      const list = readyByCrop.get(plot.crop) ?? [];
      list.push(plot);
      readyByCrop.set(plot.crop, list);
    }
  }
  for (const [cropName, plots] of readyByCrop) {
    // One event per (crop, plantedAt batch) to avoid spamming each plot.
    const earliestReady = Math.min(...plots.map((p) => p.readyAt!));
    events.push({
      key: `crop:${cropName}:${earliestReady}`,
      kind: "harvest_ready",
      message: `� Master, ${plots.length}x ${cropName} siap dipanen!`,
      at: earliestReady,
    });
  }

  // -- Animals hungry / ready to feed --
  const readyAnimals = new Map<string, Animal[]>();
  for (const a of farm.animals) {
    if (!a.readyAt) continue;
    if (a.readyAt <= now) {
      const list = readyAnimals.get(a.type) ?? [];
      list.push(a);
      readyAnimals.set(a.type, list);
    }
  }
  for (const [type, list] of readyAnimals) {
    const earliest = Math.min(...list.map((a) => a.readyAt!));
    const localized = ANIMAL_ID[type] ?? type;
    events.push({
      key: `animal:${type}:${earliest}`,
      kind: "animal_ready",
      message: `🐔 Master, ${list.length}x ${localized} siap diberi makan!`,
      at: earliest,
    });
  }

  // -- Resource nodes recovered (trees, stones, iron, gold, etc.) --
  const readyByType = new Map<string, number>();
  for (const r of farm.resources) {
    if (!r.readyAt) continue;
    if (r.readyAt <= now) {
      readyByType.set(r.type, (readyByType.get(r.type) ?? 0) + 1);
    }
  }
  for (const [type, count] of readyByType) {
    const localized = RESOURCE_ID[type] ?? type;

    // Notif 1: pertama kali ready (fired sekali saja)
    const earliestReady = Math.min(
      ...farm.resources
        .filter((r) => r.type === type && r.readyAt && r.readyAt <= now)
        .map((r) => r.readyAt!)
    );
    events.push({
      key: `resource:${type}:${earliestReady}`,
      kind: "resource_ready",
      message: `⛏️ Master, ${count} ${localized} siap di-harvest!`,
      at: earliestReady,
    });

    // Notif 2: reminder setiap 5 jam kalau belum di-harvest
    const bucket = Math.floor(now / (5 * 60 * 60_000));
    events.push({
      key: `resource:${type}:reminder:${bucket}`,
      kind: "resource_ready",
      message: `⏰ Permisi Master, Reminder, ${count} ${localized} masih belum di-harvest!`,
      at: now,
    });
  }

  // -- Daily reward chest --
  if (farm.dailyReward && !farm.dailyReward.collectedToday) {
    const date = new Date(now).toISOString().slice(0, 10);
    events.push({
      key: `daily_reward:${date}`,
      kind: "daily_reward",
      message: `🎁 Master, hadiah harian sudah tersedia! (🔥 streak ${farm.dailyReward.streaks} hari)`,
      at: now,
    });
  }

  return events;
}

/**
 * Evaluates user-defined custom rules against current farm state.
 * Currently supports `balance_threshold` (notify when balances[target] >= threshold).
 */
export function evaluateCustomRules(
  farm: FarmState,
  rules: NotificationRule[],
  now: number = Date.now(),
): FarmEvent[] {
  const events: FarmEvent[] = [];
  for (const rule of rules) {
    if (rule.enabled !== 1) continue;
    if (rule.kind !== "balance_threshold") continue;
    if (!rule.target || rule.threshold === undefined) continue;

    const have = farm.balances[rule.target] ?? 0;
    if (have < rule.threshold) continue;

    // Re-fire at most once per 24h per rule.
    const dayBucket = Math.floor(now / (24 * 60 * 60_000));
    events.push({
      key: `rule:${rule.id}:${dayBucket}`,
      kind: "balance_threshold",
      message: `📊 Master, ${rule.target} kamu sekarang ${have} (target: ≥ ${rule.threshold})`,
      at: now,
      ruleId: rule.id,
    });
  }
  return events;
}

/** Returns the next time something interesting will happen, or null. */
export function nextEventAt(farm: FarmState, now: number = Date.now()): number | null {
  const future: number[] = [];
  for (const p of farm.crops) {
    if (p.readyAt && p.readyAt > now) future.push(p.readyAt);
  }
  for (const a of farm.animals) {
    if (a.readyAt && a.readyAt > now) future.push(a.readyAt);
  }
  for (const r of farm.resources) {
    if (r.readyAt && r.readyAt > now) future.push(r.readyAt);
  }
  if (farm.dailyReward && !farm.dailyReward.collectedToday) future.push(now);
  if (farm.dailyReward?.collectedToday) future.push(farm.dailyReward.nextAvailableAt);
  if (future.length === 0) return null;
  return Math.min(...future);
}
