import { log, toNumber } from "./utils";
import { IBatteryCollection, IBatteryCollectionItem } from "./battery-provider";
import { createFilter, Filter } from "./filter";
import { RichStringProcessor } from "./rich-string-processor";
import { applyKStringProcessors } from "./rich-string-processor";

export interface IBatteryGroup {
    title?: string;
    secondaryInfo?: string;
    icon?: string;
    iconColor?: string;
    batteryIds: string[];
}

export interface IBatteryGroupResult {
    list: string[];
    groups: IBatteryGroup[];
}

/**
 * Returns battery collections to render
 */
export const getBatteryGroups = (batteries: IBatteryCollection, sortedIds: string[], config: number | IGroupConfig[] | undefined, haGroupData: IGroupDataMap): IBatteryGroupResult => {
    const result: IBatteryGroupResult = {
        list: [],
        groups: []
    };

    if (!config) {
        result.list = sortedIds;
        return result;
    }

    if (typeof config == "number") {
        result.list = sortedIds.slice(0, config);
        const remainingBatteries = sortedIds.slice(config);
        if (remainingBatteries.length > 0) {
            result.groups.push(createGroup(haGroupData, remainingBatteries));
        }
    }
    else {// make sure that max property is set for every group
        // Expand group-by entries into explicit group configs
        const groupConfigs = expandGroupByConfigs(config, batteries, sortedIds);

        populateMinMaxFields(groupConfigs);
        const compiledFilters = compileGroupFilters(groupConfigs);

        sortedIds.forEach(id => {
            const foundIndex = getGroupIndex(groupConfigs, batteries[id], haGroupData, compiledFilters);
            if (foundIndex == -1) {
                // batteries without group
                result.list.push(id);
            }
            else {
                // bumping group index as the first group is for the orphans
                result.groups[foundIndex] = result.groups[foundIndex] || createGroup(haGroupData, [], groupConfigs[foundIndex]);
                result.groups[foundIndex].batteryIds.push(id);
            }
        });
    }

    // do the post processing for dynamic values which depend on the group items
    result.groups.forEach(g => {
        if (g.title) {
            g.title = getEnrichedText(g.title, g, batteries);
        }

        if (g.secondaryInfo) {
            g.secondaryInfo = getEnrichedText(g.secondaryInfo, g, batteries);
        }

        g.icon = getIcon(g.icon, g.batteryIds, batteries);
        g.iconColor = getIconColor(g.iconColor, g.batteryIds, batteries);
    });

    return result;
}

/**
 * Expands group configs with "by" into explicit group configs.
 * For each "by" entry, discovers unique values from entity data and creates
 * one group per unique value with a filter matching that value (plus any original filters).
 * Entities with missing/null/empty "by" values won't match any expanded group.
 */
const expandGroupByConfigs = (config: IGroupConfig[], batteries: IBatteryCollection, sortedIds: string[]): IGroupConfig[] => {
    if (!config.some(g => g.by)) {
        return config;
    }

    const expanded: IGroupConfig[] = [];

    for (const group of config) {
        if (!group.by) {
            expanded.push(group);
            continue;
        }

        // Discover unique values for this by path
        const uniqueValues = new Set<string>();
        for (const id of sortedIds) {
            const value = batteries[id].accessor?.resolve(group.by);
            if (value !== undefined && value !== null && value !== "") {
                uniqueValues.add(value.toString());
            }
        }

        // Create one group config per unique value
        const originalFilters = group.filter || group.filters || [];
        for (const value of uniqueValues) {
            const valueFilter: FilterSpec = { name: group.by, value: value };
            expanded.push({
                name: group.name || value,
                secondary_info: group.secondary_info,
                icon: group.icon,
                icon_color: group.icon_color,
                filter: [valueFilter, ...originalFilters],
            });
        }
    }

    return expanded;
}

/**
 * Returns group index to which battery should be assigned.
 * @param config Collapsing groups config
 * @param battery Battery view model
 * @param haGroupData Home Assistant group data
 * @param compiledFilters Compiled filter instances for each group
 */
const getGroupIndex = (config: IGroupConfig[], battery: IBatteryCollectionItem, haGroupData: IGroupDataMap, compiledFilters: (Filter[] | undefined)[]): number => {
    return config.findIndex((group, index) => {

        if (group.group_id && !haGroupData[group.group_id]?.entity_id?.some(id => battery.entityId == id)) {
            return false;
        }

        if (group.entities && !group.entities.some(id => battery.entityId == id)) {
            return false
        }

        const filters = compiledFilters[index];
        if (filters) {
            return filters.every(f => f.isValid(battery.accessor));
        }

        const level = isNaN(toNumber(battery.state)) ? 0 : toNumber(battery.state);

        return level >= group.min! && level <= group.max!;
    });
}

/**
 * Compiles filter specs into Filter instances for each group.
 * Returns undefined for groups without filters.
 */
const compileGroupFilters = (config: IGroupConfig[]): (Filter[] | undefined)[] =>
    config.map(group => (group.filters || group.filter)?.map(createFilter));

/**
 * Sets missing max/min fields.
 * @param config Collapsing groups config
 */
var populateMinMaxFields = (config: IGroupConfig[]): void => config.forEach(groupConfig => {
    if (groupConfig.min == undefined) {
        groupConfig.min = 0;
    }

    if (groupConfig.max != undefined && groupConfig.max < groupConfig.min) {
        log("Collapse group min value should be lower than max.\n" + JSON.stringify(groupConfig, null, 2));
        return;
    }

    if (groupConfig.max == undefined) {
        groupConfig.max = 100;
    }
});

/**
 * Creates and returns group view data object.
 * @param haGroupData Home Assistant group data
 * @param batteries Battery view model
 * @param config Collapsing group config
 */
const createGroup = (haGroupData: IGroupDataMap, batteryIds: string[], config?: IGroupConfig): IBatteryGroup => {

    if (config?.group_id && !haGroupData[config.group_id]) {
        throw new Error("Group not found: " + config.group_id);
    }

    let name = config?.name;
    if (!name && config?.group_id) {
        name = haGroupData[config.group_id].friendly_name;
    }

    let icon = config?.icon;
    if (icon === undefined && config?.group_id) {
        icon = haGroupData[config.group_id].icon;
    }

    return {
        title: name,
        icon: icon,
        iconColor: config?.icon_color,
        batteryIds: batteryIds,
        secondaryInfo: config?.secondary_info
    }
}

/**
 * Replaces all keywords, used in the text, with values
 * @param text Text to process
 * @param group Battery group view data
 */
const getEnrichedText = (text: string, group: IBatteryGroup, batteries: IBatteryCollection): string => {
    return text.replace(/\{([^}]+)\}/g, (match, content: string) => {
        // Split on | to separate aggregation expression from optional pipes
        const parts = content.split("|");
        const mainExpr = parts[0];
        const pipes = parts.slice(1);

        // Check if it's a function call like sum(path)
        const funcMatch = aggCallPattern.exec(mainExpr);
        const funcName = funcMatch ? funcMatch[1] : mainExpr;
        const dataPath = funcMatch ? (funcMatch[2] || "computed.state") : "computed.state";

        let result = resolveAggregation(funcName, dataPath, group, batteries);
        if (result === undefined) {
            return match; // Unknown keyword, return as-is
        }

        if (pipes.length > 0) {
            result = applyKStringProcessors(result, pipes);
        }

        return result;
    });
}

const aggCallPattern = /^([a-z]+)\(([^)]*)\)$/;

/**
 * Collects numeric values for a given data path from all entities in a group.
 */
const collectNumericValues = (dataPath: string, group: IBatteryGroup, batteries: IBatteryCollection): number[] => {
    return group.batteryIds
        .map(id => {
            const val = batteries[id].accessor?.resolve(dataPath);
            return val === undefined || val === null ? NaN : toNumber(val);
        })
        .filter(v => !isNaN(v));
}

/**
 * Resolves aggregation function to a string value. Returns undefined for unknown functions.
 */
const resolveAggregation = (funcName: string, dataPath: string, group: IBatteryGroup, batteries: IBatteryCollection): string | undefined => {
    switch (funcName) {
        case "min": {
            const values = collectNumericValues(dataPath, group, batteries);
            return values.length ? Math.min(...values).toString() : "0";
        }
        case "max": {
            const values = collectNumericValues(dataPath, group, batteries);
            return values.length ? Math.max(...values).toString() : "0";
        }
        case "sum": {
            const values = collectNumericValues(dataPath, group, batteries);
            return values.reduce((a, b) => a + b, 0).toString();
        }
        case "avg": {
            const values = collectNumericValues(dataPath, group, batteries);
            return values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toString() : "0";
        }
        case "count": {
            if (dataPath === "computed.state") {
                return group.batteryIds.length.toString();
            }
            const count = group.batteryIds.filter(id => {
                const val = batteries[id].accessor?.resolve(dataPath);
                return val !== undefined && val !== null && val !== "" && val !== false && val !== 0;
            }).length;
            return count.toString();
        }
        case "range": {
            const values = collectNumericValues(dataPath, group, batteries);
            if (!values.length) return "0";
            const min = Math.min(...values).toString();
            const max = Math.max(...values).toString();
            return min === max ? min : min + "-" + max;
        }
        default:
            return undefined;
    }
}

const getIcon = (icon: string | undefined, batteryIdsInGroup: string[], batteries: IBatteryCollection): string | undefined => {
    switch (icon) {
        case "first":
            if (batteryIdsInGroup.length > 0) {
                icon = batteries[batteryIdsInGroup[0]].icon;
            }
            else {
                icon = undefined;
            }
            break;
        case "last":
            if (batteryIdsInGroup.length > 0) {
                const lastIndex = batteryIdsInGroup.length - 1;
                icon = batteries[batteryIdsInGroup[lastIndex]].icon;
            }
            else {
                icon = undefined;
            }
            break;
        default:
            if (icon && icon.includes("{") && batteryIdsInGroup.length > 0) {
                const accessor = batteries[batteryIdsInGroup[0]].accessor;
                const processor = new RichStringProcessor(accessor);
                const resolved = processor.process(icon);
                icon = (resolved && resolved !== "null") ? resolved : undefined;
            }
            break;
    }

    return icon;
}

const getIconColor = (iconColor: string | undefined, batteryIdsInGroup: string[], batteries: IBatteryCollection): string | undefined => {
    switch (iconColor) {
        case "first":
            if (batteryIdsInGroup.length > 0) {
                iconColor = batteries[batteryIdsInGroup[0]].iconColor;
            }
            else {
                iconColor = undefined;
            }
            break;
        case "last":
            if (batteryIdsInGroup.length > 0) {
                const lastIndex = batteryIdsInGroup.length - 1;
                iconColor = batteries[batteryIdsInGroup[lastIndex]].iconColor;
            }
            else {
                iconColor = undefined;
            }
            break;
    }

    return iconColor;
}