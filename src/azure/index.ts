import { 
    AZURE_BLOB_STORAGE_RESOURCE_TYPE,
    AzureBlobStorageRender
} from "./azureBlobStorage.js";

const RESOURCE_TYPE_RENDER_MAP: Record<string, AzureBlobStorageRender> = {
    [AZURE_BLOB_STORAGE_RESOURCE_TYPE]: new AzureBlobStorageRender(),
};