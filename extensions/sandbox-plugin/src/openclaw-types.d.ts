// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

/**
 * Type stub for `openclaw/plugin-sdk/plugin-entry` (B2 fix).
 *
 * Allows the plugin to compile without the real `openclaw` peer dependency
 * installed. When OpenClaw is present in node_modules, its real types take
 * precedence; this stub fills in the gap during isolated development.
 */
declare module "openclaw/plugin-sdk/plugin-entry" {
  export interface PluginApi {
    pluginConfig: Record<string, unknown>;
    logger: {
      error(msg: string): void;
      debug(msg: string): void;
      info(msg: string): void;
      warn(msg: string): void;
    };
    registerTool(tool: unknown, opts?: { optional?: boolean }): void;
    registerCli(
      registrar: (ctx: { program: unknown }) => void,
      opts?: {
        descriptors: Array<{ name: string; description: string; hasSubcommands?: boolean }>;
      },
    ): void;
  }
  export function definePluginEntry(entry: {
    id: string;
    name: string;
    description?: string;
    register(api: PluginApi): void | Promise<void>;
  }): unknown;
}
