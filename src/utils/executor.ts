import type { Command } from '../types/index.js';
import { execa } from 'execa';

/**
 * Execute a command
 */
export async function executeCommand(
    command: Command,
    dryRun = false,
): Promise<{ stdout: string; stderr: string }> {
    const cmdString = `${command.command} ${command.args.join(' ')}`;

    if (dryRun) {
        console.log(`[DRY RUN] Would execute: ${cmdString}`);
        return { stdout: '', stderr: '' };
    }

    console.log(`Executing: ${cmdString}`);

    try {
        const result = await execa(command.command, command.args);
        return {
            stdout: result.stdout,
            stderr: result.stderr,
        };
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Command failed: ${cmdString}\n${error.message}`);
        }
        throw error;
    }
}
