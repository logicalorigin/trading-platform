import {
  CapsuleError,
  type CapsuleRecord,
  type CapsuleRelayTarget,
  type CapsuleTarget,
  type CapsuleTargetKind,
} from "./capsule";

export type CapsuleSlotController = {
  ensure: (sessionId: string) => Promise<CapsuleRecord>;
  getRelayTarget: (kind: CapsuleTargetKind) => CapsuleRelayTarget | null;
  getTarget: (sessionId: string, kind: CapsuleTargetKind) => CapsuleTarget;
  release: (sessionId: string) => Promise<void>;
  snapshot: () => { capacity: { active: number } };
  status: (sessionId: string) => Promise<CapsuleRecord | null>;
};

export class CapsuleFleetManager {
  private readonly slots: CapsuleSlotController[];
  private readonly sessionSlots = new Map<string, number>();
  private readonly slotSessions = new Map<number, string>();

  constructor(
    readonly capacity: number,
    createSlot: (slotNumber: number) => CapsuleSlotController,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 20) {
      throw new CapsuleError(
        "invalid_host_capacity",
        "IBKR session host capacity must be an integer from 1 to 20.",
      );
    }
    this.slots = Array.from({ length: capacity }, (_, index) =>
      createSlot(index + 1),
    );
  }

  private slot(slotNumber: number): CapsuleSlotController {
    if (
      !Number.isInteger(slotNumber) ||
      slotNumber < 1 ||
      slotNumber > this.capacity
    ) {
      throw new CapsuleError(
        "invalid_slot_number",
        "IBKR capsule slot is outside this host's measured capacity.",
      );
    }
    return this.slots[slotNumber - 1]!;
  }

  async ensure(
    sessionId: string,
    slotNumber: number,
  ): Promise<CapsuleRecord> {
    const slot = this.slot(slotNumber);
    const existingSlot = this.sessionSlots.get(sessionId);
    const existingSession = this.slotSessions.get(slotNumber);
    if (
      (existingSlot !== undefined && existingSlot !== slotNumber) ||
      (existingSession !== undefined && existingSession !== sessionId)
    ) {
      throw new CapsuleError(
        "session_placement_conflict",
        "IBKR session placement conflicts with the current host slot.",
      );
    }
    this.sessionSlots.set(sessionId, slotNumber);
    this.slotSessions.set(slotNumber, sessionId);
    try {
      for (let index = 0; index < this.slots.length; index += 1) {
        if (index + 1 === slotNumber) continue;
        if (await this.slots[index]!.status(sessionId)) {
          throw new CapsuleError(
            "session_placement_conflict",
            "IBKR session is already present in another host slot.",
          );
        }
      }
      return await slot.ensure(sessionId);
    } catch (error) {
      if (this.sessionSlots.get(sessionId) === slotNumber) {
        this.sessionSlots.delete(sessionId);
      }
      if (this.slotSessions.get(slotNumber) === sessionId) {
        this.slotSessions.delete(slotNumber);
      }
      throw error;
    }
  }

  async status(
    sessionId: string,
    slotNumber: number,
  ): Promise<CapsuleRecord | null> {
    const existingSlot = this.sessionSlots.get(sessionId);
    if (existingSlot !== undefined && existingSlot !== slotNumber) return null;
    const slot = this.slot(slotNumber);
    const record = await slot.status(sessionId);
    if (record) {
      const existingSession = this.slotSessions.get(slotNumber);
      if (existingSession !== undefined && existingSession !== sessionId) {
        throw new CapsuleError(
          "session_placement_conflict",
          "IBKR session placement conflicts with the current host slot.",
        );
      }
      this.sessionSlots.set(sessionId, slotNumber);
      this.slotSessions.set(slotNumber, sessionId);
    }
    return record;
  }

  async release(sessionId: string, slotNumber: number): Promise<void> {
    await this.slot(slotNumber).release(sessionId);
    if (this.sessionSlots.get(sessionId) === slotNumber) {
      this.sessionSlots.delete(sessionId);
    }
    if (this.slotSessions.get(slotNumber) === sessionId) {
      this.slotSessions.delete(slotNumber);
    }
  }

  getTarget(
    sessionId: string,
    slotNumber: number,
    kind: CapsuleTargetKind,
  ): CapsuleTarget {
    return this.slot(slotNumber).getTarget(sessionId, kind);
  }

  getRelayTarget(
    slotNumber: number,
    kind: CapsuleTargetKind,
  ): CapsuleRelayTarget | null {
    return this.slot(slotNumber).getRelayTarget(kind);
  }

  snapshot(): {
    mode: "paper";
    capacity: { max: number; active: number };
  } {
    return {
      mode: "paper",
      capacity: {
        max: this.capacity,
        active: this.slots.reduce(
          (total, slot) => total + slot.snapshot().capacity.active,
          0,
        ),
      },
    };
  }
}
