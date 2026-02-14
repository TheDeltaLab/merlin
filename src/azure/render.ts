
import { Command, Render, Region, Resource } from "../common/resource";

const REGION_SHORT_NAME_MAP: Record<Region, string> = {
    'eastus': 'eus',
    'westus': 'wus',
    'eastasia': 'eas',
    'koreacentral': 'krc',
    'koreasouth': 'krs',
};

export abstract class AzureResourceRender implements Render {
    /**
     * whether support connector in resource name. If true, the render will remove all connector in the rendered resource name
     */
    abstract supportConnectorInResourceName: boolean;

    abstract render(resource: Resource): Promise<Command[]>;


    renderLogin(): Command[] {
        return [
            {
                command: 'az',
                args: ['login']
            }
        ];
    }

    renderCreateResourceGroup(resource: Resource): Command[] {
        if (!resource.region) {
            throw new Error(`Region is required for creating resource group for resource ${resource.name}`);
        }
        const resourceGroupName = this.getResourceGroupName(resource);
        return [
            {
                command: 'az',
                args: [
                    'group', 'create',
                    '--name', resourceGroupName,
                    '--location', resource.region
                ]
            }
        ];
    }

    getResourceGroupName(resource: Resource): string {
        // [${project}-|shared]-rg-${ring}[-${region}]
        const projectPart = resource.project ? `${resource.project}-` : 'shared-';
        const ringPart = `-rg-${resource.ring}`;
        const regionPart = resource.region ? `-${REGION_SHORT_NAME_MAP[resource.region] || resource.region}` : '';
        return `${projectPart}${ringPart}${regionPart}`;
    }

    getResourceName(resource: Resource): string {
        // [${project}-|shared]-${name}-${ring}[-${region}][-${type}]
        const projectPart = resource.project ? `${resource.project}-` : 'shared-';
        const ringPart = `-${resource.ring}`;
        const regionPart = resource.region ? `-${REGION_SHORT_NAME_MAP[resource.region] || resource.region}` : '';
        const typePart = resource.type ? `-${resource.type.toLowerCase()}` : '';
        const result = `${projectPart}${resource.name}${ringPart}${regionPart}${typePart}`;
        if (this.supportConnectorInResourceName) {
            return result.replace(/-/g, '');
        }
        return result; 
    }
}

