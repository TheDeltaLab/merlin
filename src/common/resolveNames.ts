/**
 * Ring/Region short name ↔ full name resolution.
 *
 * Allows CLI users to type `--ring stg` or `--region krc` instead of
 * the full `--ring staging` / `--region koreacentral`.
 *
 * Full names pass through unchanged; unknown values pass through as-is
 * (downstream validation will catch invalid names).
 */

import { RING_SHORT_NAME_MAP, REGION_SHORT_NAME_MAP, Ring, Region } from './resource.js';

// Build reverse maps: short → full
export const RING_LONG_NAME_MAP: Record<string, Ring> = Object.fromEntries(
    Object.entries(RING_SHORT_NAME_MAP).map(([full, short]) => [short, full as Ring])
);

export const REGION_LONG_NAME_MAP: Record<string, Region> = Object.fromEntries(
    Object.entries(REGION_SHORT_NAME_MAP).map(([full, short]) => [short, full as Region])
);

/**
 * Resolves a ring name: short name → full name, full name → unchanged.
 * Unknown values pass through as-is.
 */
export function resolveRing(input: string): string {
    const lower = input.toLowerCase();
    // Check if it's already a full name
    if (lower in RING_SHORT_NAME_MAP) return lower;
    // Check if it's a short name
    if (lower in RING_LONG_NAME_MAP) return RING_LONG_NAME_MAP[lower];
    // Unknown — pass through
    return input;
}

/**
 * Resolves a region name: short name → full name, full name → unchanged.
 * Unknown values pass through as-is.
 */
export function resolveRegion(input: string): string {
    const lower = input.toLowerCase();
    // Check if it's already a full name
    if (lower in REGION_SHORT_NAME_MAP) return lower;
    // Check if it's a short name
    if (lower in REGION_LONG_NAME_MAP) return REGION_LONG_NAME_MAP[lower];
    // Unknown — pass through
    return input;
}
