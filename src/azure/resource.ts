import { Resource, ResourceSchema } from '../common/resource.js';


export interface AzureResource<Schema extends ResourceSchema = ResourceSchema> extends Resource<Schema> {
    resourceGroup: string;
}

