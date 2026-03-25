import { HomeAssistantExt, EntityRegistryEntry } from "./type-extensions";
import { getValueFromObject } from "./utils";

export const BATTERY_NOTES_PLATFORM = "battery_notes";

/**
 * Lazy-resolving data accessor for entity data.
 * Single source of truth for filters, rendering, and debug output.
 *
 * Resolution paths:
 * - entity.*    → hass.entities[entityId]
 * - device.*    → hass.devices[deviceId]
 * - area.*      → hass.areas[areaId] (chain: entity → device → area)
 * - computed.*  → computed data store (state, charging, battery_notes)
 * - *           → hass.states[entityId] (fallback: attributes, state, etc.)
 */
export class EntityDataAccessor {

    private computed: IMap<any> = {};

    constructor(
        private hass: HomeAssistantExt,
        private entityId: string,
    ) {}

    /** HA state object for this entity */
    get state() { return this.hass.states[this.entityId]; }

    /** State attributes shortcut */
    get attributes() { return this.state?.attributes; }

    /** Entity registry entry */
    get entity(): EntityRegistryEntry | undefined { return this.hass.entities?.[this.entityId]; }

    /** Device registry entry (resolved via entity.device_id) */
    get device() {
        return this.entity?.device_id
            ? this.hass.devices?.[this.entity.device_id]
            : undefined;
    }

    /** Area registry entry (resolved via entity.area_id or device.area_id) */
    get area() {
        const id = this.entity?.area_id || this.device?.area_id;
        return id ? this.hass.areas?.[id] : undefined;
    }

    /** Store computed/derived data under the "computed" namespace */
    setComputed(key: string, value: any): void {
        this.computed[key] = value;
    }

    /** Resolve a dotted path to its value from the right source */
    resolve(path: string): any {
        if (path.startsWith("entity.")) {
            return getValueFromObject(this.entity, path.substring(7));
        }
        if (path.startsWith("device.")) {
            return getValueFromObject(this.device, path.substring(7));
        }
        if (path.startsWith("area.")) {
            return getValueFromObject(this.area, path.substring(5));
        }
        if (path.startsWith("computed.")) {
            return getValueFromObject(this.computed, path.substring(9));
        }
        // Fall back to hass state (attributes, last_changed, etc.)
        return getValueFromObject(this.state, path);
    }

    /** Serialize all data for debug output */
    toDebugJSON(): string {
        return JSON.stringify({
            ...this.state,
            entity: this.entity,
            device: this.device,
            area: this.area,
            computed: this.computed,
        }, null, 2);
    }
}

/**
 * Resolves sibling entities on the same device.
 */
export function resolveSiblings(hass: HomeAssistantExt, entityId: string, deviceId?: string): ISiblingEntity[] {
    if (!deviceId || !hass.entities) {
        return [];
    }

    return Object.values(hass.entities)
        .filter(e => e.device_id === deviceId && e.entity_id !== entityId)
        .map(e => {
            const state = hass.states[e.entity_id];
            return {
                entity_id: e.entity_id,
                device_class: state?.attributes?.device_class,
                state_class: state?.attributes?.state_class,
            };
        });
}

/**
 * Resolves battery_notes attributes from sibling entities on the same device.
 */
export function resolveBatteryNotesData(hass: HomeAssistantExt, siblings: ISiblingEntity[]): IMap<any> | undefined {
    if (!siblings || siblings.length === 0) {
        return undefined;
    }

    for (const sibling of siblings) {
        const entityEntry = hass.entities?.[sibling.entity_id];
        if (entityEntry?.platform !== BATTERY_NOTES_PLATFORM) {
            continue;
        }

        const state = hass.states[sibling.entity_id];
        if (!state ||
            state.attributes?.device_class !== "battery" ||
            state.attributes?.battery_quantity === undefined) {
            continue;
        }

        return state.attributes;
    }

    return undefined;
}
