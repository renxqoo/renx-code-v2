import { z } from 'zod';
import type { ToolExecutionContext } from '../context';
import type {
  ToolExecutionPlan,
  ToolHandlerResult,
  ToolPermissionGrant,
  ToolPermissionProfile,
  ToolPermissionScope,
} from '../contracts';
import { ToolV2ExecutionError } from '../errors';
import {
  arraySchema,
  booleanSchema,
  enumSchema,
  objectSchema,
  stringSchema,
} from '../output-schema';
import { StructuredToolHandler } from '../registry';

const schema = z
  .object({
    reason: z
      .string()
      .optional()
      .describe('Human-readable reason shown to the permission resolver'),
    scope: z
      .enum(['turn', 'session'])
      .optional()
      .describe('Grant lifetime: current turn only or the full agent session'),
    permissions: z
      .object({
        fileSystem: z
          .object({
            read: z
              .array(z.string().min(1))
              .optional()
              .describe('Additional files or directories that should become readable'),
            write: z
              .array(z.string().min(1))
              .optional()
              .describe('Additional files or directories that should become writable'),
          })
          .describe('Requested file-system permission expansion')
          .optional(),
        network: z
          .object({
            enabled: z.boolean().optional().describe('Enable outbound network access when true'),
            allowedHosts: z
              .array(z.string().min(1))
              .optional()
              .describe('Hosts that should be explicitly allowed'),
            deniedHosts: z
              .array(z.string().min(1))
              .optional()
              .describe('Hosts that should remain explicitly denied'),
          })
          .describe('Requested network permission expansion')
          .optional(),
      })
      .describe('Permission profile being requested for this tool call')
      .strict(),
  })
  .strict();

export class RequestPermissionsToolV2 extends StructuredToolHandler<typeof schema> {
  constructor() {
    super({
      name: 'request_permissions',
      description:
        'Request additional file-system or network permissions and store granted scope for the current turn or session.',
      schema,
      outputSchema: objectSchema(
        {
          granted: objectSchema(
            {
              fileSystem: objectSchema(
                {
                  read: arraySchema(stringSchema()),
                  write: arraySchema(stringSchema()),
                },
                { additionalProperties: false }
              ),
              network: objectSchema(
                {
                  enabled: booleanSchema(),
                  allowedHosts: arraySchema(stringSchema()),
                  deniedHosts: arraySchema(stringSchema()),
                },
                { additionalProperties: false }
              ),
            },
            { additionalProperties: false }
          ),
          scope: enumSchema(['turn', 'session']),
        },
        {
          required: ['granted', 'scope'],
          additionalProperties: false,
        }
      ),
      supportsParallel: false,
      mutating: false,
      tags: ['permissions'],
    });
  }

  plan(): ToolExecutionPlan {
    return {
      mutating: false,
    };
  }

  async execute(
    args: z.infer<typeof schema>,
    context: ToolExecutionContext
  ): Promise<ToolHandlerResult> {
    if (!context.authorization.requestPermissions) {
      throw new ToolV2ExecutionError('Permission request resolver is not configured', {
        toolName: this.spec.name,
      });
    }

    const requestedScope = args.scope || 'turn';
    const grant = await context.authorization.service.requestPermissions({
      runtime: context.authorization,
      sessionState: context.sessionState,
      toolCallId: context.activeCall?.toolCallId || this.spec.name,
      toolName: this.spec.name,
      workingDirectory: context.workingDirectory,
      requestedScope,
      reason: args.reason,
      permissions: args.permissions as ToolPermissionProfile,
    });
    const normalizedGrant: ToolPermissionGrant = {
      granted: grant.granted,
      scope: normalizeGrantScope(requestedScope, grant.scope),
    };

    return {
      output: JSON.stringify(normalizedGrant),
      structured: normalizedGrant,
      metadata: {
        scope: normalizedGrant.scope,
      },
    };
  }
}

function normalizeGrantScope(
  requestedScope: ToolPermissionScope,
  grantedScope: ToolPermissionScope
): ToolPermissionScope {
  if (requestedScope === 'session' && grantedScope === 'session') {
    return 'session';
  }
  return 'turn';
}
