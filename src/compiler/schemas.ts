/**
 * Zod schemas for YAML resource validation
 */

import { z } from 'zod';

/**
 * Ring enum schema
 */
export const RingSchema = z.enum(['test', 'staging', 'production']);

/**
 * Region enum schema
 */
export const RegionSchema = z.enum([
    // Azure
    'eastus', 'westus', 'eastasia', 'koreacentral', 'koreasouth',
    // Alibaba Cloud
    'cn-hangzhou', 'cn-shanghai', 'cn-beijing', 'ap-southeast-1',
]);

/**
 * AuthProvider YAML schema (object format)
 */
export const AuthProviderObjectSchema = z.object({
    name: z.string().min(1)
}).catchall(z.string()).refine(
    (data) => {
        // Ensure name is always present
        return 'name' in data && typeof data.name === 'string';
    },
    {
        message: 'AuthProvider must have a name property'
    }
);

/**
 * Dependency schema
 */
export const DependencySchema = z.object({
    resource: z.string().min(1).regex(
        /^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9_-]*$/,
        'Dependency resource must be in "Type.name" format (e.g., "AzureContainerRegistry.chuangacr")'
    ),
    isHardDependency: z.boolean().optional(),
    authProvider: AuthProviderObjectSchema.optional()
});

/**
 * Specific config override schema
 */
export const SpecificConfigSchema = z.object({
    ring: RingSchema.optional(),
    region: RegionSchema.optional(),
    // Allow additional properties for config overrides
}).passthrough();

/**
 * Export schema - can be a string (getter name only) or object with name and args
 */
export const ExportSchema = z.union([
    z.string().min(1), // Simple format: just the getter name
    z.object({
        name: z.string().min(1)
    }).catchall(z.string())
]);

/**
 * Main resource YAML schema.
 *
 * `ring` is optional here — it can be inherited from a project-level `merlin.yml`.
 * The compiler validates that ring is present (either directly or via project config)
 * before proceeding to the transform stage.
 */
export const ResourceYAMLSchema = z.object({
    name: z.string().min(1, 'Resource name is required').refine(
        (name) => !name.includes('.'),
        'Resource name must not contain dots (dots are used as delimiters in Type.name references)'
    ),
    type: z.string().min(1, 'Resource type is required'),
    project: z.string().optional(),
    parent: z.string().regex(
        /^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9_-]*$/,
        'Parent must be in "Type.name" format (e.g., "AzureContainerAppEnvironment.chuangacenv")'
    ).optional(),

    // Can be single value or array; optional when inherited from merlin.yml
    ring: z.union([
        RingSchema,
        z.array(RingSchema).min(1, 'At least one ring is required')
    ]).optional(),

    region: z.union([
        z.literal('none'),  // Explicit opt-out: skip region defaults from merlin.yml (for global resources like AzureServicePrincipal)
        RegionSchema,
        z.array(RegionSchema).min(1, 'Region array cannot be empty')
    ]).optional(),

    // AuthProvider can be just a string (name) or object with args, or omitted
    authProvider: z.union([
        z.string().min(1, 'AuthProvider name is required'),
        AuthProviderObjectSchema
    ]).optional(),

    dependencies: z.array(DependencySchema).optional().default([]),

    defaultConfig: z.record(z.string(), z.unknown()).optional().default({}),

    specificConfig: z.array(SpecificConfigSchema).optional().default([]),

    exports: z.record(ExportSchema).optional().default({})
});

export type ResourceYAML = z.infer<typeof ResourceYAMLSchema>;

/**
 * Project-level config schema (merlin.yml).
 * Provides defaults for project, ring, region, authProvider.
 */
export const ProjectConfigSchema = z.object({
    project: z.string().optional(),
    ring: z.union([
        RingSchema,
        z.array(RingSchema).min(1)
    ]).optional(),
    region: z.union([
        RegionSchema,
        z.array(RegionSchema).min(1)
    ]).optional(),
    authProvider: z.union([
        z.string().min(1),
        AuthProviderObjectSchema
    ]).optional(),
});

/**
 * Composite type constant — KubernetesApp expands to Deployment + Service + Ingress at compile time.
 */
export const KUBERNETES_APP_TYPE = 'KubernetesApp';
