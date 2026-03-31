/**
 * Deploy safety guards — prevents accidental deployments to
 * all rings or to production without explicit confirmation.
 */

import { createInterface } from 'readline';

export interface ConfirmDeployOptions {
    execute: boolean;
    ring?: string;
    all: boolean;
    yes: boolean;
}

/**
 * Checks whether the deployment should proceed based on safety rules.
 *
 * Rules:
 * 1. Non-execute (dry-run) → always proceed
 * 2. Execute + no ring + no --all → reject (all-ring deploy needs explicit confirmation)
 * 3. Execute + production + no --yes → interactive confirmation
 * 4. Execute + production + --yes → proceed (CI mode)
 * 5. Execute + test/staging → proceed
 * 6. Non-TTY + production + no --yes → reject
 */
export async function confirmDeploy(options: ConfirmDeployOptions): Promise<boolean> {
    // Rule 1: dry-run is always safe
    if (!options.execute) return true;

    // Rule 2: deploying to all rings requires --all
    if (!options.ring && !options.all) {
        console.error('⚠️  No --ring specified. This will deploy to ALL rings.');
        console.error('   Use --all to confirm, or specify --ring <ring>.');
        return false;
    }

    // Rule 5: test/staging proceed without confirmation
    if (options.ring && options.ring !== 'production') return true;

    // Rule 4: production with --yes skips confirmation (CI mode)
    if (options.ring === 'production' && options.yes) return true;

    // Rule 6: non-TTY without --yes is rejected
    if (options.ring === 'production' && !process.stdin.isTTY) {
        console.error('⚠️  Deploying to PRODUCTION requires --yes flag in non-interactive mode.');
        return false;
    }

    // Rule 3: production requires interactive confirmation
    if (options.ring === 'production') {
        return promptConfirmation('⚠️  About to deploy to PRODUCTION. Type \'yes\' to confirm: ');
    }

    // --all with no ring: deploying to all rings
    if (!options.ring && options.all) return true;

    return true;
}

/**
 * Prompts the user for a 'yes' confirmation.
 */
function promptConfirmation(message: string): Promise<boolean> {
    return new Promise((resolve) => {
        const rl = createInterface({
            input: process.stdin,
            output: process.stderr,
        });

        rl.question(message, (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase() === 'yes');
        });
    });
}
