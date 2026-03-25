import { expect } from '@esm-bundle/chai';
import { BatteryStateCard } from "../../../src/custom-elements/battery-state-card";
import { CardElements, HomeAssistantMock } from "../../helpers";

it("Include filter via entity_id", async () => {

    const hass = new HomeAssistantMock<BatteryStateCard>();
    hass.addEntity("Bedroom motion battery level", "90");
    hass.addEntity("Temp sensor battery level", "50");

    const cardElem = hass.addCard("battery-state-card", {
        title: "Header",
        filter: {
            include: [
                {
                    name: "entity_id",
                    value: "*_battery_level"
                }
            ],
            exclude: []
        },
        entities: []
    });

    // waiting for card to be updated/rendered
    await cardElem.cardUpdated;

    const card = new CardElements(cardElem);

    expect(card.itemsCount).to.equal(2);
});

it("Include via entity_id and exclude via state - empty result", async () => {

    const hass = new HomeAssistantMock<BatteryStateCard>();
    hass.addEntity("Bedroom motion battery level", "90");
    hass.addEntity("Temp sensor battery level", "50");

    const cardElem = hass.addCard("battery-state-card", {
        title: "Header",
        filter: {
            include: [
                {
                    name: "entity_id",
                    value: "*_battery_level"
                }
            ],
            exclude: [
                {
                    name: "state",
                    value: 40,
                    operator: ">"
                }
            ]
        },
        entities: []
    });

    // waiting for card to be updated/rendered
    await cardElem.cardUpdated;

    const card = new CardElements(cardElem);

    expect(card.itemsCount).to.equal(0);
    // we expect to not have any content
    expect(cardElem.shadowRoot!.childElementCount).to.equal(0);
});


const hiddenStateTests = [
    [false, undefined, 1],
    [true, undefined, 0],
    [false, true, 1],
    [true, true, 0],
    [false, false, 1],
    [true, false, 1],
];

hiddenStateTests.forEach(([isHidden, respectVisibilitySetting, numOfRenderedEntities]) => {
    it(`Entity filtered based on hidden state - hidden:${isHidden}, respect:${respectVisibilitySetting}`, async () => {
        const hass = new HomeAssistantMock<BatteryStateCard>();
        const entity = hass.addEntity("Bedroom motion battery level", "90");
        entity.setProperty("entity", { entity_id: "", hidden: isHidden as boolean });

        const cardElem = hass.addCard("battery-state-card", <any>{
            title: "Header",
            filter: {
                include: [
                    {
                        name: "entity_id",
                        value: "*_battery_level"
                    }
                ],
                exclude: [],
            },
            entities: [],
            respect_visibility_setting: respectVisibilitySetting,
        });

        // waiting for card to be updated/rendered
        await cardElem.cardUpdated;

        const card = new CardElements(cardElem);

        expect(card.itemsCount).to.equal(numOfRenderedEntities);
    });
});

it("'filters' works as alias for 'filter' at card level", async () => {

    const hass = new HomeAssistantMock<BatteryStateCard>();
    hass.addEntity("Bedroom motion battery level", "90");
    hass.addEntity("Temp sensor battery level", "50");

    const cardElem = hass.addCard("battery-state-card", <any>{
        title: "Header",
        filters: {
            include: [
                {
                    name: "entity_id",
                    value: "*_battery_level"
                }
            ],
        },
        entities: []
    });

    await cardElem.cardUpdated;

    const card = new CardElements(cardElem);

    expect(card.itemsCount).to.equal(2);
});

it("Original battery entity uses state from battery_notes sibling", async () => {
    const hass = new HomeAssistantMock<BatteryStateCard>();
    // Original entity has stale state "50", battery_notes entity has updated state "80"
    const batteryEntity = hass.addEntity("BN original battery", "50", { device_class: "battery" }, "sensor");
    const batteryNotesEntity = hass.addEntity("BN battery notes entity", "80", { device_class: "battery", state_class: "measurement", battery_quantity: 1 }, "sensor");

    hass.hass.entities = <any>{
        [batteryEntity.entity_id]: { entity_id: batteryEntity.entity_id, device_id: "device_bn1" },
        [batteryNotesEntity.entity_id]: { entity_id: batteryNotesEntity.entity_id, device_id: "device_bn1", platform: "battery_notes" },
    };

    const cardElem = hass.addCard("battery-state-card", <any>{
        entities: [{ entity: batteryEntity.entity_id }],
        filter: {},
    });

    await cardElem.cardUpdated;

    const card = new CardElements(cardElem);
    expect(card.itemsCount).to.equal(1);
    // State should come from the battery_notes sibling
    expect(card.item(0).stateText).to.equal("80 %");
});

it("Hidden entity without battery_notes sibling stays hidden", async () => {
    const hass = new HomeAssistantMock<BatteryStateCard>();
    const batteryEntity = hass.addEntity("BN hidden no sibling battery", "80", { device_class: "battery" }, "sensor");

    // Entity is hidden but no battery_notes sibling exists
    hass.hass.entities = <any>{
        [batteryEntity.entity_id]: { entity_id: batteryEntity.entity_id, device_id: "device_bn2", hidden: true },
    };

    const cardElem = hass.addCard("battery-state-card", <any>{
        entities: [{ entity: batteryEntity.entity_id }],
    });

    await cardElem.cardUpdated;

    const card = new CardElements(cardElem);
    expect(card.itemsCount).to.equal(0);
});

it("State substitution does not happen when battery_notes_enabled is false", async () => {
    const hass = new HomeAssistantMock<BatteryStateCard>();
    const batteryEntity = hass.addEntity("BN disabled original", "50", { device_class: "battery" }, "sensor");
    const batteryNotesEntity = hass.addEntity("BN disabled battery notes", "80", { device_class: "battery", state_class: "measurement", battery_quantity: 1 }, "sensor");

    hass.hass.entities = <any>{
        [batteryEntity.entity_id]: { entity_id: batteryEntity.entity_id, device_id: "device_bn4" },
        [batteryNotesEntity.entity_id]: { entity_id: batteryNotesEntity.entity_id, device_id: "device_bn4", platform: "battery_notes" },
    };

    const cardElem = hass.addCard("battery-state-card", <any>{
        entities: [{ entity: batteryEntity.entity_id }],
        battery_notes_enabled: false,
        filter: {},
    });

    await cardElem.cardUpdated;

    const card = new CardElements(cardElem);
    expect(card.itemsCount).to.equal(1);
    // Original state should be kept when battery_notes_enabled is false
    expect(card.item(0).stateText).to.equal("50 %");
});

it("State substitution does not happen when battery_notes sibling lacks state_class measurement", async () => {
    const hass = new HomeAssistantMock<BatteryStateCard>();
    const batteryEntity = hass.addEntity("BN no state class original", "50", { device_class: "battery" }, "sensor");
    // battery_notes entity without state_class: "measurement"
    const batteryNotesEntity = hass.addEntity("BN no state class notes", "80", { device_class: "battery", battery_quantity: 1 }, "sensor");

    hass.hass.entities = <any>{
        [batteryEntity.entity_id]: { entity_id: batteryEntity.entity_id, device_id: "device_bn5" },
        [batteryNotesEntity.entity_id]: { entity_id: batteryNotesEntity.entity_id, device_id: "device_bn5", platform: "battery_notes" },
    };

    const cardElem = hass.addCard("battery-state-card", <any>{
        entities: [{ entity: batteryEntity.entity_id }],
        filter: {},
    });

    await cardElem.cardUpdated;

    const card = new CardElements(cardElem);
    expect(card.itemsCount).to.equal(1);
    // State should remain from original entity
    expect(card.item(0).stateText).to.equal("50 %");
});

it("Non-battery entity state is not substituted even when battery_notes sibling exists", async () => {
    const hass = new HomeAssistantMock<BatteryStateCard>();
    // Original entity is not device_class "battery"
    const voltageEntity = hass.addEntity("BN voltage sensor", "3.2", { device_class: "voltage" }, "sensor");
    const batteryNotesEntity = hass.addEntity("BN voltage device notes", "80", { device_class: "battery", state_class: "measurement", battery_quantity: 1 }, "sensor");

    hass.hass.entities = <any>{
        [voltageEntity.entity_id]: { entity_id: voltageEntity.entity_id, device_id: "device_bn6" },
        [batteryNotesEntity.entity_id]: { entity_id: batteryNotesEntity.entity_id, device_id: "device_bn6", platform: "battery_notes" },
    };

    const cardElem = hass.addCard("battery-state-card", <any>{
        entities: [{ entity: voltageEntity.entity_id }],
        filter: {},
    });

    await cardElem.cardUpdated;

    const card = new CardElements(cardElem);
    expect(card.itemsCount).to.equal(1);
    // Voltage entity should keep its own state
    expect(card.item(0).stateText).to.equal("3.2 %");
});