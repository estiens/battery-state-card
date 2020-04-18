import { HomeAssistant } from "./ha-types";
import { IBatteryStateCardConfig, IBatteryEntity } from "./types";
import { LitElement } from "./lit-element";
import * as views from "./views";
import styles from "./styles";
import BatteryViewModel from "./battery-vm";

console.info(
    '%c BATTERY-STATE-CARD %c 0.1.0 ',
    'color: white; background: forestgreen; font-weight: 700;',
    'color: forestgreen; background: white; font-weight: 700;',
);

/**
 * Card main class.
 */
class BatteryStateCard extends LitElement {

    /**
     * Card configuration.
     */
    public config: IBatteryStateCardConfig = <any>{};

    /**
     * Whether we should render it as an entity - not a card.
     */
    public simpleView: boolean = false;

    /**
     * Battery objects to track.
     */
    public batteries: BatteryViewModel[] = [];

    /**
     * Properties defined here are used by Polymer to detect
     * changes and update card UI.
     */
    static get properties() {
        return {
            batteries: Array,
            config: Object
        };
    }

    /**
     * CSS for the card
     */
    static get styles() {
        return styles;
    }

    /**
     * Called by HA on init or when configuration is updated.
     *
     * @param config Card configuration
     */
    setConfig(config: IBatteryStateCardConfig) {
        if (!config.entities && !config.entity) {
            throw new Error("You need to define entities");
        }

        this.config = config;
        this.simpleView = !!config.entity;

        let entities = config.entity
            ? [config]
            : config.entities!.map((entity: string | IBatteryEntity) => {
                // check if it is just the id string
                if (typeof (entity) === "string") {
                    entity = <IBatteryEntity>{ entity: entity };
                }

                return entity;
            });

        this.batteries = entities.map(entity => new BatteryViewModel(entity, this.config));
    }

    /**
     * Called when HA state changes (very often).
     */
    set hass(hass: HomeAssistant) {
        let updated = false;
        this.batteries.forEach((battery, index) => {

            this.updateBattery(battery, hass);
            updated = updated || battery.updated;
        });

        if (updated) {
            // trigger the update
            this.batteries = [...this.batteries];
        }
    }

    /**
     * Renders the card. Called when update detected.
     */
    render() {
        // check if we should render it without card container
        if (this.simpleView) {
            return views.battery(this.batteries[0]);
        }

        return views.card(
            this.config.name || "Battery levels",
            this.batteries.map(battery => views.battery(battery))
        );
    }

    /**
     * Gets the height of your card. Home Assistant uses this to automatically
     * distribute all cards over the available columns.
     */
    getCardSize() {
        return this.batteries.length + 1;
    }

    /**
     * Updates view properties of the given battery view model.
     * @param battery Battery view data
     * @param hass Home assistant object with states
     */
    private updateBattery(battery: BatteryViewModel, hass: HomeAssistant) {
        const entityData = hass.states[battery.entity.entity];
        if (!entityData) {
            console.error("[battery-state-card] Entity not found: " + battery.entity.entity);
            return null;
        }

        battery.name = battery.entity.name || entityData.attributes.friendly_name

        let level = 0;
        if (battery.entity.attribute) {
            level = entityData.attributes[battery.entity.attribute]
        }
        else {
            const candidates: number[] = [
                entityData.attributes.battery_level,
                entityData.attributes.battery,
                entityData.state,
                0
            ];

            level = candidates.find(n => n !== null && !isNaN(n)) || 0;
        }

        if (battery.entity.multiplier) {
            level *= battery.entity.multiplier;
        }

        battery.level = level;
    }
}

// Registering card
customElements.define("battery-state-card", <any>BatteryStateCard);