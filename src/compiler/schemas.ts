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
export const RegionSchema = z.enum(['eastus', 'westus', 'eastasia', 'koreacentral', 'koreasouth']);

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
    resource: z.string().min(1),
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
 * Main resource YAML schema
 */
export const ResourceYAMLSchema = z.object({
    name: z.string().min(1, 'Resource name is required'),
    type: z.string().min(1, 'Resource type is required'),
    project: z.string().optional(),
    parent: z.string().optional(),

    // Can be single value or array
    ring: z.union([
        RingSchema,
        z.array(RingSchema).min(1, 'At least one ring is required')
    ]),

    region: z.union([
        RegionSchema,
        z.array(RegionSchema).min(1, 'Region array cannot be empty')
    ]).optional(),

    // AuthProvider can be just a string (name) or object with args, or omitted
    authProvider: z.union([
        z.string().min(1, 'AuthProvider name is required'),
        AuthProviderObjectSchema
    ]).optional(),

    dependencies: z.array(DependencySchema).optional().default([]),

    defaultConfig: z.record(z.string(), z.unknown()),

    specificConfig: z.array(SpecificConfigSchema).optional().default([]),

    exports: z.record(ExportSchema).optional().default({})
});

export type ResourceYAML = z.infer<typeof ResourceYAMLSchema>;
