import {
  CapsuleError,
  type CapsuleLeaseGrant,
  type CapsuleRecord,
  type CapsuleRelayTarget,
  type CapsuleTarget,
  type CapsuleTargetKind,
} from "./capsule";

export type CapsuleSlotController = {
  ensure: (
    sessionId: string,
    generation: number,
    leaseGrant?: CapsuleLeaseGrant,
  ) => Promise<CapsuleRecord>;
  getRelayTarget: (kind: CapsuleTargetKind) => CapsuleRelayTarget | null;
  getTarget: (
    sessionId: string,
    kind: CapsuleTargetKind,
    generation: number,
  ) => CapsuleTarget;
  identityForSession: (
    sessionId: string,
  ) => Promise<{ generation: number } | null>;
  keepalive: (
    sessionId: string,
    generation: number,
    leaseGrant: CapsuleLeaseGrant,
  ) => Promise<void>;
  reconcile: () => Promise<CapsuleRecord | null>;
  release: (sessionId: string, generation: number) => Promise<void>;
  replace: (
    sessionId: string,
    generation: number,
    leaseGrant?: CapsuleLeaseGrant,
  ) => Promise<CapsuleRecord>;
  snapshot: () => { capacity: { active: number } };
  status: (
    sessionId: string,
    generation: number,
  ) => Promise<CapsuleRecord | null>;
};

type SessionPlacement = {
  generation: number;
  sessionId: string;
  slotNumber: number;
};

function validateGeneration(generation: number): number {
  if (
    !Number.isSafeInteger(generation) ||
    generation < 0 ||
    generation > 2_147_483_647
  ) {
    throw new CapsuleError(
      "invalid_generation",
      "IBKR session generation must be an integer from 0 to 2147483647.",
    );
  }
  return generation;
}

function staleGeneration(): CapsuleError {
  return new CapsuleError(
    "stale_generation",
    "The IBKR session generation is stale.",
  );
}

export class CapsuleFleetManager {
  private readonly slots: CapsuleSlotController[];
  private readonly sessionSlots = new Map<string, SessionPlacement>();
  private readonly slotSessions = new Map<number, SessionPlacement>();

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
    generation: number,
    slotNumber: number,
    leaseGrant?: CapsuleLeaseGrant,
  ): Promise<CapsuleRecord> {
    validateGeneration(generation);
    const slot = this.slot(slotNumber);
    const existingPlacement = this.sessionSlots.get(sessionId);
    const existingOccupant = this.slotSessions.get(slotNumber);
    if (existingPlacement && existingPlacement.generation > generation) {
      throw staleGeneration();
    }
    if (
      (existingPlacement && existingPlacement.slotNumber !== slotNumber) ||
      (existingOccupant && existingOccupant.sessionId !== sessionId)
    ) {
      throw new CapsuleError(
        "session_placement_conflict",
        "IBKR session placement conflicts with the current host slot.",
      );
    }
    const placement = { generation, sessionId, slotNumber };
    this.sessionSlots.set(sessionId, placement);
    this.slotSessions.set(slotNumber, placement);
    try {
      let replace =
        existingPlacement?.slotNumber === slotNumber &&
        existingPlacement.generation < generation;
      for (let index = 0; index < this.slots.length; index += 1) {
        const identity = await this.slots[index]!.identityForSession(sessionId);
        if (!identity) continue;
        if (identity.generation > generation) throw staleGeneration();
        if (index + 1 !== slotNumber) {
          throw new CapsuleError(
            "session_placement_conflict",
            "IBKR session is already present in another host slot.",
          );
        }
        if (identity.generation < generation) replace = true;
      }
      return await (replace
        ? slot.replace(sessionId, generation, leaseGrant)
        : slot.ensure(sessionId, generation, leaseGrant));
    } catch (error) {
      if (existingPlacement && this.sessionSlots.get(sessionId) === placement) {
        this.sessionSlots.set(sessionId, existingPlacement);
      } else if (this.sessionSlots.get(sessionId) === placement) {
        this.sessionSlots.delete(sessionId);
      }
      if (existingOccupant && this.slotSessions.get(slotNumber) === placement) {
        this.slotSessions.set(slotNumber, existingOccupant);
      } else if (this.slotSessions.get(slotNumber) === placement) {
        this.slotSessions.delete(slotNumber);
      }
      throw error;
    }
  }

  async reconcile(): Promise<void> {
    await Promise.all(this.slots.map((slot) => slot.reconcile()));
  }

  async keepalive(
    sessionId: string,
    generation: number,
    slotNumber: number,
    leaseGrant: CapsuleLeaseGrant,
  ): Promise<void> {
    validateGeneration(generation);
    const existingPlacement = this.sessionSlots.get(sessionId);
    if (
      existingPlacement &&
      (existingPlacement.generation !== generation ||
        existingPlacement.slotNumber !== slotNumber)
    ) {
      if (existingPlacement.generation > generation) throw staleGeneration();
      throw new CapsuleError(
        "session_placement_conflict",
        "IBKR session placement conflicts with the current host slot.",
      );
    }
    const existingOccupant = this.slotSessions.get(slotNumber);
    if (existingOccupant && existingOccupant.sessionId !== sessionId) {
      throw new CapsuleError(
        "session_placement_conflict",
        "IBKR session placement conflicts with the current host slot.",
      );
    }
    await this.slot(slotNumber).keepalive(sessionId, generation, leaseGrant);
    const placement = { generation, sessionId, slotNumber };
    this.sessionSlots.set(sessionId, placement);
    this.slotSessions.set(slotNumber, placement);
  }

  async status(
    sessionId: string,
    generation: number,
    slotNumber: number,
  ): Promise<CapsuleRecord | null> {
    validateGeneration(generation);
    const existingPlacement = this.sessionSlots.get(sessionId);
    if (
      existingPlacement &&
      (existingPlacement.slotNumber !== slotNumber ||
        existingPlacement.generation !== generation)
    ) {
      return null;
    }
    const slot = this.slot(slotNumber);
    const record = await slot.status(sessionId, generation);
    if (record) {
      const existingOccupant = this.slotSessions.get(slotNumber);
      if (existingOccupant && existingOccupant.sessionId !== sessionId) {
        throw new CapsuleError(
          "session_placement_conflict",
          "IBKR session placement conflicts with the current host slot.",
        );
      }
      const placement = { generation, sessionId, slotNumber };
      this.sessionSlots.set(sessionId, placement);
      this.slotSessions.set(slotNumber, placement);
    }
    return record;
  }

  async release(
    sessionId: string,
    generation: number,
    slotNumber: number,
  ): Promise<void> {
    validateGeneration(generation);
    const placement = this.sessionSlots.get(sessionId);
    if (
      placement?.generation !== undefined &&
      placement.generation > generation
    ) {
      throw staleGeneration();
    }
    await this.slot(slotNumber).release(sessionId, generation);
    if (
      this.sessionSlots.get(sessionId)?.generation === generation &&
      this.sessionSlots.get(sessionId)?.slotNumber === slotNumber
    ) {
      this.sessionSlots.delete(sessionId);
    }
    const occupant = this.slotSessions.get(slotNumber);
    if (
      occupant?.sessionId === sessionId &&
      occupant.generation === generation
    ) {
      this.slotSessions.delete(slotNumber);
    }
  }

  getTarget(
    sessionId: string,
    generation: number,
    slotNumber: number,
    kind: CapsuleTargetKind,
  ): CapsuleTarget {
    validateGeneration(generation);
    const placement = this.sessionSlots.get(sessionId);
    if (
      placement?.generation !== undefined &&
      placement.generation > generation
    ) {
      throw staleGeneration();
    }
    return this.slot(slotNumber).getTarget(sessionId, kind, generation);
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
